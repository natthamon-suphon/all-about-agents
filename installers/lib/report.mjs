const ACTION_KINDS = new Set(["create", "replace", "unchanged", "prune", "reject"]);
const HASH = /^[0-9a-f]{64}$/u;

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
