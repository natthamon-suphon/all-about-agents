const ACTION_KINDS = new Set(["create", "replace", "unchanged", "prune", "reject"]);
const HASH = /^[0-9a-f]{64}$/u;

function validMode(value) {
  return value === undefined || value === null || (Number.isInteger(value) && value >= 0 && value <= 0o777);
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validPath(value) {
  return typeof value === "string" && value.length > 0 && !value.includes("\\") && !value.includes("\0") && !value.startsWith("/") && !/^[A-Za-z]:/u.test(value) && value.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}

export function isPlanAction(value) {
  if (!object(value) || !ACTION_KINDS.has(value.kind) || !validPath(value.relativePath) || typeof value.reason !== "string") return false;
  if (!(value.expectedHash === null || (typeof value.expectedHash === "string" && HASH.test(value.expectedHash)))) return false;
  if (!(value.contentHash === null || (typeof value.contentHash === "string" && HASH.test(value.contentHash)))) return false;
  if (!validMode(value.mode) || !validMode(value.expectedMode)) return false;
  if (value.kind === "create" && (value.expectedHash !== null || value.contentHash === null)) return false;
  if (value.kind === "replace" && (value.expectedHash === null || value.contentHash === null)) return false;
  if (value.kind === "unchanged" && (value.expectedHash === null || value.contentHash === null)) return false;
  if (value.kind === "prune" && (value.expectedHash === null || value.contentHash !== null)) return false;
  return true;
}

export function validateApplyResult(value) {
  if (!object(value) || value.schemaVersion !== 1 || !["complete", "partial", "failed"].includes(value.status)) return false;
  if (!Array.isArray(value.completed) || !value.completed.every(isPlanAction)) return false;
  if (value.failed !== null && !isPlanAction(value.failed)) return false;
  return Array.isArray(value.notAttempted) && value.notAttempted.every(isPlanAction);
}

export function createApplyResult({ status, completed = [], failed = null, notAttempted = [] } = {}) {
  const result = {
    schemaVersion: 1,
    status,
    completed: completed.map((action) => ({ ...action })),
    failed: failed ? { ...failed } : null,
    notAttempted: notAttempted.map((action) => ({ ...action }))
  };
  if (!validateApplyResult(result)) throw new TypeError("invalid ApplyResult");
  return result;
}

export function failedAction(action, reason) {
  if (!isPlanAction(action) || typeof reason !== "string" || reason.length === 0) throw new TypeError("invalid failed PlanAction");
  return { ...action, reason };
}

export function serializeApplyResult(result) {
  if (!validateApplyResult(result)) throw new TypeError("invalid ApplyResult");
  return `${JSON.stringify(result)}\n`;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value instanceof Uint8Array) return [...value];
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

/** Serialize CLI reports with deterministic object-key ordering. */
export function serializeReport(value) {
  return `${JSON.stringify(stableValue(value))}\n`;
}

/** Render a compact, deterministic action table for human CLI output. */
export function formatPlanText(plan) {
  const lines = [`surface=${plan.surface} root=${plan.root}`];
  for (const action of [...plan.actions].sort((left, right) => left.relativePath.localeCompare(right.relativePath) || left.kind.localeCompare(right.kind))) {
    lines.push(`${action.kind}\t${action.relativePath}\t${action.reason}`);
  }
  for (const diagnostic of [...(plan.diagnostics || [])].sort((left, right) => String(left.code).localeCompare(String(right.code)))) {
    lines.push(`diagnostic\t${diagnostic.severity}\t${diagnostic.code}\t${diagnostic.message}`);
  }
  return `${lines.join("\n")}\n`;
}

/** Render already redacted unified-diff records in deterministic order. */
export function formatDiffText(records) {
  const ordered = [...records].sort((left, right) => String(left.surface).localeCompare(String(right.surface)) || String(left.relativePath).localeCompare(String(right.relativePath)));
  if (ordered.length === 0) return "No changes.\n";
  return `${ordered.map((entry) => entry.diff).join("\n")}\n`;
}
