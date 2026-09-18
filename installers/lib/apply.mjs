import { lstat, readFile, unlink } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import { assertSafeDestinationRoot } from "./roots.mjs";
import { hashBytes, SHA256_HEX } from "./hash.mjs";
import { atomicReplaceFile } from "./atomic-write.mjs";
import { mergeManagedState, serializeManagedState, STATE_RELATIVE_PATH, writeManagedState } from "./state.mjs";
import { createApplyResult, failedAction } from "./report.mjs";

const SURFACES = new Set(["claude", "codex"]);
const PROFILES = new Set(["portable", "template"]);
const ACTION_KINDS = new Set(["create", "replace", "unchanged", "prune", "reject"]);
const CONTENT_KINDS = new Set(["create", "replace", "unchanged"]);
const WRITE_KINDS = new Set(["create", "replace"]);
const PREPARED_SURFACES = new WeakMap();

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

function validMode(value) {
  return value === undefined || value === null || (Number.isInteger(value) && value >= 0 && value <= 0o777);
}

function validAction(action) {
  if (!object(action) || !ACTION_KINDS.has(action.kind) || !safeRelativePath(action.relativePath) || typeof action.reason !== "string") return false;
  if (!(action.expectedHash === null || (typeof action.expectedHash === "string" && SHA256_HEX.test(action.expectedHash)))) return false;
  if (!(action.contentHash === null || (typeof action.contentHash === "string" && SHA256_HEX.test(action.contentHash)))) return false;
  if (!validMode(action.mode) || !validMode(action.expectedMode)) return false;
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
  return { kind, relativePath, expectedHash, contentHash, mode: null, expectedMode: null, reason };
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
    if (process.platform !== "win32" && action.expectedMode !== undefined && action.expectedMode !== null && observed.stats?.mode !== undefined && (observed.stats.mode & 0o777) !== action.expectedMode) return "destination mode changed after planning";
  }
  return null;
}

async function validatePreconditions({ plan, actions, contents, fileSystem }) {
  try {
    assertSafeDestinationRoot(plan.root, { allowedProductRoots: [plan.root] });
  } catch (error) {
    return { action: actions[0] || failure(STATE_RELATIVE_PATH, "destination root is unsafe"), reason: `destination root is unsafe: ${error.message}` };
  }

  if (Object.hasOwn(fileSystem, "previousState")) {
    const stateTarget = safeTarget(plan.root, STATE_RELATIVE_PATH);
    const observedState = await inspectTarget(stateTarget, fileSystem);
    const previousState = fileSystem.previousState ?? null;
    let stateChanged = false;
    if (previousState === null) stateChanged = observedState.kind !== "missing";
    else {
      try {
        stateChanged = observedState.kind !== "file" || hashBytes(observedState.bytes) !== hashBytes(serializeManagedState(previousState));
      } catch {
        stateChanged = true;
      }
    }
    if (stateChanged) return { action: failure(STATE_RELATIVE_PATH, "managed state changed after planning"), reason: "managed state changed after planning" };
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
      assertSafeDestinationRoot(dirname(target), { allowedProductRoots: [plan.root] });
    } catch (error) {
      return { action, reason: error.message };
    }
    const observed = await inspectTarget(target, fileSystem);
    const reason = expectedPrecondition(action, observed);
    if (reason) return { action, reason };
  }
  try {
    assertSafeDestinationRoot(resolve(plan.root, ".all-about-agents"), { allowedProductRoots: [plan.root] });
  } catch (error) {
    return { action: actions[0] || failure(STATE_RELATIVE_PATH, "managed state directory is unsafe"), reason: `managed state directory is unsafe: ${error.message}` };
  }
  return null;
}

async function applyAction({ plan, action, contents, fileSystem }) {
  const target = safeTarget(plan.root, action.relativePath);
  assertSafeDestinationRoot(dirname(target), { allowedProductRoots: [plan.root] });
  if (WRITE_KINDS.has(action.kind)) {
    const value = contents(action.relativePath);
    await atomicReplaceFile({ destination: target, content: value, expectedHash: action.contentHash, mode: action.mode ?? null, allowedProductRoots: [plan.root], fileSystem });
  } else if (action.kind === "prune") {
    const remove = operation(fileSystem, "unlink", unlink);
    await remove(target);
    assertSafeDestinationRoot(dirname(target), { allowedProductRoots: [plan.root] });
    const observed = await inspectTarget(target, fileSystem);
    if (observed.kind !== "missing") throw new Error("pruned destination still exists");
  } else if (action.kind === "reject") {
    throw new Error(action.reason || "plan action rejected");
  }
}

function stateFailureAction(error) {
  return failure(STATE_RELATIVE_PATH, `managed state write failed: ${error.message}`, "reject", null, null);
}

function operationSurface(entry, action) {
  const selected = Array.isArray(entry?.selectedSurfaces) ? entry.selectedSurfaces : [];
  if (selected.length > 1 && typeof action?.relativePath === "string") {
    const namespaced = selected.find((surface) => action.relativePath.startsWith(`${surface}/`));
    if (namespaced) return namespaced;
  }
  return entry?.surface || entry?.plan?.surface || null;
}

function operationError(entry, reason, action = null, code = "preflight-failed") {
  return Object.freeze({
    code,
    surface: operationSurface(entry, action),
    root: entry?.plan?.root || entry?.root || null,
    relativePath: action?.relativePath || null,
    message: reason,
    action: action ? Object.freeze({ ...action }) : null
  });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function validatePlanShape(plan) {
  if (!object(plan) || plan.schemaVersion !== 1 || !SURFACES.has(plan.surface) || typeof plan.root !== "string" || !isAbsolute(plan.root) || !Array.isArray(plan.actions) || !Array.isArray(plan.diagnostics)) {
    throw new TypeError("plan must be a schemaVersion 1 InstallPlan");
  }
  const actions = plan.actions.map((action) => ({ ...action, mode: action.mode ?? null, expectedMode: action.expectedMode ?? null }));
  const seen = new Set();
  if (actions.some((action) => !validAction(action) || seen.has(action.relativePath) || (seen.add(action.relativePath) && false))) {
    throw new TypeError("plan actions must be unique valid PlanAction values");
  }
  const diagnosticFailure = plan.diagnostics.find((diagnostic) => !object(diagnostic) || typeof diagnostic.code !== "string" || !["error", "warning", "info"].includes(diagnostic.severity) || typeof diagnostic.message !== "string" || diagnostic.severity === "error");
  if (diagnosticFailure) {
    const reason = diagnosticFailure.severity === "error" ? `plan contains error diagnostic: ${diagnosticFailure.message}` : "plan diagnostic is malformed";
    return { actions, failure: { action: actions[0] || failure(STATE_RELATIVE_PATH, reason), reason } };
  }
  const reserved = actions.find((action) => action.relativePath === STATE_RELATIVE_PATH);
  if (reserved) return { actions, failure: { action: reserved, reason: "state path is reserved for managed state" } };
  return { actions, failure: null };
}

function fileSystemForEntry(entry, fileSystemByRoot) {
  const root = entry?.plan?.root;
  const mapped = fileSystemByRoot.get(root);
  if (mapped !== undefined) return mapped;
  if (object(entry?.fileSystem)) return entry.fileSystem;
  return {
    contents: entry?.contents,
    repositoryVersion: entry?.repositoryVersion,
    profile: entry?.profile,
    surfaces: entry?.selectedSurfaces,
    previousState: entry?.previousState ?? null
  };
}

function clonedFileSystem(fileSystem, actions, contents) {
  const exactContents = new Map();
  for (const action of actions) {
    if (!CONTENT_KINDS.has(action.kind)) continue;
    exactContents.set(action.relativePath, new Uint8Array(contents(action.relativePath)));
  }
  return Object.freeze({ ...fileSystem, contents: exactContents });
}

/**
 * Validate every selected surface before returning any apply capability.
 * Exact content bytes stay in a private WeakMap so callers cannot mutate a
 * prepared surface between operation preflight and apply.
 */
export async function preflightOperation({ entries, fileSystemByRoot = new Map() } = {}) {
  if (!Array.isArray(entries) || entries.length === 0) throw new TypeError("entries must be a non-empty array");
  if (!(fileSystemByRoot instanceof Map)) throw new TypeError("fileSystemByRoot must be a Map");
  const errors = [];
  const roots = new Map();
  for (const entry of entries) {
    const root = entry?.plan?.root;
    const key = typeof root === "string" ? (process.platform === "win32" ? resolve(root).toLowerCase() : resolve(root)) : String(root);
    if (roots.has(key)) errors.push(operationError(entry, `duplicate destination root also selected by ${roots.get(key)}`, null, "duplicate-destination-root"));
    else roots.set(key, entry?.surface || entry?.plan?.surface || "unknown");
  }
  if (errors.length > 0) return Object.freeze({ valid: false, prepared: Object.freeze([]), errors: Object.freeze(errors) });

  const candidates = [];
  for (const entry of entries) {
    try {
      if (!object(entry) || !object(entry.plan) || (entry.root !== undefined && resolve(entry.root) !== resolve(entry.plan.root)) || (entry.surface !== undefined && entry.surface !== entry.plan.surface)) {
        throw new TypeError("entry surface and root must match its plan");
      }
      const fileSystem = fileSystemForEntry(entry, fileSystemByRoot);
      if (!object(fileSystem) || Array.isArray(fileSystem)) throw new TypeError("fileSystem must be an object");
      const normalized = validatePlanShape(entry.plan);
      if (normalized.failure) {
        errors.push(operationError(entry, normalized.failure.reason, normalized.failure.action));
        continue;
      }
      const contents = contentMap(fileSystem);
      const stateMetadata = metadata(fileSystem, entry.plan);
      try {
        mergeManagedState({
          ...stateMetadata,
          completed: normalized.actions.filter((action) => CONTENT_KINDS.has(action.kind)),
          previousState: fileSystem.previousState ?? null
        });
      } catch (error) {
        errors.push(operationError(entry, `managed state merge rejected before mutation: ${error.message}`, normalized.actions[0] || null));
        continue;
      }
      const failed = await validatePreconditions({ plan: entry.plan, actions: normalized.actions, contents, fileSystem });
      if (failed) {
        errors.push(operationError(entry, failed.reason, failed.action));
        continue;
      }
      const plan = deepFreeze(structuredClone({ ...entry.plan, actions: normalized.actions }));
      const prepared = deepFreeze({
        surface: entry.surface || plan.surface,
        root: plan.root,
        plan,
        stateMetadata: { ...stateMetadata },
        contentHashes: normalized.actions.filter((action) => CONTENT_KINDS.has(action.kind)).map((action) => ({ relativePath: action.relativePath, sha256: action.contentHash })),
        preconditions: normalized.actions.map((action) => ({ relativePath: action.relativePath, kind: action.kind, expectedHash: action.expectedHash, expectedMode: action.expectedMode }))
      });
      PREPARED_SURFACES.set(prepared, { plan, fileSystem: clonedFileSystem(fileSystem, normalized.actions, contents) });
      candidates.push(prepared);
    } catch (error) {
      errors.push(operationError(entry, error.message, null, error.code || "invalid-preflight-entry"));
    }
  }
  if (errors.length > 0) return Object.freeze({ valid: false, prepared: Object.freeze([]), errors: Object.freeze(errors) });
  return Object.freeze({ valid: true, prepared: Object.freeze(candidates), errors: Object.freeze([]) });
}

/** Apply only a surface created by preflightOperation; applyPlan rechecks live paths. */
export async function applyPreparedSurface(prepared) {
  const data = PREPARED_SURFACES.get(prepared);
  if (!data) throw new TypeError("prepared must come from a successful preflightOperation call");
  return applyPlan(data);
}

/**
 * Apply a validated InstallPlan with no transaction-wide rollback.
 *
 * The exact master-plan fileSystem object is also the content seam: `contents`
 * is a Map or null-prototype/object mapping every create/replace/unchanged
 * relativePath to its exact Uint8Array. It additionally supplies the required
 * repositoryVersion, profile, and surfaces metadata. Optional standard
 * fs/promises-compatible methods (lstat, readFile, mkdir, writeFile, rename,
 * unlink, chmod) are accepted for disposable failure injection.
 */
export async function applyPlan({ plan, fileSystem } = {}) {
  if (!object(fileSystem) || Array.isArray(fileSystem)) throw new TypeError("fileSystem must be an object");
  const normalized = validatePlanShape(plan);
  const actions = normalized.actions;
  if (normalized.failure) return resultForFailure(actions, Math.max(0, actions.indexOf(normalized.failure.action)), normalized.failure.action, normalized.failure.reason);
  const contents = contentMap(fileSystem);
  let stateMetadata;
  try {
    stateMetadata = metadata(fileSystem, plan);
  } catch (error) {
    const action = actions[0] || failure(STATE_RELATIVE_PATH, error.message);
    return resultForFailure(actions, 0, action, `managed state metadata rejected before mutation: ${error.message}`);
  }

  let nextState;
  try {
    nextState = mergeManagedState({
      ...stateMetadata,
      completed: actions.filter((action) => CONTENT_KINDS.has(action.kind)),
      previousState: fileSystem.previousState ?? null
    });
  } catch (error) {
    const action = actions[0] || failure(STATE_RELATIVE_PATH, error.message);
    return resultForFailure(actions, 0, action, `managed state merge rejected before mutation: ${error.message}`);
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

  try {
    await writeManagedState({ root: plan.root, state: nextState, fileSystem, relativePath: STATE_RELATIVE_PATH });
  } catch (error) {
    return createApplyResult({ status: completed.length === 0 ? "failed" : "partial", completed, failed: stateFailureAction(error), notAttempted: [] });
  }
  return createApplyResult({ status: "complete", completed, failed: null, notAttempted: [] });
}

export { STATE_RELATIVE_PATH };
