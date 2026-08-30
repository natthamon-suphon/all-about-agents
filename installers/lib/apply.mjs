import { lstat, readFile, unlink } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import { assertSafeDestinationRoot } from "./roots.mjs";
import { hashBytes, SHA256_HEX } from "./hash.mjs";
import { atomicReplaceFile } from "./atomic-write.mjs";
import { buildManagedState, STATE_RELATIVE_PATH, writeManagedState } from "./state.mjs";
import { createApplyResult, failedAction } from "./report.mjs";

const SURFACES = new Set(["claude", "codex", "antigravity-2", "agy"]);
const PROFILES = new Set(["portable", "template"]);
const ACTION_KINDS = new Set(["create", "replace", "unchanged", "prune", "reject"]);
const CONTENT_KINDS = new Set(["create", "replace", "unchanged"]);
const WRITE_KINDS = new Set(["create", "replace"]);

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeRelativePath(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\") || value.includes("\0") || value.startsWith("/") || /^[A-Za-z]:/u.test(value)) return false;
  return value.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}

function safeTarget(root, relativePath) {
  const target = resolve(root, ...relativePath.split("/"));
  const suffix = relative(root, target);
  if (isAbsolute(suffix) || suffix === ".." || suffix.startsWith(`..${"/"}`) || suffix.startsWith(`..${"\\"}`)) throw new TypeError(`destination escapes selected root: ${relativePath}`);
  return target;
}

function validAction(action) {
  if (!object(action) || !ACTION_KINDS.has(action.kind) || !safeRelativePath(action.relativePath) || typeof action.reason !== "string") return false;
  if (!(action.expectedHash === null || (typeof action.expectedHash === "string" && SHA256_HEX.test(action.expectedHash)))) return false;
  if (!(action.contentHash === null || (typeof action.contentHash === "string" && SHA256_HEX.test(action.contentHash)))) return false;
  if (action.kind === "create" && (action.expectedHash !== null || action.contentHash === null)) return false;
  if (action.kind === "replace" && (action.expectedHash === null || action.contentHash === null)) return false;
  if (action.kind === "unchanged" && (action.expectedHash === null || action.contentHash === null)) return false;
  if (action.kind === "prune" && (action.expectedHash === null || action.contentHash !== null)) return false;
  return true;
}

function operation(fileSystem, name, fallback) {
  const candidate = fileSystem?.[name];
  return typeof candidate === "function" ? candidate.bind(fileSystem) : fallback;
}

function failure(relativePath, reason, kind = "reject", expectedHash = null, contentHash = null) {
  return { kind, relativePath, expectedHash, contentHash, reason };
}

function resultForFailure(actions, index, action, reason) {
  return createApplyResult({
    status: "failed",
    completed: [],
    failed: failedAction(validAction(action) ? action : failure(action?.relativePath || STATE_RELATIVE_PATH, reason), reason),
    // Preflight failures happen before any action is attempted, including
    // actions that sort before the failed precondition.
    notAttempted: actions.filter((_, actionIndex) => actionIndex !== index)
  });
}

function metadata(fileSystem, plan) {
  const repositoryVersion = fileSystem.repositoryVersion;
  const profile = fileSystem.profile;
  const surfaces = fileSystem.surfaces;
  if (typeof repositoryVersion !== "string" || repositoryVersion.trim() === "" || repositoryVersion.includes("\0")) throw new TypeError("fileSystem.repositoryVersion must be a non-empty string");
  if (typeof profile !== "string" || !PROFILES.has(profile)) throw new TypeError("fileSystem.profile must be portable or template");
  if (!Array.isArray(surfaces) || surfaces.length === 0 || surfaces.some((surface) => typeof surface !== "string" || !SURFACES.has(surface)) || new Set(surfaces).size !== surfaces.length || !surfaces.includes(plan.surface)) {
    throw new TypeError("fileSystem.surfaces must be unique supported surfaces including plan.surface");
  }
  return { repositoryVersion, profile, surfaces: [...surfaces].sort() };
}

function contentMap(fileSystem) {
  const contents = fileSystem.contents;
  if (contents instanceof Map) return (relativePath) => contents.get(relativePath);
  if (object(contents)) return (relativePath) => Object.hasOwn(contents, relativePath) ? contents[relativePath] : undefined;
  throw new TypeError("fileSystem.contents must be a Map or object keyed by relativePath");
}

async function inspectTarget(target, fileSystem) {
  const inspect = operation(fileSystem, "lstat", lstat);
  try {
    const stats = await inspect(target);
    if (stats.isSymbolicLink()) return { kind: "symlink", stats, bytes: null };
    if (!stats.isFile()) return { kind: "not-file", stats, bytes: null };
    const read = operation(fileSystem, "readFile", readFile);
    const raw = await read(target);
    const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    return { kind: "file", stats, bytes };
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return { kind: "missing", stats: null, bytes: null };
    return { kind: "error", stats: null, bytes: null, error };
  }
}

function expectedPrecondition(action, observed) {
  if (action.kind === "create") {
    return observed.kind === "missing" ? null : "create destination appeared or is not writable as a new file";
  }
  if (["replace", "unchanged", "prune"].includes(action.kind)) {
    if (observed.kind === "missing") return "destination disappeared after planning";
    if (observed.kind === "symlink") return "destination is a symlink or junction";
    if (observed.kind === "not-file") return "destination is not a regular file";
    if (observed.kind === "error") return `destination cannot be read: ${observed.error.message}`;
    const expected = action.kind === "replace" || action.kind === "prune" ? action.expectedHash : action.contentHash;
    if (hashBytes(observed.bytes) !== expected) return "destination bytes changed after planning";
  }
  return null;
}

async function validatePreconditions({ plan, actions, contents, fileSystem }) {
  try {
    assertSafeDestinationRoot(plan.root);
  } catch (error) {
    return { action: actions[0] || failure(STATE_RELATIVE_PATH, "destination root is unsafe"), reason: `destination root is unsafe: ${error.message}` };
  }

  const contentFailures = [];
  for (const action of actions) {
    if (!CONTENT_KINDS.has(action.kind)) continue;
    let value;
    try {
      value = contents(action.relativePath);
      if (!(value instanceof Uint8Array)) throw new TypeError("content must be a Uint8Array");
      if (hashBytes(value) !== action.contentHash) throw new Error("content hash does not match plan");
    } catch (error) {
      contentFailures.push({ action, reason: `rendered content rejected before mutation: ${error.message}` });
    }
  }
  if (contentFailures.length > 0) return contentFailures[0];

  for (const action of actions) {
    if (action.kind === "reject") return { action, reason: `plan rejected before mutation: ${action.reason}` };
    let target;
    try {
      target = safeTarget(plan.root, action.relativePath);
      assertSafeDestinationRoot(dirname(target));
    } catch (error) {
      return { action, reason: error.message };
    }
    const observed = await inspectTarget(target, fileSystem);
    const reason = expectedPrecondition(action, observed);
    if (reason) return { action, reason };
  }
  try {
    assertSafeDestinationRoot(resolve(plan.root, ".all-about-agents"));
  } catch (error) {
    return { action: actions[0] || failure(STATE_RELATIVE_PATH, "managed state directory is unsafe"), reason: `managed state directory is unsafe: ${error.message}` };
  }
  return null;
}

async function applyAction({ plan, action, contents, fileSystem }) {
  const target = safeTarget(plan.root, action.relativePath);
  assertSafeDestinationRoot(dirname(target));
  if (WRITE_KINDS.has(action.kind)) {
    const value = contents(action.relativePath);
    await atomicReplaceFile({ destination: target, content: value, expectedHash: action.contentHash, fileSystem });
  } else if (action.kind === "prune") {
    const remove = operation(fileSystem, "unlink", unlink);
    await remove(target);
    assertSafeDestinationRoot(dirname(target));
    const observed = await inspectTarget(target, fileSystem);
    if (observed.kind !== "missing") throw new Error("pruned destination still exists");
  } else if (action.kind === "reject") {
    throw new Error(action.reason || "plan action rejected");
  }
}

function stateFailureAction(error) {
  return failure(STATE_RELATIVE_PATH, `managed state write failed: ${error.message}`, "reject", null, null);
}

/**
 * Apply a validated InstallPlan with no transaction-wide rollback.
 *
 * The exact master-plan fileSystem object is also the content seam: `contents`
 * is a Map or null-prototype/object mapping every create/replace/unchanged
 * relativePath to its exact Uint8Array. It additionally supplies the required
 * repositoryVersion, profile, and surfaces metadata. Optional standard
 * fs/promises-compatible methods (lstat, readFile, mkdir, writeFile, rename,
 * unlink) are accepted for disposable failure injection.
 */
export async function applyPlan({ plan, fileSystem } = {}) {
  if (!object(plan) || plan.schemaVersion !== 1 || !SURFACES.has(plan.surface) || typeof plan.root !== "string" || !isAbsolute(plan.root) || !Array.isArray(plan.actions) || !Array.isArray(plan.diagnostics)) {
    throw new TypeError("plan must be a schemaVersion 1 InstallPlan");
  }
  if (!object(fileSystem) || Array.isArray(fileSystem)) throw new TypeError("fileSystem must be an object");
  const actions = plan.actions.map((action) => ({ ...action }));
  const seen = new Set();
  if (actions.some((action) => !validAction(action) || seen.has(action.relativePath) || (seen.add(action.relativePath) && false))) {
    throw new TypeError("plan actions must be unique valid PlanAction values");
  }
  const diagnosticFailure = plan.diagnostics.find((diagnostic) => !object(diagnostic) || typeof diagnostic.code !== "string" || !["error", "warning", "info"].includes(diagnostic.severity) || typeof diagnostic.message !== "string" || (diagnostic.severity === "error"));
  if (diagnosticFailure) {
    const action = actions[0] || failure(STATE_RELATIVE_PATH, "plan diagnostics rejected before mutation");
    const reason = diagnosticFailure.severity === "error" ? `plan contains error diagnostic: ${diagnosticFailure.message}` : "plan diagnostic is malformed";
    return resultForFailure(actions, 0, action, reason);
  }
  if (actions.some((action) => action.relativePath === STATE_RELATIVE_PATH)) {
    const action = actions.find((candidate) => candidate.relativePath === STATE_RELATIVE_PATH);
    return resultForFailure(actions, actions.indexOf(action), action, "state path is reserved for managed state");
  }
  const contents = contentMap(fileSystem);
  let stateMetadata;
  try {
    stateMetadata = metadata(fileSystem, plan);
  } catch (error) {
    const action = actions[0] || failure(STATE_RELATIVE_PATH, error.message);
    return resultForFailure(actions, 0, action, `managed state metadata rejected before mutation: ${error.message}`);
  }

  const preflightFailure = await validatePreconditions({ plan, actions, contents, fileSystem });
  if (preflightFailure) {
    const index = Math.max(0, actions.indexOf(preflightFailure.action));
    return resultForFailure(actions, index, preflightFailure.action, preflightFailure.reason);
  }

  const completed = [];
  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index];
    try {
      await applyAction({ plan, action, contents, fileSystem });
      completed.push(action);
    } catch (error) {
      return createApplyResult({ status: completed.length === 0 ? "failed" : "partial", completed, failed: failedAction(action, `apply failed: ${error.message}`), notAttempted: actions.slice(index + 1) });
    }
  }

  const state = buildManagedState({
    ...stateMetadata,
    ownedPaths: completed.filter((action) => CONTENT_KINDS.has(action.kind)).map((action) => ({ relativePath: action.relativePath, sha256: action.contentHash }))
  });
  try {
    await writeManagedState({ root: plan.root, state, fileSystem, relativePath: STATE_RELATIVE_PATH });
  } catch (error) {
    return createApplyResult({ status: completed.length === 0 ? "failed" : "partial", completed, failed: stateFailureAction(error), notAttempted: [] });
  }
  return createApplyResult({ status: "complete", completed, failed: null, notAttempted: [] });
}

export { STATE_RELATIVE_PATH };
