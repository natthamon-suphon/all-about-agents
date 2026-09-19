import { lstat, readFile } from "node:fs/promises";
import { dirname, isAbsolute, posix, relative, resolve } from "node:path";

const SKILL_ID = /^[a-z0-9][a-z0-9-]*$/u;
const compareCodePoints = (left, right) => left === right ? 0 : left < right ? -1 : 1;

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function operation(fileSystem, name, fallback) {
  const candidate = fileSystem?.[name];
  return typeof candidate === "function" ? candidate.bind(fileSystem) : fallback;
}

function portablePath(value) {
  return typeof value === "string"
    && value.length > 0
    && !value.includes("\\")
    && !value.includes("\0")
    && !value.includes(":")
    && !posix.isAbsolute(value)
    && posix.normalize(value) === value
    && !value.split("/").some((part) => part === "" || part === "." || part === "..");
}

function contained(root, candidate) {
  const value = relative(root, candidate);
  return value === "" || (value !== ".." && !value.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(value));
}

function portableFrom(root, candidate) {
  return relative(root, candidate).replaceAll("\\", "/");
}

async function readUtf8(path, fileSystem) {
  const read = operation(fileSystem, "readFile", readFile);
  const value = await read(path);
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  if (!(bytes instanceof Uint8Array)) throw new TypeError("file reader must return text or Uint8Array");
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/\r\n?/gu, "\n");
}

async function regularFile(path, fileSystem) {
  const inspect = operation(fileSystem, "lstat", lstat);
  try {
    const metadata = await inspect(path);
    return Boolean(metadata?.isFile?.()) && !metadata?.isSymbolicLink?.() && !metadata?.isReparsePoint?.();
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return false;
    throw error;
  }
}

function error(errors, code, path, message) {
  errors.push({ code, path, message });
}

function artifact(artifacts, kind, path, status) {
  artifacts.push({ kind, path, status });
}

function declaredCompanions(source) {
  const entries = [];
  for (const [field, kind] of [["assets", "asset"], ["scripts", "script"]]) {
    const values = source?.[field];
    if (!Array.isArray(values)) return null;
    for (const canonicalPath of values) entries.push({ canonicalPath, kind });
  }
  return entries;
}

function markdownTargets(content) {
  const targets = [];
  const pattern = /!?\[[^\]]*\]\(([^)]+)\)/gu;
  for (const match of content.matchAll(pattern)) {
    let target = match[1].trim();
    if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
    const title = /^(\S+)\s+["'][^"']*["']$/u.exec(target);
    if (title) target = title[1];
    targets.push(target);
  }
  return targets;
}

async function validateMarkdownReferences({ content, sourcePath, sourceAbsolute, ownerRoot, allowedPaths, repositoryRoot, fileSystem, errors }) {
  for (const rawTarget of markdownTargets(content)) {
    if (rawTarget.startsWith("#") || /^[a-z][a-z0-9+.-]*:/iu.test(rawTarget) || rawTarget.startsWith("//")) continue;
    let target;
    try {
      target = decodeURIComponent(rawTarget.split("#", 1)[0].split("?", 1)[0]);
    } catch {
      error(errors, "invalid-skill-reference", sourcePath, `Markdown reference is not valid URI text: ${rawTarget}`);
      continue;
    }
    if (target === "" || target.includes("\\") || target.includes("\0")) {
      error(errors, "invalid-skill-reference", sourcePath, `Markdown reference is not a safe relative path: ${rawTarget}`);
      continue;
    }
    const absolute = resolve(dirname(sourceAbsolute), target);
    const portable = portableFrom(repositoryRoot, absolute);
    if (!contained(ownerRoot, absolute) || !allowedPaths.has(absolute) || !await regularFile(absolute, fileSystem)) {
      error(errors, "invalid-skill-reference", sourcePath, `Markdown reference is outside declared skill ownership or missing: ${rawTarget}`);
      continue;
    }
    if (!portablePath(portable)) error(errors, "invalid-skill-reference", sourcePath, `Markdown reference is not portable: ${rawTarget}`);
  }
}

function caseKind(caseId) {
  if (caseId.includes("-NONTRIGGER-")) return "nontrigger";
  if (caseId.includes("-TRIGGER-")) return "trigger";
  if (caseId.includes("-PRESSURE-")) return "pressure";
  return null;
}

function sameValues(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => value === right[index]);
}

/** Validate every repository artifact owned by one canonical skill. */
export async function validateSkillArtifacts({ repositoryRoot, core, skillId, fileSystem = {} } = {}) {
  if (!SKILL_ID.test(skillId ?? "")) throw new TypeError("skillId must be one kebab-case skill name");
  if (typeof repositoryRoot !== "string" || repositoryRoot.trim() === "" || repositoryRoot.includes("\0")) throw new TypeError("repositoryRoot must be a non-empty path");
  if (!object(core) || !object(core.inventory) || !Array.isArray(core.skills) || !Array.isArray(core.evals)) throw new TypeError("core must contain inventory, skills, and evals");
  if (!object(fileSystem) || Array.isArray(fileSystem)) throw new TypeError("fileSystem must be an object");

  const root = resolve(repositoryRoot);
  const ownerRoot = resolve(root, "core", "skills", skillId);
  const sourcePath = `core/skills/${skillId}/SKILL.md`;
  const sourceAbsolute = resolve(root, ...sourcePath.split("/"));
  const evalPath = `core/evals/skill-routing/${skillId}.json`;
  const evalAbsolute = resolve(root, ...evalPath.split("/"));
  const behavioralPath = `tests/lint/skills/${skillId}.test.mjs`;
  const behavioralAbsolute = resolve(root, ...behavioralPath.split("/"));
  const errors = [];
  const artifacts = [];
  const cases = [];

  const inventoryNames = core.inventory.skills?.filter((name) => name === skillId) ?? [];
  const sources = core.inventory.skillSources?.filter((entry) => entry?.name === skillId) ?? [];
  const source = sources[0];
  const inventoryValid = inventoryNames.length === 1 && sources.length === 1 && source?.source === `skills/${skillId}/SKILL.md`;
  artifact(artifacts, "inventory", "core/inventory.json", inventoryValid ? "PASS" : "FAIL");
  if (!inventoryValid) {
    error(errors, inventoryNames.length === 0 || sources.length === 0 ? "missing-inventory-record" : "ownership-mismatch", "core/inventory.json", `skill ${skillId} must have one matching skills and skillSources record`);
  }

  const skillRecords = core.skills.filter((entry) => entry?.id === skillId || entry?.name === skillId);
  const skillRecord = skillRecords.length === 1 && skillRecords[0]?.id === skillId && skillRecords[0]?.name === skillId ? skillRecords[0] : null;
  if (!skillRecord) error(errors, "unknown-skill", sourcePath, `loaded core must contain one skill record for ${skillId}`);

  const sourceExists = await regularFile(sourceAbsolute, fileSystem);
  artifact(artifacts, "skill-source", sourcePath, sourceExists ? "PASS" : "FAIL");
  let sourceContent = null;
  if (!sourceExists) error(errors, "missing-skill-source", sourcePath, `canonical SKILL.md is missing or is not a regular file`);
  else {
    try {
      sourceContent = await readUtf8(sourceAbsolute, fileSystem);
    } catch (cause) {
      error(errors, "missing-skill-source", sourcePath, `canonical SKILL.md is not readable UTF-8: ${cause.message}`);
    }
  }

  const companions = declaredCompanions(source);
  const allowedPaths = new Set([sourceAbsolute]);
  if (companions === null) {
    error(errors, "invalid-companion", "core/inventory.json", `skill ${skillId} assets and scripts must be arrays`);
  } else {
    const seen = new Set();
    const loadedCompanions = new Map((skillRecord?.companions ?? []).map((entry) => [entry?.canonicalPath, entry]));
    for (const companion of companions) {
      const { canonicalPath, kind } = companion;
      const expectedPrefix = `skills/${skillId}/`;
      const validPath = portablePath(canonicalPath) && canonicalPath.startsWith(expectedPrefix) && canonicalPath !== `${expectedPrefix}SKILL.md` && !seen.has(canonicalPath);
      const displayPath = validPath ? `core/${canonicalPath}` : `core/${String(canonicalPath)}`;
      if (!validPath) {
        artifact(artifacts, kind, displayPath, "FAIL");
        error(errors, "invalid-companion", "core/inventory.json", `companion must be a unique portable path inside ${expectedPrefix}`);
        continue;
      }
      seen.add(canonicalPath);
      const absolute = resolve(root, "core", ...canonicalPath.split("/"));
      allowedPaths.add(absolute);
      const exists = contained(ownerRoot, absolute) && await regularFile(absolute, fileSystem);
      artifact(artifacts, kind, `core/${canonicalPath}`, exists ? "PASS" : "FAIL");
      if (!exists) {
        error(errors, "missing-companion", `core/${canonicalPath}`, `declared companion is missing or is not a regular file`);
        continue;
      }
      const loaded = loadedCompanions.get(canonicalPath);
      if (!loaded || loaded.kind !== kind || loaded.relativePath !== posix.relative(`skills/${skillId}`, canonicalPath) || loaded.mode !== (kind === "script" ? 0o755 : null)) {
        error(errors, "ownership-mismatch", `core/${canonicalPath}`, `loaded companion ownership does not match inventory`);
      } else {
        try {
          const content = await readUtf8(absolute, fileSystem);
          if (loaded.content !== content) error(errors, "ownership-mismatch", `core/${canonicalPath}`, `loaded companion content does not match its canonical file`);
        } catch (cause) {
          error(errors, "invalid-companion", `core/${canonicalPath}`, `companion is not readable UTF-8: ${cause.message}`);
        }
      }
    }
    for (const loaded of skillRecord?.companions ?? []) {
      if (!seen.has(loaded?.canonicalPath)) error(errors, "ownership-mismatch", loaded?.canonicalPath ? `core/${loaded.canonicalPath}` : sourcePath, `loaded companion is not declared by inventory`);
    }
  }

  const evalExists = await regularFile(evalAbsolute, fileSystem);
  artifact(artifacts, "routing-eval", evalPath, evalExists ? "PASS" : "FAIL");
  let evalRecord = null;
  if (!evalExists) {
    error(errors, "missing-routing-eval", evalPath, `routing evaluation is missing or is not a regular file`);
  } else {
    try {
      evalRecord = JSON.parse(await readUtf8(evalAbsolute, fileSystem));
    } catch (cause) {
      error(errors, "ownership-mismatch", evalPath, `routing evaluation is not valid UTF-8 JSON: ${cause.message}`);
    }
  }

  const evalCases = Array.isArray(evalRecord?.cases) ? evalRecord.cases : [];
  const evalCaseIds = evalCases.map((entry) => entry?.id).filter((id) => typeof id === "string");
  if (evalRecord && (evalRecord.skill !== skillId || evalRecord.kind !== "skill-routing" || evalRecord.id !== `${skillId}-routing`)) {
    error(errors, "ownership-mismatch", evalPath, `routing evaluation must be owned by ${skillId}`);
  }
  const loadedEval = core.evals.filter((entry) => entry?.skill === skillId && entry?.kind === "skill-routing");
  if (evalRecord && (loadedEval.length !== 1 || !sameValues(loadedEval[0].cases?.map((entry) => entry?.id), evalCaseIds) || !sameValues(skillRecord?.evaluationCases, evalCaseIds))) {
    error(errors, "ownership-mismatch", evalPath, `loaded skill and evaluation case ownership must match the routing file`);
  }
  for (const [kind, missingCode] of [["trigger", "missing-trigger-case"], ["nontrigger", "missing-nontrigger-case"], ["pressure", "missing-pressure-case"]]) {
    const owned = evalCaseIds.filter((id) => caseKind(id) === kind);
    cases.push({ id: owned[0] ?? null, kind, status: owned.length > 0 ? "PASS" : "FAIL" });
    if (owned.length === 0) error(errors, missingCode, evalPath, `routing evaluation requires a ${kind} case`);
  }

  const behavioralExists = await regularFile(behavioralAbsolute, fileSystem);
  artifact(artifacts, "lint-test", behavioralPath, behavioralExists ? "PASS" : "FAIL");
  if (!behavioralExists) error(errors, "missing-lint-test", behavioralPath, `skill requires its exact lint test file`);

  if (sourceContent !== null) {
    await validateMarkdownReferences({ content: sourceContent, sourcePath, sourceAbsolute, ownerRoot, allowedPaths, repositoryRoot: root, fileSystem, errors });
  }
  if (companions !== null) {
    for (const companion of companions.filter((entry) => typeof entry.canonicalPath === "string" && entry.canonicalPath.endsWith(".md") && portablePath(entry.canonicalPath))) {
      const absolute = resolve(root, "core", ...companion.canonicalPath.split("/"));
      if (!allowedPaths.has(absolute) || !await regularFile(absolute, fileSystem)) continue;
      try {
        const content = await readUtf8(absolute, fileSystem);
        await validateMarkdownReferences({ content, sourcePath: `core/${companion.canonicalPath}`, sourceAbsolute: absolute, ownerRoot, allowedPaths, repositoryRoot: root, fileSystem, errors });
      } catch (cause) {
        error(errors, "invalid-companion", `core/${companion.canonicalPath}`, `companion is not readable UTF-8: ${cause.message}`);
      }
    }
  }

  artifacts.sort((left, right) => compareCodePoints(left.path, right.path) || compareCodePoints(left.kind, right.kind));
  errors.sort((left, right) => compareCodePoints(left.path, right.path) || compareCodePoints(left.code, right.code) || compareCodePoints(left.message, right.message));
  return { valid: errors.length === 0, skillId, artifacts, cases, errors };
}
