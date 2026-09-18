import { createHash } from "node:crypto";
import { validateNativeIntegrationRecord } from "./native-state.mjs";
import { GLOBAL_INSTRUCTION_SOURCE_PATH } from "../../installers/lib/global-instructions.mjs";

export const SURFACES = Object.freeze(["claude", "codex"]);
const RENDER_RESULT_KEYS = new Set(["files", "registrations", "diagnostics", "ownership"]);
const FILE_KEYS = new Set(["relativePath", "content", "mode"]);
const DIAGNOSTIC_KEYS = new Set(["code", "severity", "message", "sourcePath"]);
const SEVERITIES = new Set(["error", "warning", "info"]);
const SHA256 = /^[0-9a-f]{64}$/u;

function issue(code, message, path = "") {
  return { code, message, path };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sortedErrors(errors) {
  return [...errors].sort((left, right) => left.path.localeCompare(right.path) || left.code.localeCompare(right.code) || left.message.localeCompare(right.message));
}

export class AdapterContractError extends Error {
  constructor(errors) {
    const sorted = sortedErrors(errors);
    super(`Adapter contract validation failed${sorted.length > 0 ? `\n${sorted.map((entry) => `${entry.path || "<root>"} ${entry.code}: ${entry.message}`).join("\n")}` : ""}`);
    this.name = "AdapterContractError";
    this.errors = sorted;
  }
}

function checkObjectKeys(value, allowed, path, errors) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(issue("unexpected-field", `field ${key} is not part of this contract`, `${path}/${key}`));
  }
}

function absolutePath(value) {
  return /^(?:[A-Za-z]:|[\\/]{1,2}|[a-z]+:\/\/)/u.test(value);
}

function validateRelativePath(value, path, errors) {
  if (typeof value !== "string" || value.length === 0) {
    errors.push(issue("invalid-relative-path", "relativePath must be a non-empty string", path));
    return false;
  }
  if (absolutePath(value)) errors.push(issue("absolute-source-path", "paths must remain relative to the adapter destination", path));
  if (value.includes("\\")) errors.push(issue("noncanonical-path", "paths must use forward slashes", path));
  const parts = value.split("/");
  if (parts.some((part) => part === ".." || part === "" && parts.length > 1)) errors.push(issue("path-traversal", "paths may not traverse or contain empty segments", path));
  return !absolutePath(value) && !value.includes("\\") && !parts.includes("..");
}

function bytesForHash(value) {
  return value instanceof Uint8Array ? value : null;
}

/** Validate generated files, deterministic ordering, safe paths, and ownership hashes. */
export function validateRenderResult(result) {
  const errors = [];
  if (!isObject(result)) return { valid: false, errors: [issue("invalid-render-result", "render result must be an object")] };
  checkObjectKeys(result, RENDER_RESULT_KEYS, "", errors);
  for (const key of RENDER_RESULT_KEYS) if (!Object.hasOwn(result, key)) errors.push(issue("missing-render-field", `render result requires ${key}`, `/${key}`));
  if (!Array.isArray(result.files)) return { valid: false, errors: sortedErrors([...errors, issue("invalid-files", "files must be an array", "/files")]) };
  if (!Array.isArray(result.registrations)) errors.push(issue("invalid-registrations", "registrations must be an array", "/registrations"));
  if (!Array.isArray(result.diagnostics)) errors.push(issue("invalid-diagnostics", "diagnostics must be an array", "/diagnostics"));
  if (!Array.isArray(result.ownership)) errors.push(issue("invalid-ownership", "ownership must be an array", "/ownership"));

  const filePaths = [];
  const fileMap = new Map();
  result.files.forEach((file, index) => {
    const path = `/files/${index}`;
    if (!isObject(file)) {
      errors.push(issue("invalid-file", "file must be an object", path));
      return;
    }
    checkObjectKeys(file, FILE_KEYS, path, errors);
    if (!validateRelativePath(file.relativePath, `${path}/relativePath`, errors)) return;
    if (!(file.content instanceof Uint8Array)) errors.push(issue("invalid-file-content", "content must be a Uint8Array", `${path}/content`));
    if (file.mode !== null && (!Number.isInteger(file.mode) || file.mode < 0 || file.mode > 0o777)) errors.push(issue("invalid-file-mode", "mode must be null or a Unix mode from 0 through 0777", `${path}/mode`));
    if (fileMap.has(file.relativePath)) errors.push(issue("duplicate-file-path", `duplicate file path ${file.relativePath}`, `${path}/relativePath`));
    fileMap.set(file.relativePath, file);
    filePaths.push(file.relativePath);
  });
  for (let index = 1; index < filePaths.length; index += 1) if (filePaths[index - 1] > filePaths[index]) errors.push(issue("unstable-file-order", "files must be sorted by relativePath", `/files/${index}`));

  if (Array.isArray(result.registrations)) result.registrations.forEach((registration, index) => {
    if (!isObject(registration) || registration.kind !== "native-integration") return;
    const path = `/registrations/${index}`;
    const validation = validateNativeIntegrationRecord(registration);
    errors.push(...validation.errors.map((entry) => issue(entry.code, entry.message, `${path}${entry.path}`)));
  });

  if (Array.isArray(result.diagnostics)) result.diagnostics.forEach((diagnostic, index) => {
    const path = `/diagnostics/${index}`;
    if (!isObject(diagnostic)) {
      errors.push(issue("invalid-diagnostic", "diagnostic must be an object", path));
      return;
    }
    checkObjectKeys(diagnostic, DIAGNOSTIC_KEYS, path, errors);
    if (typeof diagnostic.code !== "string" || diagnostic.code.length === 0) errors.push(issue("invalid-diagnostic", "code must be non-empty", `${path}/code`));
    if (!SEVERITIES.has(diagnostic.severity)) errors.push(issue("invalid-diagnostic", "severity must be error, warning, or info", `${path}/severity`));
    if (typeof diagnostic.message !== "string" || diagnostic.message.length === 0) errors.push(issue("invalid-diagnostic", "message must be non-empty", `${path}/message`));
    if (!Object.hasOwn(diagnostic, "sourcePath")) errors.push(issue("invalid-diagnostic", "sourcePath must be present and may be null", `${path}/sourcePath`));
    else if (diagnostic.sourcePath !== null && typeof diagnostic.sourcePath !== "string") errors.push(issue("invalid-diagnostic", "sourcePath must be null or a string", `${path}/sourcePath`));
    else if (typeof diagnostic.sourcePath === "string") validateRelativePath(diagnostic.sourcePath, `${path}/sourcePath`, errors);
  });

  const ownershipPaths = [];
  const ownershipMap = new Map();
  if (Array.isArray(result.ownership)) result.ownership.forEach((entry, index) => {
    const path = `/ownership/${index}`;
    if (!isObject(entry)) {
      errors.push(issue("invalid-ownership", "ownership entry must be an object", path));
      return;
    }
    checkObjectKeys(entry, new Set(["relativePath", "sha256"]), path, errors);
    if (!validateRelativePath(entry.relativePath, `${path}/relativePath`, errors)) return;
    ownershipPaths.push(entry.relativePath);
    if (ownershipMap.has(entry.relativePath)) errors.push(issue("duplicate-ownership-path", `duplicate ownership path ${entry.relativePath}`, `${path}/relativePath`));
    ownershipMap.set(entry.relativePath, entry);
    if (typeof entry.sha256 !== "string" || !SHA256.test(entry.sha256)) errors.push(issue("missing-content-hash", "ownership entries require a lowercase SHA-256 content hash", `${path}/sha256`));
    const file = fileMap.get(entry.relativePath);
    if (!file) errors.push(issue("ownership-without-file", `ownership path ${entry.relativePath} has no rendered file`, `${path}/relativePath`));
    else if (SHA256.test(entry.sha256) && bytesForHash(file.content)) {
      const actual = createHash("sha256").update(file.content).digest("hex");
      if (actual !== entry.sha256) errors.push(issue("content-hash-mismatch", `ownership hash does not match ${entry.relativePath}`, `${path}/sha256`));
    }
  });
  for (let index = 1; index < ownershipPaths.length; index += 1) if (ownershipPaths[index - 1] > ownershipPaths[index]) errors.push(issue("unstable-ownership-order", "ownership must be sorted by relativePath", `/ownership/${index}`));
  for (const filePath of fileMap.keys()) if (!ownershipMap.has(filePath)) errors.push(issue("missing-ownership", `rendered file ${filePath} has no ownership entry`, "/ownership"));
  return { valid: errors.length === 0, errors: sortedErrors(errors) };
}

function coreShapeErrors(core) {
  const errors = [];
  if (!isObject(core)) return [issue("invalid-core", "core must be an object", "/core")];
  for (const key of ["inventory", "rules", "roles", "skills", "evals"]) {
    if (!Object.hasOwn(core, key)) errors.push(issue("invalid-core", `core.${key} is required`, `/core/${key}`));
    else if (key !== "inventory" && !Array.isArray(core[key])) errors.push(issue("invalid-core", `core.${key} must be an array`, `/core/${key}`));
  }
  if (!Object.hasOwn(core, "globalInstructions")) errors.push(issue("invalid-core", "core.globalInstructions is required", "/core/globalInstructions"));
  else if (!isObject(core.globalInstructions)) errors.push(issue("invalid-core", "core.globalInstructions must be an object", "/core/globalInstructions"));
  else {
    if (core.globalInstructions.sourcePath !== GLOBAL_INSTRUCTION_SOURCE_PATH) errors.push(issue("invalid-core", `core.globalInstructions.sourcePath must equal ${GLOBAL_INSTRUCTION_SOURCE_PATH}`, "/core/globalInstructions/sourcePath"));
    if (typeof core.globalInstructions.content !== "string") errors.push(issue("invalid-core", "core.globalInstructions.content must be a string", "/core/globalInstructions/content"));
  }
  if (!Object.hasOwn(core, "presentation")) errors.push(issue("invalid-core", "core.presentation is required", "/core/presentation"));
  else if (!isObject(core.presentation)) errors.push(issue("invalid-core", "core.presentation must be an object", "/core/presentation"));
  else {
    if (!isObject(core.presentation.emojiRegistry)) errors.push(issue("invalid-core", "core.presentation.emojiRegistry must be an object", "/core/presentation/emojiRegistry"));
    if (!isObject(core.presentation.progressContract)) errors.push(issue("invalid-core", "core.presentation.progressContract must be an object", "/core/presentation/progressContract"));
  }
  return errors;
}

/** Validate and return one adapter's deterministic render result. */
export function renderSurface(input) {
  const errors = [];
  if (!isObject(input)) throw new AdapterContractError([issue("invalid-input", "renderSurface input must be an object")]);
  if (!SURFACES.includes(input.surface)) errors.push(issue("invalid-surface", `unsupported surface ${String(input.surface)}`, "/surface"));
  errors.push(...coreShapeErrors(input.core));
  if (!isObject(input.profile)) errors.push(issue("invalid-profile", "profile must be an object", "/profile"));
  if (typeof input.statuslineName !== "string") errors.push(issue("invalid-statusline-name", "statuslineName must be a string", "/statuslineName"));
  if (!isObject(input.capabilityRecord)) errors.push(issue("missing-capability-record", "capabilityRecord must be an object", "/capabilityRecord"));
  else if (input.capabilityRecord.surface !== undefined && input.capabilityRecord.surface !== input.surface) errors.push(issue("surface-mismatch", "capabilityRecord.surface must match surface", "/capabilityRecord/surface"));
  if (errors.length > 0) throw new AdapterContractError(errors);

  const result = typeof input.capabilityRecord.render === "function"
    ? input.capabilityRecord.render(input)
    : input.capabilityRecord.renderResult ?? {
    files: [],
    registrations: [],
    diagnostics: [],
    ownership: []
  };
  if (result && typeof result.then === "function") throw new AdapterContractError([issue("async-render", "renderSurface requires a synchronous RenderResult", "/capabilityRecord/render")]);
  const validation = validateRenderResult(result);
  if (!validation.valid) throw new AdapterContractError(validation.errors);
  return result;
}
