import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import { dirname, extname, posix, relative, resolve, sep, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { validateSchema } from "./validate-schema.mjs";
import { CANONICAL_ROLE_IDS, canonicalRoleCapabilityErrors, isSafePortableRolePrompt, isValidMutationScopeOperation, isValidMutationScopePath, PRIVILEGED_SEMANTIC_CAPABILITIES, SEMANTIC_CAPABILITIES, WRITE_SEMANTIC_CAPABILITIES } from "../../core/roles/contract.mjs";

export { SEMANTIC_CAPABILITIES };

const SCHEMA_NAMES = Object.freeze(["rule", "role", "workflow", "command", "skill"]);

// These are the only capability names that may cross the portable/native seam.
// Adapters map them to product-specific tools; the core never does that mapping.
const CAPABILITY_SET = new Set(SEMANTIC_CAPABILITIES);
const VENDOR_TOOL_VALUES = new Set(["Read", "Write", "Edit", "Bash", "Glob", "Grep", "LS", "NotebookEdit", "WebFetch", "WebSearch", "Task", "MultiEdit", "Agent", "Skill", "TodoWrite", "PowerShell"]);
const VENDOR_TOOL_PATTERN = /(?:^|[^a-z0-9])(?:spawn_agent|invoke_subagent|run_command|view_file|grep_search|find_by_name|list_dir|write_to_file|replace_file_content|search_web|read_url_content|ask_question|manage_subagents|manage_task|generate_image|mcp__[a-z0-9_:-]+)(?:$|[^a-z0-9])/u;
const VENDOR_FIELD_NAMES = new Set(["tool", "tools", "nativeTool", "nativeTools", "vendorTool", "vendorTools"]);
const CANONICAL_ROLE_SET = new Set(CANONICAL_ROLE_IDS);
const ROLE_WRITE_CAPABILITIES = new Set(WRITE_SEMANTIC_CAPABILITIES);

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

async function promptContainmentErrors(repositoryRoot, promptPath, roleDirectory, sourcePath) {
  const errors = [];
  try {
    const [rootRealpath, roleDirectoryRealpath, promptRealpath] = await Promise.all([
      realpath(repositoryRoot),
      realpath(roleDirectory),
      realpath(promptPath)
    ]);
    const promptParent = dirname(promptRealpath);
    if (!realpathIsContained(rootRealpath, promptRealpath) || promptParent !== roleDirectoryRealpath) {
      errors.push(errorRecord(sourcePath, "", "promptContainment", "role prompt must resolve inside its sibling role directory and repository root"));
    }
  } catch (error) {
    errors.push(errorRecord(sourcePath, "", "promptContainment", `unable to prove role prompt containment: ${error.message}`));
  }
  return errors;
}

async function loadRoleCollection(root, coreRoot, errors) {
  const entries = await loadJsonCollection(root, coreRoot, "roles", "role", errors);
  let directories = [];
  try {
    directories = await readdir(resolve(coreRoot, "roles"), { withFileTypes: true });
  } catch (error) {
    if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") throw error;
  }
  for (const directory of directories.filter((entry) => entry.isDirectory()).sort((left, right) => compareText(left.name, right.name))) {
    if (!CANONICAL_ROLE_SET.has(directory.name)) {
      errors.push(errorRecord(toPortablePath(root, resolve(coreRoot, "roles", directory.name)), `/roles/${directory.name}`, "canonicalRole", `unknown canonical role directory ${directory.name}`));
      if (directory.name === "generalist") errors.push(errorRecord(toPortablePath(root, resolve(coreRoot, "roles", directory.name)), `/roles/${directory.name}`, "quarantinedRole", "generic generalist roles are not part of canonical routing"));
    }
  }
  for (const entry of entries) {
    const promptPath = resolve(dirname(entry.path), "prompt.md");
    let promptExists;
    try {
      promptExists = await pathExists(promptPath);
    } catch (error) {
      errors.push(errorRecord(toPortablePath(root, promptPath), "", "promptContainment", `unable to inspect role prompt: ${error.message}`));
      continue;
    }
    if (!promptExists) continue;
    const promptSourcePath = toPortablePath(root, promptPath);
    try {
      const containmentErrors = await promptContainmentErrors(root, promptPath, dirname(entry.path), promptSourcePath);
      if (containmentErrors.length > 0) {
        errors.push(...containmentErrors);
        continue;
      }
      const prompt = await readUtf8(promptPath);
      if (prompt.trim().length === 0) {
        errors.push(errorRecord(promptSourcePath, "", "prompt", "role prompt must contain a non-empty body"));
      } else {
        if (CANONICAL_ROLE_SET.has(entry.record.id) && !isSafePortableRolePrompt(prompt)) {
          errors.push(errorRecord(promptSourcePath, "", "promptSafety", "portable role prompts cannot invoke vendor-native mutable or command tools"));
        }
        entry.record.prompt = prompt;
      }
    } catch (error) {
      errors.push(errorRecord(promptSourcePath, "", "read", error.message));
    }
  }
  return entries;
}

function roleContractErrors(entries, requireCanonical = false) {
  const errors = [];
  const prompts = new Map();
  const purposes = new Map();
  const canonicalEntries = entries.filter((entry) => CANONICAL_ROLE_SET.has(entry.record?.id));
  const enforceCanonicalContract = requireCanonical;
  if (enforceCanonicalContract) {
    for (const roleId of [...CANONICAL_ROLE_SET].sort(compareText)) {
      if (!canonicalEntries.some((entry) => entry.record?.id === roleId)) {
        errors.push(errorRecord("core/roles", `/roles/${roleId}`, "canonicalRole", `missing canonical role ${roleId}`));
      }
    }
  }
  for (const entry of entries) {
    const role = entry.record;
    const sourcePath = entry.sourcePath;
    if (!CANONICAL_ROLE_SET.has(role?.id)) {
      errors.push(errorRecord(sourcePath, "/id", "canonicalRole", `unknown canonical role ${String(role?.id)}`));
      if (role?.id === "generalist") errors.push(errorRecord(sourcePath, "/id", "quarantinedRole", "generic generalist roles are not part of canonical routing"));
      continue;
    }
    if (!enforceCanonicalContract) continue;
    if (typeof role.prompt !== "string" || role.prompt.trim().length === 0) {
      errors.push(errorRecord(sourcePath, "/prompt", "prompt", "canonical role requires a non-empty sibling prompt.md"));
    } else {
      const normalizedPrompt = role.prompt.replace(/\s+/gu, " ").trim();
      if (prompts.has(normalizedPrompt)) {
        errors.push(errorRecord(sourcePath, "/prompt", "promptDivergence", `prompt duplicates ${prompts.get(normalizedPrompt)}`));
      } else prompts.set(normalizedPrompt, role.id);
      if (/^---\s*$/mu.test(role.prompt)) errors.push(errorRecord(sourcePath, "/prompt", "promptFormat", "role prompt must be a body document without frontmatter"));
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(role.prompt)) errors.push(errorRecord(sourcePath, "/prompt", "promptFormat", "role prompt cannot contain control characters"));
      if (!/## Evidence contract\b/iu.test(role.prompt)) errors.push(errorRecord(sourcePath, "/prompt", "evidenceContract", "role prompt must explain its evidence contract"));
    }
    if (typeof role.purpose === "string") {
      const normalizedPurpose = role.purpose.replace(/\s+/gu, " ").trim().toLowerCase();
      if (purposes.has(normalizedPurpose)) errors.push(errorRecord(sourcePath, "/purpose", "roleDivergence", `purpose duplicates ${purposes.get(normalizedPurpose)}`));
      else purposes.set(normalizedPurpose, role.id);
    }
    if (!role.evidenceContract || typeof role.evidenceContract !== "object" || Array.isArray(role.evidenceContract)) {
      errors.push(errorRecord(sourcePath, "/evidenceContract", "evidenceContract", "canonical role requires a structured evidence contract"));
    } else {
      if (!Array.isArray(role.evidenceContract.required) || role.evidenceContract.required.length === 0 || role.evidenceContract.required.some((item) => typeof item !== "string" || item.trim().length === 0)) errors.push(errorRecord(sourcePath, "/evidenceContract/required", "evidenceContract", "evidenceContract.required must contain non-empty strings"));
      if (typeof role.evidenceContract.format !== "string" || role.evidenceContract.format.trim().length === 0) errors.push(errorRecord(sourcePath, "/evidenceContract/format", "evidenceContract", "evidenceContract.format must be non-empty"));
      if (!Array.isArray(role.evidenceContract.limitations) || role.evidenceContract.limitations.length === 0 || role.evidenceContract.limitations.some((item) => typeof item !== "string" || item.trim().length === 0)) errors.push(errorRecord(sourcePath, "/evidenceContract/limitations", "evidenceContract", "evidenceContract.limitations must contain non-empty strings"));
    }
    const outputEvidenceValid = typeof role.outputContract?.evidence === "string"
      ? role.outputContract.evidence.trim().length > 0
      : Array.isArray(role.outputContract?.evidence) && role.outputContract.evidence.length > 0 && role.outputContract.evidence.every((item) => typeof item === "string" && item.trim().length > 0);
    if (!role.outputContract || typeof role.outputContract !== "object" || Array.isArray(role.outputContract) || !outputEvidenceValid) {
      errors.push(errorRecord(sourcePath, "/outputContract/evidence", "evidenceContract", "outputContract must declare non-empty evidence"));
    }
    const capabilities = [
      ...(Array.isArray(role.capabilities) ? role.capabilities : []),
      ...(Array.isArray(role.requiredCapabilities) ? role.requiredCapabilities : []),
      ...(Array.isArray(role.allowedCapabilities) ? role.allowedCapabilities : [])
    ];
    for (const capabilityError of canonicalRoleCapabilityErrors(role)) {
      const keyword = capabilityError.code === "mutation-scope"
        ? "mutationScope"
        : capabilityError.code === "privileged-capability"
          ? "privilegedCapability"
          : "roleCapability";
      errors.push(errorRecord(sourcePath, capabilityError.path, keyword, capabilityError.message));
    }
    const privilegedCapabilities = capabilities.filter((capability) => PRIVILEGED_SEMANTIC_CAPABILITIES.includes(capability));
    if (privilegedCapabilities.length > 0) {
      errors.push(errorRecord(sourcePath, "/capabilities", "privilegedCapability", `canonical role cannot declare privileged capability ${privilegedCapabilities.join(", ")}`));
    }
    const writeCapabilities = capabilities.filter((capability) => ROLE_WRITE_CAPABILITIES.has(capability));
    if (role.id !== "implementer" && writeCapabilities.length > 0) {
      errors.push(errorRecord(sourcePath, "/capabilities", "mutationScope", `read-only role cannot declare ${writeCapabilities.join(", ")}`));
    }
    if (role.id !== "implementer" && role.mutationScope !== "none") {
      errors.push(errorRecord(sourcePath, "/mutationScope", "mutationScope", "every non-implementer role must use mutationScope none"));
    }
    if (role.id === "implementer") {
      if (writeCapabilities.length === 0) {
        errors.push(errorRecord(sourcePath, "/capabilities", "semanticCapability", `implementer must declare one of ${[...ROLE_WRITE_CAPABILITIES].sort(compareText).join(", ")}`));
      }
      const scope = role.mutationScope;
      const validScope = scope && typeof scope === "object" && !Array.isArray(scope) &&
        Array.isArray(scope.paths) && scope.paths.length > 0 &&
        Array.isArray(scope.operations) && scope.operations.length > 0 &&
        scope.paths.every(isValidMutationScopePath) &&
        scope.operations.every(isValidMutationScopeOperation);
      if (!validScope) {
        errors.push(errorRecord(sourcePath, "/mutationScope", "mutationScope", "implementer must declare non-empty scoped paths and operations"));
      }
      if (role.mutationScope === "full") errors.push(errorRecord(sourcePath, "/mutationScope", "mutationScope", "implementer may not use full mutation scope"));
    }
  }
  return errors;
}

async function nearestExistingRealpath(path) {
  let candidate = resolve(path);
  while (true) {
    try {
      return await realpath(candidate);
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") throw error;
      try {
        const candidateStat = await lstat(candidate);
        if (candidateStat.isSymbolicLink()) throw new Error(`unable to resolve symbolic link ${candidate}`);
      } catch (statError) {
        if (statError?.code !== "ENOENT" && statError?.code !== "ENOTDIR") throw statError;
      }
      const parent = resolve(candidate, "..");
      if (parent === candidate) return null;
      candidate = parent;
    }
  }
}

function pathIsAbsolute(value) {
  return posix.isAbsolute(value) || win32.isAbsolute(value);
}

function realpathIsContained(rootRealpath, targetRealpath) {
  const relativePath = relative(rootRealpath, targetRealpath);
  if (pathIsAbsolute(relativePath)) return false;
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || relativePath.startsWith("../") || relativePath.startsWith("..\\")) return false;
  const pathApi = /^[A-Za-z]:[\\/]/u.test(rootRealpath) || /^\\\\/u.test(rootRealpath) ? win32 : posix;
  return pathApi.resolve(rootRealpath, relativePath) === pathApi.normalize(targetRealpath);
}

/** Resolve a portable virtual workspace scope without applying filesystem effects. */
export function resolveWorkspaceScopePath({ repositoryRoot, scopePath } = {}) {
  if (typeof repositoryRoot !== "string" || repositoryRoot.trim() === "") throw new TypeError("repositoryRoot must be a non-empty path");
  if (typeof scopePath !== "string" || scopePath.trim() === "") throw new TypeError("scopePath must be a non-empty path");
  const normalized = scopePath.replaceAll("\\", "/");
  if (pathIsAbsolute(scopePath) || pathIsAbsolute(normalized)) throw new Error("mutation scope cannot be absolute");
  if (scopePath.includes("\\")) throw new Error("mutation scope must be rooted at workspace and use portable separators");
  if (!isValidMutationScopePath(scopePath)) throw new Error("mutation scope path is not a valid workspace path");
  if (normalized.includes("*") && !normalized.endsWith("/**")) throw new Error("mutation scope glob must end with /**");
  const literal = normalized.endsWith("/**") ? normalized.slice(0, -3).replace(/\/$/u, "") : normalized;
  const segments = literal.split("/");
  if (segments[0] !== "workspace" || segments.some((segment) => segment === ".." || segment === "" && segments.length > 1 || /^[A-Za-z]:$/u.test(segment))) throw new Error("mutation scope must be rooted at virtual workspace");
  const tail = segments.slice(1).join("/");
  const pathApi = /^[A-Za-z]:[\\/]/u.test(repositoryRoot) || /^\\\\/u.test(repositoryRoot) ? win32 : posix;
  return pathApi.normalize(tail ? pathApi.resolve(repositoryRoot, ...tail.split("/")) : pathApi.resolve(repositoryRoot));
}

async function descendantContainmentErrors(rootRealpath, targetPath, entry, pathIndex) {
  const errors = [];
  async function visit(directory) {
    let children;
    try {
      children = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return;
      throw error;
    }
    children.sort((left, right) => compareText(left.name, right.name));
    for (const child of children) {
      const childPath = resolve(directory, child.name);
      let childStat;
      try {
        childStat = await lstat(childPath);
      } catch (error) {
        if (error?.code === "ENOENT" || error?.code === "ENOTDIR") continue;
        throw error;
      }
      let childRealpath;
      try {
        childRealpath = await realpath(childPath);
      } catch (error) {
        if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
          if (childStat.isSymbolicLink()) errors.push(errorRecord(entry.sourcePath, `/mutationScope/paths/${pathIndex}`, "mutationScopeContainment", "mutation scope glob contains a symlink whose realpath cannot be proven contained"));
          continue;
        }
        throw error;
      }
      if (!realpathIsContained(rootRealpath, childRealpath)) {
        errors.push(errorRecord(entry.sourcePath, `/mutationScope/paths/${pathIndex}`, "mutationScopeContainment", "mutation scope glob contains a symlink or junction outside the repository root"));
        continue;
      }
      if (childStat.isDirectory() && !childStat.isSymbolicLink()) await visit(childPath);
    }
  }
  await visit(targetPath);
  return errors;
}

async function mutationScopeContainmentErrors(repositoryRoot, entries) {
  const errors = [];
  let rootRealpath;
  try {
    rootRealpath = await nearestExistingRealpath(repositoryRoot);
  } catch (error) {
    errors.push(errorRecord("core/roles/implementer/role.json", "/mutationScope", "mutationScopeContainment", `unable to resolve repository root: ${error.message}`));
    return errors;
  }
  if (!rootRealpath) return errors;
  const implementers = entries.filter((entry) => entry.record?.id === "implementer");
  for (const entry of implementers) {
    const paths = entry.record?.mutationScope?.paths;
    if (!Array.isArray(paths)) continue;
    for (const [index, scopePath] of paths.entries()) {
      if (typeof scopePath !== "string") continue;
      let targetPath;
      try {
        targetPath = resolveWorkspaceScopePath({ repositoryRoot, scopePath });
      } catch (error) {
        errors.push(errorRecord(entry.sourcePath, `/mutationScope/paths/${index}`, "mutationScopeContainment", "mutation scope resolves outside the repository root"));
        continue;
      }
      try {
        const targetRealpath = await nearestExistingRealpath(targetPath);
        if (!targetRealpath || !realpathIsContained(rootRealpath, targetRealpath)) {
          errors.push(errorRecord(entry.sourcePath, `/mutationScope/paths/${index}`, "mutationScopeContainment", "mutation scope resolves outside the repository root"));
          continue;
        }
        const recursiveScope = scopePath === "workspace" || scopePath.replaceAll("\\", "/").endsWith("/**");
        if (recursiveScope && await pathExists(targetPath)) {
          errors.push(...await descendantContainmentErrors(rootRealpath, targetPath, entry, index));
        }
      } catch (error) {
        errors.push(errorRecord(entry.sourcePath, `/mutationScope/paths/${index}`, "mutationScopeContainment", `unable to validate mutation scope: ${error.message}`));
      }
    }
  }
  return errors;
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
  errors.push(...roleContractErrors(roles, inventory?.repository === "all-about-agents"));
  errors.push(...await mutationScopeContainmentErrors(repositoryRoot, roles));
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
