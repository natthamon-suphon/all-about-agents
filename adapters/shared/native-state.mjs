export const NATIVE_PHASES = Object.freeze([
  "rendered",
  "validated",
  "registered",
  "trusted",
  "active",
  "runtimeVerified"
]);

export const NATIVE_STATUSES = Object.freeze([
  "pass",
  "fail",
  "not-run",
  "not-run-unavailable"
]);

const RECORD_KEYS = new Set(["kind", "surface", "feature", "phases", "sourcePath", "manualSteps"]);
const PHASE_KEYS = new Set(["status", "evidence"]);
const SURFACES = new Set(["claude", "codex", "antigravity-2", "agy"]);
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
const SECRET_PATTERNS = [
  /\b(?:sk|pk)-[A-Za-z0-9_-]{16,}/iu,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/iu,
  /\b(?:api[_ -]?key|access[_ -]?token|auth(?:orization)?|password|secret|private[_ -]?key|token)\s*[:=]\s*(?!\[REDACTED\])\S+/iu,
  /-----BEGIN [^-]*PRIVATE KEY-----/iu,
  /(?:[A-Za-z]:\\Users\\|\/(?:Users|home)\/)[^\s"'`]+/iu
];
const NO_TRUST_CONCEPT = /\b(?:has|have|is|are|does|do)\s+no\s+(?:native\s+)?trust(?:\s+(?:concept|step|requirement|state))?\b|\bwithout\s+(?:a\s+)?(?:native\s+)?trust(?:\s+(?:concept|step|requirement|state))?\b|\btrust\s+(?:is\s+)?(?:not\s+applicable|not\s+required)\b/iu;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compareCodePoints(left, right) {
  return left === right ? 0 : left < right ? -1 : 1;
}

function sortedErrors(errors) {
  return [...errors].sort((left, right) => compareCodePoints(left.path, right.path)
    || compareCodePoints(left.code, right.code)
    || compareCodePoints(left.message, right.message));
}

export class NativeStateError {
  constructor(code, message, path = "") {
    this.code = code;
    this.message = message;
    this.path = path;
    Object.freeze(this);
  }
}

function error(code, message, path = "") {
  return new NativeStateError(code, message, path);
}

function hasSecret(value) {
  const publicSafetyExample = value.replaceAll("write_file(/home/user/.ssh)", "[CANONICAL_SSH_DENY]");
  return SECRET_PATTERNS.some((pattern) => pattern.test(publicSafetyExample));
}

function validateEvidence(value, path, errors) {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(error("invalid-evidence", "evidence must be a non-empty summary", path));
    return;
  }
  if (CONTROL_CHARACTER.test(value)) errors.push(error("invalid-evidence", "evidence must not contain control characters", path));
  if (hasSecret(value)) errors.push(error("secret-evidence", "evidence must not contain secrets or private data", path));
}

function validateSourcePath(value, errors) {
  const path = "/sourcePath";
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(error("invalid-source-path", "sourcePath must be a non-empty repository path", path));
    return;
  }
  if (CONTROL_CHARACTER.test(value)) errors.push(error("invalid-source-path", "sourcePath must not contain control characters", path));
  if (value.includes("\\")) errors.push(error("noncanonical-source-path", "sourcePath must use POSIX separators", path));
  if (/^(?:[A-Za-z]:|\/|~|[A-Za-z][A-Za-z0-9+.-]*:)/u.test(value)) {
    errors.push(error("absolute-source-path", "sourcePath must be relative to the repository", path));
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment === ".." || segment === "." || segment.length === 0)) {
    errors.push(error("unsafe-source-path", "sourcePath must not traverse or contain empty path segments", path));
  }
}

function validatePhaseMap(phases, errors) {
  const path = "/phases";
  if (!isObject(phases)) {
    errors.push(error("invalid-phases", "phases must be an object", path));
    return;
  }
  const keys = Object.keys(phases);
  for (const key of keys) {
    if (!NATIVE_PHASES.includes(key)) errors.push(error("unexpected-field", `field ${key} is not a native phase`, `${path}/${key}`));
  }
  for (const phase of NATIVE_PHASES) {
    if (!Object.hasOwn(phases, phase)) {
      errors.push(error("missing-phase", `phase ${phase} is required`, `${path}/${phase}`));
    }
  }
  if (keys.length === NATIVE_PHASES.length && keys.some((phase, index) => phase !== NATIVE_PHASES[index])) {
    errors.push(error("phase-order", "phases must use the fixed native lifecycle order", path));
  }

  for (const phase of NATIVE_PHASES) {
    if (!Object.hasOwn(phases, phase)) continue;
    const phaseRecord = phases[phase];
    const phasePath = `${path}/${phase}`;
    if (!isObject(phaseRecord)) {
      errors.push(error("invalid-phase", "phase must be an object", phasePath));
      continue;
    }
    for (const key of Object.keys(phaseRecord)) {
      if (!PHASE_KEYS.has(key)) errors.push(error("unexpected-field", `field ${key} is not part of a native phase`, `${phasePath}/${key}`));
    }
    if (!Object.hasOwn(phaseRecord, "status")) errors.push(error("missing-field", "status is required", `${phasePath}/status`));
    else if (!NATIVE_STATUSES.includes(phaseRecord.status)) errors.push(error("invalid-status", `status must be one of ${NATIVE_STATUSES.join(", ")}`, `${phasePath}/status`));
    validateEvidence(phaseRecord.evidence, `${phasePath}/evidence`, errors);
    if (phase === "trusted" && phaseRecord.status === "not-run-unavailable" && typeof phaseRecord.evidence === "string" && !NO_TRUST_CONCEPT.test(phaseRecord.evidence)) {
      errors.push(error("trust-evidence", "trusted not-run-unavailable requires explicit evidence that this feature has no trust concept", `${phasePath}/evidence`));
    }
  }

  for (let index = 0; index < NATIVE_PHASES.length; index += 1) {
    const phase = NATIVE_PHASES[index];
    const current = phases[phase];
    if (!isObject(current) || current.status !== "pass") continue;
    const blockedBy = NATIVE_PHASES.slice(0, index).find((earlier) => {
      const earlierRecord = phases[earlier];
      const status = earlierRecord?.status;
      const trustConceptAbsent = earlier === "trusted"
        && status === "not-run-unavailable"
        && typeof earlierRecord.evidence === "string"
        && NO_TRUST_CONCEPT.test(earlierRecord.evidence);
      return status !== "pass" && !trustConceptAbsent;
    });
    if (blockedBy) errors.push(error("state-order", `phase ${phase} cannot pass before ${blockedBy} passes`, `${path}/${phase}/status`));
  }
}

function validateRecord(record) {
  const errors = [];
  if (!isObject(record)) return [error("invalid-record", "native integration record must be an object")];
  for (const key of Object.keys(record)) {
    if (!RECORD_KEYS.has(key)) errors.push(error("unexpected-field", `field ${key} is not part of a native integration record`, `/${key}`));
  }
  for (const key of RECORD_KEYS) {
    if (!Object.hasOwn(record, key)) errors.push(error("missing-field", `field ${key} is required`, `/${key}`));
  }
  if (Object.hasOwn(record, "kind") && record.kind !== "native-integration") errors.push(error("invalid-kind", "kind must be native-integration", "/kind"));
  if (Object.hasOwn(record, "surface") && !SURFACES.has(record.surface)) errors.push(error("invalid-surface", "surface must be a supported native surface", "/surface"));
  if (Object.hasOwn(record, "feature")) {
    if (typeof record.feature !== "string" || record.feature.trim().length === 0) errors.push(error("invalid-feature", "feature must be a non-empty string", "/feature"));
    else if (CONTROL_CHARACTER.test(record.feature)) errors.push(error("invalid-feature", "feature must not contain control characters", "/feature"));
  }
  if (Object.hasOwn(record, "phases")) validatePhaseMap(record.phases, errors);
  if (Object.hasOwn(record, "sourcePath")) validateSourcePath(record.sourcePath, errors);
  if (Object.hasOwn(record, "manualSteps") && !Array.isArray(record.manualSteps)) errors.push(error("invalid-manual-steps", "manualSteps must be an array", "/manualSteps"));
  else if (Object.hasOwn(record, "manualSteps")) {
    record.manualSteps.forEach((step, index) => {
      const path = `/manualSteps/${index}`;
      if (typeof step !== "string" || step.trim().length === 0) errors.push(error("invalid-manual-step", "manual steps must be non-empty strings", path));
      else if (CONTROL_CHARACTER.test(step)) errors.push(error("invalid-manual-step", "manual steps must not contain control characters", path));
      else if (hasSecret(step)) errors.push(error("secret-manual-step", "manual steps must not contain secrets or private data", path));
    });
  }
  return sortedErrors(errors);
}

export function validateNativeIntegrationRecord(record) {
  const errors = validateRecord(record);
  return { valid: errors.length === 0, errors: Object.freeze(errors) };
}

function freezeRecord(record) {
  for (const phase of NATIVE_PHASES) Object.freeze(record.phases[phase]);
  Object.freeze(record.phases);
  Object.freeze(record.manualSteps);
  return Object.freeze(record);
}

export function createNativeIntegrationRecord(input = {}) {
  if (!isObject(input)) throw new TypeError("native integration input must be an object");
  const allowedInputKeys = new Set(["surface", "feature", "phases", "sourcePath", "manualSteps"]);
  const inputErrors = Object.keys(input)
    .filter((key) => !allowedInputKeys.has(key))
    .map((key) => error("unexpected-field", `field ${key} is not part of native integration input`, `/${key}`));
  const phases = isObject(input.phases)
    ? Object.fromEntries([
      ...NATIVE_PHASES.filter((phase) => Object.hasOwn(input.phases, phase)),
      ...Object.keys(input.phases).filter((phase) => !NATIVE_PHASES.includes(phase))
    ].map((phase) => {
      const value = input.phases[phase];
      if (!isObject(value)) return [phase, value];
      const keys = [
        ...["status", "evidence"].filter((key) => Object.hasOwn(value, key)),
        ...Object.keys(value).filter((key) => !PHASE_KEYS.has(key))
      ];
      return [phase, Object.fromEntries(keys.map((key) => [key, value[key]]))];
    }))
    : input.phases;
  const candidate = {
    kind: "native-integration",
    surface: input.surface,
    feature: input.feature,
    phases,
    sourcePath: input.sourcePath,
    manualSteps: input.manualSteps === undefined ? [] : Array.isArray(input.manualSteps) ? [...input.manualSteps] : input.manualSteps
  };
  const validation = validateNativeIntegrationRecord(candidate);
  const errors = sortedErrors([...inputErrors, ...validation.errors]);
  if (errors.length > 0) {
    const failure = new TypeError(`Invalid native integration record: ${errors.map((entry) => `${entry.path || "<root>"} ${entry.code}`).join(", ")}`);
    failure.errors = errors;
    throw failure;
  }
  return freezeRecord(candidate);
}

export function nativeIntegrationStatus(record) {
  const validation = validateNativeIntegrationRecord(record);
  if (!validation.valid) return "fail";
  const statuses = NATIVE_PHASES.map((phase) => record.phases[phase].status);
  if (statuses.includes("fail")) return "fail";
  if (statuses.includes("not-run")) return "not-run";
  if (statuses.includes("not-run-unavailable")) return "not-run-unavailable";
  return "pass";
}
