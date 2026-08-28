import { createHash } from "node:crypto";

export const SURFACES = Object.freeze(["claude", "codex", "antigravity-2", "agy"]);
export const ACTION_IDS = Object.freeze([
  "aaa:design",
  "aaa:build",
  "aaa:fix",
  "aaa:review",
  "aaa:audit",
  "aaa:improve-skill",
  "aaa:resume",
  "aaa:verify"
]);

const COMMAND_KEYS = new Set(["$schema", "id", "actionId", "workflowId", "arguments", "result", "presentation"]);
const EMBEDDED_WORKFLOW_KEYS = new Set([
  "states", "transitions", "gates", "recovery", "successCriteria", "stopCondition", "durableOutput", "steps", "workflowStates"
]);
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

function hasEmbeddedWorkflow(value, path = "") {
  if (Array.isArray(value)) return value.some((item, index) => hasEmbeddedWorkflow(item, `${path}/${index}`));
  if (!isObject(value)) return false;
  for (const [key, child] of Object.entries(value)) {
    if (EMBEDDED_WORKFLOW_KEYS.has(key)) return true;
    if (hasEmbeddedWorkflow(child, `${path}/${key}`)) return true;
  }
  return false;
}

function validateSchemaObject(value, path, errors, name) {
  if (!isObject(value)) {
    errors.push(issue("missing-schema", `${name} must be an object schema`, path));
    return;
  }
  if (value.type !== "object") errors.push(issue("invalid-schema", `${name}.type must be object`, `${path}/type`));
  if (!isObject(value.properties)) errors.push(issue("invalid-schema", `${name}.properties must be an object`, `${path}/properties`));
  if (!Array.isArray(value.required)) errors.push(issue("invalid-schema", `${name}.required must be an array`, `${path}/required`));
  if (value.additionalProperties !== false) errors.push(issue("invalid-schema", `${name}.additionalProperties must be false`, `${path}/additionalProperties`));
}

function workflowSet(workflows) {
  if (workflows === undefined || workflows === null) return null;
  if (workflows instanceof Set) return new Set(workflows);
  if (!Array.isArray(workflows)) return new Set();
  return new Set(workflows.map((workflow) => typeof workflow === "string" ? workflow : workflow?.id).filter((id) => typeof id === "string"));
}

/** Validate thin canonical command records at the core/adapter seam. */
export function validateCommandRecords(records, workflows) {
  const errors = [];
  if (!Array.isArray(records)) return { valid: false, errors: [issue("invalid-commands", "commands must be an array")] };
  const knownWorkflows = workflowSet(workflows);
  const ids = new Map();
  const actionIds = new Map();
  records.forEach((record, index) => {
    const path = `/commands/${index}`;
    if (!isObject(record)) {
      errors.push(issue("invalid-command", "command must be an object", path));
      return;
    }
    checkObjectKeys(record, COMMAND_KEYS, path, errors);
    if (typeof record.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/u.test(record.id)) errors.push(issue("invalid-command-id", "id must be kebab-case", `${path}/id`));
    else if (ids.has(record.id)) errors.push(issue("duplicate-command-id", `duplicate id ${record.id}`, `${path}/id`));
    else ids.set(record.id, index);
    if (typeof record.actionId !== "string" || !/^aaa:[a-z0-9][a-z0-9-]*$/u.test(record.actionId)) errors.push(issue("invalid-action-id", "actionId must use the aaa: prefix", `${path}/actionId`));
    else if (!ACTION_IDS.includes(record.actionId)) errors.push(issue("unknown-action", `unknown canonical action ${record.actionId}`, `${path}/actionId`));
    else if (actionIds.has(record.actionId)) errors.push(issue("duplicate-action-id", `duplicate actionId ${record.actionId}`, `${path}/actionId`));
    else actionIds.set(record.actionId, index);
    if (typeof record.workflowId !== "string" || record.workflowId.length === 0) errors.push(issue("missing-workflow", "workflowId is required", `${path}/workflowId`));
    else if (knownWorkflows && !knownWorkflows.has(record.workflowId)) errors.push(issue("unknown-workflow", `workflowId ${record.workflowId} is not declared`, `${path}/workflowId`));
    validateSchemaObject(record.arguments, `${path}/arguments`, errors, "arguments");
    validateSchemaObject(record.result, `${path}/result`, errors, "result");
    if (!isObject(record.presentation)) errors.push(issue("missing-presentation", "presentation hints are required", `${path}/presentation`));
    else checkObjectKeys(record.presentation, new Set(["label", "help"]), `${path}/presentation`, errors);
    if (hasEmbeddedWorkflow(record)) errors.push(issue("embedded-workflow", "command records must dispatch a workflow, not embed workflow logic", path));
  });
  for (const actionId of ACTION_IDS) if (!actionIds.has(actionId)) errors.push(issue("missing-action", `missing canonical action ${actionId}`, "/commands"));
  return { valid: errors.length === 0, errors: sortedErrors(errors) };
}

function mappingEntries(capabilityRecord) {
  const field = ["actionMappings", "nativeMappings", "commandMappings", "mappings"].find((key) => Object.hasOwn(capabilityRecord, key));
  if (!field) return null;
  const value = capabilityRecord[field];
  if (Array.isArray(value)) return value.map((entry) => [entry?.actionId ?? entry?.id, entry]);
  if (isObject(value)) return Object.entries(value);
  return [];
}

function mappingTarget(mapping) {
  if (typeof mapping === "string") return mapping.trim().length > 0 ? mapping : null;
  if (!isObject(mapping)) return null;
  for (const key of ["native", "target", "value", "command", "name"]) {
    if (typeof mapping[key] === "string" && mapping[key].trim().length > 0) return mapping[key];
  }
  return null;
}

function hasMappingTargetField(mapping) {
  return isObject(mapping) && ["native", "target", "value", "command", "name"].some((key) => Object.hasOwn(mapping, key));
}

/** Validate the required semantic-action to native-action mapping. */
export function validateNativeMappings(capabilityRecord, requiredActionIds = ACTION_IDS) {
  const errors = [];
  const diagnostics = [];
  if (!isObject(capabilityRecord)) return { valid: false, errors: [issue("missing-capability-record", "capabilityRecord must be an object")] };
  if (!Array.isArray(requiredActionIds) || requiredActionIds.length === 0) {
    errors.push(issue("invalid-required-mappings", "requiredMappings must be a non-empty approved action subset", "/capabilityRecord/requiredMappings"));
    return { valid: false, errors: sortedErrors(errors), diagnostics };
  }
  const invalidRequiredType = requiredActionIds.some((actionId) => typeof actionId !== "string");
  if (invalidRequiredType) errors.push(issue("invalid-required-mappings", "requiredMappings entries must be canonical action ID strings", "/capabilityRecord/requiredMappings"));
  const uniqueRequired = new Set(requiredActionIds);
  if (uniqueRequired.size !== requiredActionIds.length) errors.push(issue("invalid-required-mappings", "requiredMappings must not contain duplicates", "/capabilityRecord/requiredMappings"));
  for (const actionId of requiredActionIds) if (!ACTION_IDS.includes(actionId)) errors.push(issue("invalid-required-mappings", `requiredMappings contains unknown action ${String(actionId)}`, "/capabilityRecord/requiredMappings"));
  const entries = mappingEntries(capabilityRecord);
  const byAction = new Map();
  for (const [actionId, mapping] of entries ?? []) {
    if (typeof actionId !== "string") {
      errors.push(issue("invalid-native-mapping", "mapping must name an actionId", "/capabilityRecord/mappings"));
      continue;
    }
    if (!ACTION_IDS.includes(actionId)) {
      errors.push(issue("unknown-native-mapping", `mapping names unknown action ${actionId}`, `/capabilityRecord/mappings/${actionId}`));
      continue;
    }
    if (byAction.has(actionId)) errors.push(issue("duplicate-native-mapping", `duplicate mapping for ${actionId}`, `/capabilityRecord/mappings/${actionId}`));
    byAction.set(actionId, mapping);
  }
  const required = Array.isArray(requiredActionIds) ? requiredActionIds : ACTION_IDS;
  for (const actionId of required) {
    if (!ACTION_IDS.includes(actionId)) {
      errors.push(issue("unknown-native-mapping", `required mapping names unknown action ${actionId}`, "/capabilityRecord/requiredMappings"));
      continue;
    }
    const mapping = byAction.get(actionId);
    if (mapping === undefined) {
      errors.push(issue("missing-native-mapping", `required action ${actionId} has no native mapping`, `/capabilityRecord/mappings/${actionId}`));
      continue;
    }
    const supported = typeof mapping === "string" || (isObject(mapping) && (mapping.supported === true || mapping.support === "supported"));
    if (!supported) errors.push(issue("unsupported-native-mapping", `required action ${actionId} is unsupported by this surface`, `/capabilityRecord/mappings/${actionId}`));
    if (supported && mappingTarget(mapping) === null) {
      const code = hasMappingTargetField(mapping) || typeof mapping === "string" ? "invalid-native-target" : "missing-native-mapping";
      errors.push(issue(code, `required action ${actionId} has no non-empty native target`, `/capabilityRecord/mappings/${actionId}`));
    }
  }
  for (const actionId of ACTION_IDS) if (!required.includes(actionId)) diagnostics.push({
    code: "native-mapping-not-required",
    severity: "warning",
    message: `native mapping for ${actionId} was not required by this approved subset`,
    sourcePath: null
  });
  return { valid: errors.length === 0, errors: sortedErrors(errors), diagnostics };
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
  for (const key of ["inventory", "rules", "roles", "skills", "workflows", "commands", "evals"]) {
    if (!Object.hasOwn(core, key)) errors.push(issue("invalid-core", `core.${key} is required`, `/core/${key}`));
    else if (key !== "inventory" && !Array.isArray(core[key])) errors.push(issue("invalid-core", `core.${key} must be an array`, `/core/${key}`));
  }
  return errors;
}

/** Validate and return one adapter's deterministic render result. */
export function renderSurface(input) {
  const errors = [];
  let mappingDiagnostics = [];
  if (!isObject(input)) throw new AdapterContractError([issue("invalid-input", "renderSurface input must be an object")]);
  if (!SURFACES.includes(input.surface)) errors.push(issue("invalid-surface", `unsupported surface ${String(input.surface)}`, "/surface"));
  errors.push(...coreShapeErrors(input.core));
  if (!isObject(input.profile)) errors.push(issue("invalid-profile", "profile must be an object", "/profile"));
  if (typeof input.statuslineName !== "string") errors.push(issue("invalid-statusline-name", "statuslineName must be a string", "/statuslineName"));
  if (!isObject(input.capabilityRecord)) errors.push(issue("missing-capability-record", "capabilityRecord must be an object", "/capabilityRecord"));
  else {
    if (input.capabilityRecord.surface !== undefined && input.capabilityRecord.surface !== input.surface) errors.push(issue("surface-mismatch", "capabilityRecord.surface must match surface", "/capabilityRecord/surface"));
    const requiredMappings = Object.hasOwn(input.capabilityRecord, "requiredMappings")
      ? input.capabilityRecord.requiredMappings
      : ACTION_IDS;
    const mappingValidation = validateNativeMappings(input.capabilityRecord, requiredMappings);
    errors.push(...mappingValidation.errors);
    mappingDiagnostics = mappingValidation.diagnostics;
  }
  if (isObject(input.core) && Array.isArray(input.core.commands)) {
    errors.push(...validateCommandRecords(input.core.commands, input.core.workflows).errors);
  }
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
  if (mappingDiagnostics.length === 0) return result;
  const withDiagnostics = { ...result, diagnostics: [...mappingDiagnostics, ...result.diagnostics] };
  const finalValidation = validateRenderResult(withDiagnostics);
  if (!finalValidation.valid) throw new AdapterContractError(finalValidation.errors);
  return withDiagnostics;
}
