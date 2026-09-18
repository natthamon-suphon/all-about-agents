import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { hashBytes, SHA256_HEX } from "./hash.mjs";
import { assertSafeDestinationRoot } from "./roots.mjs";
import { parseManagedState } from "./state.mjs";

const SURFACES = new Set(["claude", "codex"]);
const ACTION_KINDS = new Set(["create", "replace", "unchanged", "prune", "reject"]);
const DEFAULT_FILE_MODE = 0o600;

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compare(left, right) {
  return left === right ? 0 : left < right ? -1 : 1;
}

function safeRelativePath(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\") || value.includes("\0") || value.startsWith("/") || /^[A-Za-z]:/u.test(value)) return false;
  const parts = value.split("/");
  return parts.length > 0 && parts.every((part) => part.length > 0 && part !== "." && part !== "..");
}

function issue(code, severity, message, sourcePath = null) {
  return { code, severity, message, sourcePath };
}

function validMode(value) {
  return value === null || (Number.isInteger(value) && value >= 0 && value <= 0o777);
}

function action(kind, relativePath, expectedHash, contentHash, reason, mode = null, expectedMode = null) {
  return { kind, relativePath, expectedHash, contentHash, mode, expectedMode, reason };
}

function surfaceFor(payload) {
  if (SURFACES.has(payload.surface)) return payload.surface;
  const translation = Array.isArray(payload.registrations)
    ? payload.registrations.find((entry) => entry?.kind === "profile-translation" && SURFACES.has(entry.surface))
    : null;
  if (translation) return translation.surface;
  throw new TypeError("payload must identify a supported surface through surface or profile-translation registration");
}

function selectedSurfaceSet(selectedSurfaces, surface) {
  const values = selectedSurfaces === undefined ? [surface] : selectedSurfaces;
  if (!Array.isArray(values) || values.length === 0 || values.some((value) => !SURFACES.has(value)) || new Set(values).size !== values.length || !values.includes(surface)) {
    throw new TypeError("selectedSurfaces must be unique supported surfaces including the payload surface");
  }
  return new Set(values);
}

function namespacedOwner(parsed, relativePath) {
  const matches = parsed.surfaces.filter((candidate) => relativePath.startsWith(`${candidate}/`));
  return matches.length === 1 ? matches[0] : null;
}

function stateOwnership(previousState, selectedSurfaces, diagnostics) {
  if (previousState === null || previousState === undefined) return null;
  const parsed = parseManagedState(previousState);
  if (!parsed) {
    diagnostics.push(issue("invalid-previous-state", "warning", "Previous managed state is missing or malformed; pruning is disabled."));
    return null;
  }
  const selected = new Set(selectedSurfaces);
  if (!parsed.surfaces.some((surface) => selected.has(surface))) {
    diagnostics.push(issue("managed-root-surface-conflict", "error", "Previous managed state belongs to a different surface; use a separate root or refresh all managed surfaces together."));
    return null;
  }
  const entries = new Map();
  for (const entry of parsed.ownedPaths) {
    if (parsed.surfaces.length > 1) {
      const owner = namespacedOwner(parsed, entry.relativePath);
      if (owner === null) {
        diagnostics.push(issue("ambiguous-previous-state", "error", "Multi-surface managed state contains ownership without an unambiguous surface namespace."));
        return null;
      }
      if (!selected.has(owner)) continue;
    }
    entries.set(entry.relativePath, entry.sha256);
  }
  return entries;
}

function lstatTarget(path) {
  try {
    return { metadata: lstatSync(path), error: null };
  } catch (error) {
    return { metadata: null, error };
  }
}

function targetKind(root, target) {
  // Refuse a symlink/junction anywhere along the destination path. This keeps
  // an authoritative overwrite from escaping the selected root.
  const rel = relative(root, target);
  const segments = rel.split(/[\\/]/u).filter(Boolean);
  let current = root;
  const rootEntry = lstatTarget(current);
  if (rootEntry.metadata?.isSymbolicLink()) return { kind: "unsafe-root", error: null };
  if (rootEntry.metadata && !rootEntry.metadata.isDirectory()) return { kind: "invalid-root", error: null };
  for (let index = 0; index < segments.length; index += 1) {
    current = resolve(current, segments[index]);
    const entry = lstatTarget(current);
    if (!entry.metadata) {
      if (entry.error?.code === "ENOENT") return { kind: "missing", error: null };
      if (entry.error?.code === "ENOTDIR") return { kind: "parent-not-directory", error: entry.error };
      return { kind: "unreadable", error: entry.error };
    }
    if (entry.metadata.isSymbolicLink()) return { kind: "symlink", error: null };
    if (index < segments.length - 1 && !entry.metadata.isDirectory()) return { kind: "parent-not-directory", error: null };
  }
  return { kind: "regular-or-directory", error: null };
}

function payloadFiles(payload) {
  if (!object(payload) || !Array.isArray(payload.files)) throw new TypeError("payload.files must be an array");
  const seen = new Set();
  const files = [];
  for (const file of payload.files) {
    if (!object(file) || !safeRelativePath(file.relativePath) || !(file.content instanceof Uint8Array) || !validMode(file.mode ?? null)) throw new TypeError("payload files require a safe relativePath, Uint8Array content, and mode null or a Unix mode from 0 through 0777");
    if (seen.has(file.relativePath)) throw new TypeError(`duplicate payload destination: ${file.relativePath}`);
    seen.add(file.relativePath);
    files.push({ ...file, mode: file.mode ?? null });
  }
  return files.sort((left, right) => compare(left.relativePath, right.relativePath));
}

function observedMode(metadata, platform) {
  return platform === "win32" || !metadata ? null : metadata.mode & 0o777;
}

function modeMismatch(metadata, desiredMode, platform) {
  if (platform === "win32" || !metadata) return false;
  return (metadata.mode & 0o777) !== (desiredMode ?? DEFAULT_FILE_MODE);
}

/** Build a read-only deterministic plan from a rendered payload and root. */
export function buildPlan({ payload, destinationRoot, previousState = null, selectedSurfaces, platform = process.platform } = {}) {
  if (typeof destinationRoot !== "string" || destinationRoot.trim() === "" || destinationRoot.includes("\0")) throw new TypeError("destinationRoot must be a non-empty path");
  const root = resolve(destinationRoot);
  if (typeof platform !== "string") throw new TypeError("platform must be a string");
  const surface = surfaceFor(payload);
  const selected = selectedSurfaceSet(selectedSurfaces, surface);
  const files = payloadFiles(payload);
  const diagnostics = Array.isArray(payload.diagnostics) ? payload.diagnostics.map((entry) => ({ ...entry })) : [];
  let rootSafetyError = null;
  try {
    assertSafeDestinationRoot(root, { allowedProductRoots: [root] });
  } catch (error) {
    rootSafetyError = error;
    diagnostics.push(issue("unsafe-destination-root", "error", `destination root rejected: ${error.message}`, null));
  }
  const ownership = new Map();
  if (Array.isArray(payload.ownership)) {
    for (const entry of payload.ownership) {
      if (!object(entry) || !safeRelativePath(entry.relativePath) || typeof entry.sha256 !== "string" || !SHA256_HEX.test(entry.sha256)) {
        throw new TypeError("payload ownership entries require safe paths and lowercase SHA-256 hashes");
      }
      if (ownership.has(entry.relativePath)) throw new TypeError(`duplicate payload ownership: ${entry.relativePath}`);
      ownership.set(entry.relativePath, entry.sha256);
    }
  }

  const actions = [];
  const desired = new Set();
  for (const file of files) {
    const relativePath = file.relativePath;
    desired.add(relativePath);
    const contentHash = hashBytes(file.content);
    if (rootSafetyError) {
      actions.push(action("reject", relativePath, null, contentHash, `destination root is unsafe: ${rootSafetyError.code || "unknown error"}`, file.mode));
      continue;
    }
    const declaredHash = ownership.get(relativePath);
    const target = resolve(root, ...relativePath.split("/"));
    const contained = relative(root, target);
    if (isAbsolute(contained) || contained === ".." || contained.startsWith(`..${"/"}`) || contained.startsWith(`..${"\\"}`)) {
      actions.push(action("reject", relativePath, null, contentHash, "destination escapes the selected root", file.mode));
      continue;
    }
    if (declaredHash !== undefined && declaredHash !== contentHash) {
      actions.push(action("reject", relativePath, null, contentHash, "rendered ownership hash does not match exact file bytes", file.mode));
      continue;
    }
    const targetStatus = targetKind(root, target);
    if (["unsafe-root", "invalid-root", "symlink", "unreadable", "parent-not-directory"].includes(targetStatus.kind)) {
      actions.push(action("reject", relativePath, null, contentHash, `destination is ${targetStatus.kind.replaceAll("-", " ")}`, file.mode));
      continue;
    }
    const entry = lstatTarget(target);
    if (!entry.metadata) {
      if (entry.error?.code !== "ENOENT" && entry.error?.code !== "ENOTDIR") {
        actions.push(action("reject", relativePath, null, contentHash, `destination is unreadable: ${entry.error?.message || "unknown error"}`, file.mode));
      } else {
        actions.push(action("create", relativePath, null, contentHash, "destination does not exist", file.mode));
      }
      continue;
    }
    if (entry.metadata.isDirectory() || entry.metadata.isSymbolicLink()) {
      actions.push(action("reject", relativePath, null, contentHash, entry.metadata.isSymbolicLink() ? "destination is a symlink or junction" : "destination is a directory", file.mode));
      continue;
    }
    let currentBytes;
    try {
      currentBytes = readFileSync(target);
    } catch (error) {
      actions.push(action("reject", relativePath, null, contentHash, `destination is unreadable: ${error.message}`, file.mode));
      continue;
    }
    const expectedHash = hashBytes(currentBytes);
    const mode = observedMode(entry.metadata, platform);
    const modeChanged = modeMismatch(entry.metadata, file.mode, platform);
    const sameContent = expectedHash === contentHash;
    actions.push(action(sameContent && !modeChanged ? "unchanged" : "replace", relativePath, expectedHash, contentHash, modeChanged ? "destination mode differs" : sameContent ? "destination bytes already match" : "destination bytes differ", file.mode, mode));
  }

  const priorOwnership = stateOwnership(previousState, selected, diagnostics);
  if (priorOwnership) {
    for (const [relativePath, expectedHash] of [...priorOwnership.entries()].sort(([left], [right]) => compare(left, right))) {
      if (desired.has(relativePath)) continue;
      if (rootSafetyError) {
        actions.push(action("reject", relativePath, expectedHash, null, `destination root is unsafe: ${rootSafetyError.code || "unknown error"}`));
        continue;
      }
      const target = resolve(root, ...relativePath.split("/"));
      const targetStatus = targetKind(root, target);
      if (["unsafe-root", "invalid-root", "symlink", "unreadable", "parent-not-directory"].includes(targetStatus.kind)) {
        actions.push(action("reject", relativePath, expectedHash, null, `owned destination is ${targetStatus.kind.replaceAll("-", " ")}`));
        continue;
      }
      const entry = lstatTarget(target);
      if (!entry.metadata) continue;
      if (entry.metadata.isDirectory() || entry.metadata.isSymbolicLink()) {
        actions.push(action("reject", relativePath, expectedHash, null, entry.metadata.isSymbolicLink() ? "owned destination is a symlink or junction" : "owned destination is a directory"));
        continue;
      }
      try {
        const actualHash = hashBytes(readFileSync(target));
        const mode = observedMode(entry.metadata, platform);
        if (actualHash === expectedHash) actions.push(action("prune", relativePath, expectedHash, null, "stale destination was previously owned and still matches its recorded hash", null, mode));
        else actions.push(action("reject", relativePath, actualHash, null, "owned destination changed since the previous managed state; refusing to prune", null, mode));
      } catch (error) {
        actions.push(action("reject", relativePath, expectedHash, null, `owned destination is unreadable: ${error.message}`));
      }
    }
  }

  actions.sort((left, right) => compare(left.relativePath, right.relativePath) || compare(left.kind, right.kind) || compare(left.reason, right.reason));
  diagnostics.sort((left, right) => compare(String(left.code), String(right.code)) || compare(String(left.message), String(right.message)));
  return { schemaVersion: 1, surface, root, actions, diagnostics };
}

export { ACTION_KINDS, safeRelativePath };
