import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { validateSchema } from "./validate-schema.mjs";

const SCHEMA_NAMES = Object.freeze(["rule", "role", "workflow", "command", "skill"]);

// These are the only capability names that may cross the portable/native seam.
// Adapters map them to product-specific tools; the core never does that mapping.
export const SEMANTIC_CAPABILITIES = Object.freeze([
  "repository-read",
  "repository-write",
  "web-primary-sources",
  "isolated-write",
  "command-execution",
  "filesystem-read",
  "filesystem-write",
  "git-read",
  "git-write",
  "test-execution",
  "external-research",
  "evaluation",
  "role-dispatch",
  "workflow-state",
  "schema-validation",
  "native-rendering"
]);

const CAPABILITY_SET = new Set(SEMANTIC_CAPABILITIES);
const VENDOR_TOOL_VALUES = new Set(["Read", "Write", "Edit", "Bash", "Glob", "Grep", "LS", "NotebookEdit", "WebFetch", "WebSearch", "Task", "MultiEdit", "Agent", "Skill", "TodoWrite", "PowerShell"]);
const VENDOR_TOOL_PATTERN = /(?:^|[^a-z0-9])(?:spawn_agent|invoke_subagent|run_command|view_file|grep_search|find_by_name|list_dir|write_to_file|replace_file_content|search_web|read_url_content|ask_question|manage_subagents|manage_task|generate_image|mcp__[a-z0-9_:-]+)(?:$|[^a-z0-9])/u;
const VENDOR_FIELD_NAMES = new Set(["tool", "tools", "nativeTool", "nativeTools", "vendorTool", "vendorTools"]);

function compareText(left, right) {
  return left === right ? 0 : left < right ? -1 : 1;
}

function pointerSegment(value) {
  return String(value).replaceAll("~", "~0").replaceAll("/", "~1");
}

function pointerJoin(path, segment) {
  return `${path}/${pointerSegment(segment)}`;
}

function toPortablePath(root, filePath) {
  const value = relative(root, filePath);
  return (value || ".").split(sep).join("/");
}

function sortEntries(left, right) {
  const leftId = typeof left.record?.id === "string" ? left.record.id : "";
  const rightId = typeof right.record?.id === "string" ? right.record.id : "";
  return compareText(leftId, rightId) || compareText(left.sourcePath, right.sourcePath);
}

function errorRecord(sourcePath, jsonPointer, keyword, message) {
  return { sourcePath, jsonPointer, keyword, message };
}

export class CoreLoadError extends Error {
  constructor(errors) {
    const sorted = [...errors].sort((left, right) =>
      compareText(left.sourcePath, right.sourcePath) ||
      compareText(left.jsonPointer, right.jsonPointer) ||
      compareText(left.keyword, right.keyword) ||
      compareText(left.message, right.message)
    );
    const detail = sorted.map((entry) => {
      const pointer = entry.jsonPointer || "";
      return `${entry.sourcePath}#${pointer} ${entry.keyword}: ${entry.message}`;
    }).join("\n");
    super(`Core validation failed${detail ? `\n${detail}` : ""}`);
    this.name = "CoreLoadError";
    this.errors = sorted;
  }
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return false;
    throw error;
  }
}

async function readUtf8(path) {
  const bytes = await readFile(path);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    const error = new Error("file is not valid UTF-8");
    error.code = "ERR_INVALID_UTF8";
    throw error;
  }
}

async function readJson(path, sourcePath, errors) {
  let text;
  try {
    text = await readUtf8(path);
  } catch (error) {
    errors.push(errorRecord(sourcePath, "", "read", error.message));
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    errors.push(errorRecord(sourcePath, "", "json", `invalid JSON: ${error.message}`));
    return null;
  }
}

async function listFiles(root, predicate) {
  const found = [];
  async function visit(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return;
      throw error;
    }
    entries.sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      const child = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile() && predicate(child, entry.name)) found.push(child);
    }
  }
  await visit(root);
  return found.sort(compareText);
}

async function schemaFor(root, kind, errors) {
  const candidate = resolve(root, "core", "schemas", `${kind}.schema.json`);
  const moduleSchema = resolve(dirname(fileURLToPath(import.meta.url)), "../../core/schemas", `${kind}.schema.json`);
  const schemaPath = await pathExists(candidate) ? candidate : moduleSchema;
  return readJson(schemaPath, toPortablePath(root, schemaPath), errors);
}

function walkStrings(value, callback, path = "") {
  if (typeof value === "string") {
    callback(value, path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkStrings(item, callback, pointerJoin(path, index)));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const childPath = pointerJoin(path, key);
      callback(key, path, true);
      walkStrings(child, callback, childPath);
    }
  }
}

function portableMetadataErrors(record, sourcePath) {
  const errors = [];
  walkStrings(record, (value, path, isKey) => {
    if (isKey && VENDOR_FIELD_NAMES.has(value)) {
      errors.push(errorRecord(sourcePath, pointerJoin(path, value), "vendorField", `portable metadata cannot declare vendor field ${value}`));
      return;
    }
    if (!isKey && (VENDOR_TOOL_VALUES.has(value.trim()) || VENDOR_TOOL_PATTERN.test(value))) {
      errors.push(errorRecord(sourcePath, path, "vendorTool", "portable metadata cannot name a vendor tool"));
    }
  });
  return errors;
}

function capabilityErrors(record, sourcePath) {
  const errors = [];
  function visit(value, path, keyName = "") {
    const normalized = keyName.replaceAll("_", "").toLowerCase();
    const isCapabilityField = normalized === "capabilities" || normalized === "requiredcapabilities" || normalized === "allowedcapabilities";
    if (isCapabilityField) {
      const values = Array.isArray(value) ? value : [value];
      values.forEach((capability, index) => {
        if (typeof capability !== "string" || !CAPABILITY_SET.has(capability)) {
          errors.push(errorRecord(sourcePath, Array.isArray(value) ? pointerJoin(path, index) : path, "semanticCapability", `unknown semantic capability ${String(capability)}`));
        }
      });
    }
    if (Array.isArray(value)) value.forEach((item, index) => visit(item, pointerJoin(path, index), ""));
    else if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) visit(child, pointerJoin(path, key), key);
  }
  visit(record, "");
  return errors;
}

function parseScalar(value) {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  return trimmed;
}

function parseSkillMarkdown(text, sourcePath, errors) {
  const lines = text.split(/\r?\n/u);
  let frontmatter = {};
  let body = text;
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
    if (end < 0) {
      errors.push(errorRecord(sourcePath, "/frontmatter", "frontmatter", "frontmatter is not closed"));
    } else {
      const frontLines = lines.slice(1, end);
      const allowed = new Set(["name", "description", "capabilities", "requiredCapabilities", "references", "requiredSkills", "evaluationCases"]);
      const listFields = new Set(["capabilities", "requiredCapabilities", "references", "requiredSkills", "evaluationCases"]);
      let activeList = null;
      for (let index = 0; index < frontLines.length; index += 1) {
        const line = frontLines[index];
        if (line.trim() === "") continue;
        const listMatch = /^\s*-\s*(.+)$/u.exec(line);
        if (listMatch && activeList) {
          frontmatter[activeList].push(parseScalar(listMatch[1]));
          continue;
        }
        const fieldMatch = /^\s*([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/u.exec(line);
        if (!fieldMatch) {
          errors.push(errorRecord(sourcePath, `/frontmatter/${index + 1}`, "frontmatter", "frontmatter line must be key: value"));
          activeList = null;
          continue;
        }
        const [, key, rawValue] = fieldMatch;
        if (!allowed.has(key)) {
          errors.push(errorRecord(sourcePath, pointerJoin("/frontmatter", key), "additionalProperties", `property ${key} is not declared`));
        }
        if (listFields.has(key) && rawValue.trim() !== "") {
          errors.push(errorRecord(sourcePath, pointerJoin("/frontmatter", key), "frontmatterType", `${key} must be a YAML list`));
        }
        if (rawValue.trim() === "") {
          frontmatter[key] = [];
          activeList = key;
        } else {
          frontmatter[key] = parseScalar(rawValue);
          activeList = null;
        }
      }
      body = lines.slice(end + 1).join("\n").replace(/^\n/u, "");
    }
  }
  return { frontmatter, body };
}

async function loadJsonCollection(root, coreRoot, directoryName, kind, errors) {
  const directory = resolve(coreRoot, directoryName);
  const files = await listFiles(directory, (_path, name) => extname(name).toLowerCase() === ".json" && !name.endsWith(".schema.json"));
  const schema = await schemaFor(root, kind, errors);
  const entries = [];
  for (const path of files) {
    const sourcePath = toPortablePath(root, path);
    const record = await readJson(path, sourcePath, errors);
    if (record === null) continue;
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      errors.push(errorRecord(sourcePath, "", "type", "record must be a JSON object"));
      continue;
    }
    if (schema) {
      const result = validateSchema({ schema, value: record, sourcePath });
      errors.push(...result.errors);
    }
    errors.push(...portableMetadataErrors(record, sourcePath), ...capabilityErrors(record, sourcePath));
    entries.push({ record, sourcePath, path });
  }
  return entries;
}

async function loadRoleCollection(root, coreRoot, errors) {
  return loadJsonCollection(root, coreRoot, "roles", "role", errors);
}

async function loadSkills(root, coreRoot, errors) {
  const directory = resolve(coreRoot, "skills");
  const files = await listFiles(directory, (_path, name) => name === "SKILL.md" || (extname(name).toLowerCase() === ".json" && !name.endsWith(".schema.json")));
  const schema = await schemaFor(root, "skill", errors);
  const entries = [];
  for (const path of files) {
    const sourcePath = toPortablePath(root, path);
    let record;
    if (path.endsWith("SKILL.md")) {
      let text;
      try {
        text = await readUtf8(path);
      } catch (error) {
        errors.push(errorRecord(sourcePath, "", "read", error.message));
        continue;
      }
      const parsed = parseSkillMarkdown(text, sourcePath, errors);
      const fallbackId = relative(directory, dirname(path)).split(sep).join("/").split("/").at(-1);
      const name = typeof parsed.frontmatter.name === "string" && parsed.frontmatter.name.length > 0 ? parsed.frontmatter.name : fallbackId;
      record = {
        id: name,
        name,
        description: typeof parsed.frontmatter.description === "string" ? parsed.frontmatter.description : "",
        content: parsed.body,
        capabilities: Array.isArray(parsed.frontmatter.capabilities) ? parsed.frontmatter.capabilities : [],
        ...(Array.isArray(parsed.frontmatter.requiredCapabilities) ? { requiredCapabilities: parsed.frontmatter.requiredCapabilities } : {}),
        ...(Array.isArray(parsed.frontmatter.references) ? { references: parsed.frontmatter.references } : {}),
        ...(Array.isArray(parsed.frontmatter.requiredSkills) ? { requiredSkills: parsed.frontmatter.requiredSkills } : {}),
        ...(Array.isArray(parsed.frontmatter.evaluationCases) ? { evaluationCases: parsed.frontmatter.evaluationCases } : {})
      };
    } else {
      record = await readJson(path, sourcePath, errors);
      if (record === null) continue;
    }
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      errors.push(errorRecord(sourcePath, "", "type", "record must be a JSON object"));
      continue;
    }
    if (schema) errors.push(...validateSchema({ schema, value: record, sourcePath }).errors);
    errors.push(...portableMetadataErrors(record, sourcePath), ...capabilityErrors(record, sourcePath));
    entries.push({ record, sourcePath, path });
  }
  return entries;
}

async function loadEvaluations(root, coreRoot, errors) {
  const directory = resolve(coreRoot, "evals");
  const files = await listFiles(directory, (_path, name) => extname(name).toLowerCase() === ".json" && !name.endsWith(".schema.json"));
  const entries = [];
  for (const path of files) {
    const sourcePath = toPortablePath(root, path);
    const record = await readJson(path, sourcePath, errors);
    if (record === null) continue;
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      errors.push(errorRecord(sourcePath, "", "type", "evaluation must be a JSON object"));
      continue;
    }
    if (typeof record.id !== "string" || record.id.length === 0) {
      const fallback = relative(directory, path).split(sep).join("/").replace(/\.json$/u, "");
      record.id = fallback;
    }
    errors.push(...portableMetadataErrors(record, sourcePath), ...capabilityErrors(record, sourcePath));
    entries.push({ record, sourcePath, path });
  }
  return entries;
}

function checkDuplicateIds(collection, errors) {
  const seen = new Map();
  for (const entry of collection) {
    const id = entry.record?.id;
    if (typeof id !== "string") continue;
    const prior = seen.get(id);
    if (prior) {
      errors.push(errorRecord(entry.sourcePath, "/id", "duplicateId", `duplicate id ${id}; first declared in ${prior.sourcePath}`));
    } else {
      seen.set(id, entry);
    }
  }
}

const REFERENCE_FIELDS = {
  skills: /^(?:required|allowed|optional)?skills?$|^skillids?$/iu,
  roles: /^(?:required|allowed|optional)?roles?$|^roleids?$/iu,
  workflows: /^(?:required|allowed|optional)?workflows?$|^workflowids?$/iu,
  commands: /^(?:required|allowed|optional)?commands?$|^commandids?$/iu
};

function checkReferences(collections, errors) {
  const ids = Object.fromEntries(Object.entries(collections).map(([name, entries]) => [name, new Set(entries.map((entry) => entry.record?.id).filter((id) => typeof id === "string"))]));
  function visit(value, path, sourcePath, keyName, collectionName) {
    const referenceField = REFERENCE_FIELDS[collectionName];
    if (referenceField?.test(keyName)) {
      const values = Array.isArray(value) ? value : [value];
      values.forEach((reference, index) => {
        if (typeof reference === "string" && !ids[collectionName].has(reference)) {
          errors.push(errorRecord(sourcePath, Array.isArray(value) ? pointerJoin(path, index) : path, "reference", `unknown ${collectionName.slice(0, -1)} ${reference}`));
        }
      });
    }
    if (Array.isArray(value)) value.forEach((item, index) => visit(item, pointerJoin(path, index), sourcePath, keyName, collectionName));
    else if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) {
      const childCollection = Object.entries(REFERENCE_FIELDS).find(([, pattern]) => pattern.test(key))?.[0] ?? collectionName;
      visit(child, pointerJoin(path, key), sourcePath, key, childCollection);
    }
  }
  for (const entries of Object.values(collections)) for (const entry of entries) visit(entry.record, "", entry.sourcePath, "", "");
}

function validateInventory(inventory, sourcePath, errors) {
  if (!inventory || typeof inventory !== "object" || Array.isArray(inventory)) {
    errors.push(errorRecord(sourcePath, "", "type", "inventory must be a JSON object"));
    return;
  }
  if (!Array.isArray(inventory.skills)) errors.push(errorRecord(sourcePath, "/skills", "type", "inventory.skills must be an array"));
  else inventory.skills.forEach((skill, index) => {
    if (typeof skill !== "string" || !/^[a-z0-9][a-z0-9-]*$/u.test(skill)) errors.push(errorRecord(sourcePath, `/skills/${index}`, "pattern", "inventory skill IDs must be kebab-case strings"));
  });
}

export async function loadCore(root) {
  if (typeof root !== "string" || root.trim() === "") throw new TypeError("loadCore(root) requires a non-empty root path");
  const repositoryRoot = resolve(root);
  const nestedCore = resolve(repositoryRoot, "core");
  const coreRoot = await pathExists(resolve(nestedCore, "inventory.json")) ? nestedCore : repositoryRoot;
  const errors = [];
  const inventoryPath = resolve(coreRoot, "inventory.json");
  const inventory = await readJson(inventoryPath, toPortablePath(repositoryRoot, inventoryPath), errors);
  const inventorySourcePath = toPortablePath(repositoryRoot, inventoryPath);
  if (inventory !== null) {
    validateInventory(inventory, inventorySourcePath, errors);
    const inventorySchemaPath = resolve(coreRoot, "schemas", "inventory.schema.json");
    if (await pathExists(inventorySchemaPath)) {
      const inventorySchema = await readJson(inventorySchemaPath, toPortablePath(repositoryRoot, inventorySchemaPath), errors);
      if (inventorySchema) errors.push(...validateSchema({ schema: inventorySchema, value: inventory, sourcePath: inventorySourcePath }).errors);
    }
  }

  const [rules, roles, skills, workflows, commands, evals] = await Promise.all([
    loadJsonCollection(repositoryRoot, coreRoot, "rules", "rule", errors),
    loadRoleCollection(repositoryRoot, coreRoot, errors),
    loadSkills(repositoryRoot, coreRoot, errors),
    loadJsonCollection(repositoryRoot, coreRoot, "workflows", "workflow", errors),
    loadJsonCollection(repositoryRoot, coreRoot, "commands", "command", errors),
    loadEvaluations(repositoryRoot, coreRoot, errors)
  ]);
  const collections = { rules, roles, skills, workflows, commands, evals };
  for (const collection of Object.values(collections)) checkDuplicateIds(collection, errors);
  checkReferences(collections, errors);
  for (const collection of Object.values(collections)) collection.sort(sortEntries);
  if (errors.length > 0) throw new CoreLoadError(errors);
  return {
    inventory,
    rules: rules.map((entry) => entry.record),
    roles: roles.map((entry) => entry.record),
    skills: skills.map((entry) => entry.record),
    workflows: workflows.map((entry) => entry.record),
    commands: commands.map((entry) => entry.record),
    evals: evals.map((entry) => entry.record)
  };
}
