import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { hashBytes } from "./hash.mjs";
import { atomicReplaceFile } from "./atomic-write.mjs";

export const STATE_SCHEMA_VERSION = 1;
export const STATE_RELATIVE_PATH = ".all-about-agents/state.json";

const SURFACES = new Set(["claude", "codex"]);
const PROFILES = new Set(["portable", "template"]);
const HASH = /^[0-9a-f]{64}$/u;
const CONTENT_KINDS = new Set(["create", "replace", "unchanged"]);

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeRelativePath(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\") || value.includes("\0") || value.startsWith("/")) return false;
  if (/^[A-Za-z]:/u.test(value)) return false;
  return value.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}

function sortedUniqueStrings(values, name, allowed = null) {
  if (!Array.isArray(values) || values.length === 0) throw new TypeError(`${name} must be a non-empty array`);
  const result = [];
  const seen = new Set();
  for (const value of values) {
    if (typeof value !== "string" || (allowed && !allowed.has(value)) || seen.has(value)) throw new TypeError(`${name} contains an invalid or duplicate value`);
    seen.add(value);
    result.push(value);
  }
  return result.sort();
}

function ownershipEntries(entries) {
  if (!Array.isArray(entries)) throw new TypeError("ownedPaths must be an array");
  const result = [];
  const seen = new Set();
  for (const entry of entries) {
    if (!object(entry) || !safeRelativePath(entry.relativePath) || typeof entry.sha256 !== "string" || !HASH.test(entry.sha256) || seen.has(entry.relativePath)) {
      throw new TypeError("ownedPaths entries require unique safe relativePath and lower-case SHA-256 sha256");
    }
    seen.add(entry.relativePath);
    result.push({ relativePath: entry.relativePath, sha256: entry.sha256 });
  }
  return result.sort((left, right) => left.relativePath === right.relativePath ? 0 : left.relativePath < right.relativePath ? -1 : 1);
}

/** Build the only managed-state shape accepted by the installer. */
export function buildManagedState({ repositoryVersion, profile, surfaces, ownedPaths } = {}) {
  if (typeof repositoryVersion !== "string" || repositoryVersion.trim() === "" || repositoryVersion.includes("\0")) {
    throw new TypeError("repositoryVersion must be a non-empty string");
  }
  if (typeof profile !== "string" || !PROFILES.has(profile)) throw new TypeError("profile must be portable or template");
  const selectedSurfaces = sortedUniqueStrings(surfaces, "surfaces", SURFACES);
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    repositoryVersion,
    profile,
    surfaces: selectedSurfaces,
    ownedPaths: ownershipEntries(ownedPaths)
  };
}

/** Derive managed ownership from successful content actions without diagnostics or user data. */
export function stateFromPlan({ plan, repositoryVersion, profile, surfaces, completed } = {}) {
  if (!object(plan) || !Array.isArray(completed)) throw new TypeError("plan and completed actions are required");
  const ownership = completed
    .filter((action) => ["create", "replace", "unchanged"].includes(action?.kind))
    .map((action) => ({ relativePath: action.relativePath, sha256: action.contentHash }));
  return buildManagedState({ repositoryVersion, profile, surfaces, ownedPaths: ownership });
}

function pathSurface(relativePath, surfaces) {
  const separator = relativePath.indexOf("/");
  if (separator <= 0 || separator === relativePath.length - 1) return null;
  const surface = relativePath.slice(0, separator);
  return surfaces.includes(surface) ? surface : null;
}

/**
 * Merge ownership from a partial refresh without allowing ambiguous state to
 * silently authorize pruning or overwrite another surface's namespace.
 */
export function mergeManagedState({ repositoryVersion, profile, surfaces, completed, previousState = null } = {}) {
  const selectedSurfaces = sortedUniqueStrings(surfaces, "surfaces", SURFACES);
  if (!Array.isArray(completed)) throw new TypeError("completed actions are required");
  let previous = previousState;
  if (previous !== null && previous !== undefined) {
    previous = parseManagedState(previous);
    if (!previous) throw new TypeError("previousState must be a valid managed state");
  } else {
    previous = null;
  }

  const previousSurfaces = previous?.surfaces || [];
  const previousIsMultiSurface = previousSurfaces.length > 1;
  const partialPreviousRefresh = previousIsMultiSurface && previousSurfaces.some((surface) => !selectedSurfaces.includes(surface));
  if (partialPreviousRefresh && (previous.repositoryVersion !== repositoryVersion || previous.profile !== profile)) {
    throw new TypeError("partial multi-surface refresh must keep the existing repository version and profile; refresh all managed surfaces together");
  }
  const unionSurfaces = [...new Set([...previousSurfaces, ...selectedSurfaces])];
  const knownSurfaces = [...new Set([...previousSurfaces, ...selectedSurfaces])];
  const preserved = [];

  if (previous) {
    if (previousIsMultiSurface) {
      for (const entry of previous.ownedPaths) {
        const owner = pathSurface(entry.relativePath, previousSurfaces);
        if (!owner) throw new TypeError(`ambiguous multi-surface ownership: ${entry.relativePath}`);
        if (!selectedSurfaces.includes(owner)) preserved.push(entry);
      }
    } else if (!selectedSurfaces.includes(previousSurfaces[0])) {
      throw new TypeError("previous managed state belongs to a different surface; use a separate root or refresh all managed surfaces together");
    }
  }

  const ownership = [...preserved];
  for (const action of completed) {
    if (!CONTENT_KINDS.has(action?.kind)) continue;
    if (typeof action.relativePath !== "string" || typeof action.contentHash !== "string") {
      throw new TypeError("completed content actions require relativePath and contentHash");
    }
    let relativePath = action.relativePath;
    if (unionSurfaces.length > 1) {
      const owner = pathSurface(relativePath, knownSurfaces);
      if (owner) {
        if (!selectedSurfaces.includes(owner)) throw new TypeError(`completed ownership belongs to an unselected surface: ${relativePath}`);
      } else if (selectedSurfaces.length === 1) {
        relativePath = `${selectedSurfaces[0]}/${relativePath}`;
      } else {
        throw new TypeError(`ambiguous completed multi-surface ownership: ${relativePath}`);
      }
    }
    ownership.push({ relativePath, sha256: action.contentHash });
  }

  return buildManagedState({ repositoryVersion, profile, surfaces: unionSurfaces, ownedPaths: ownership });
}

export function serializeManagedState(state) {
  const normalized = buildManagedState(state);
  return new TextEncoder().encode(`${JSON.stringify(normalized)}\n`);
}

function validState(value) {
  if (!object(value) || value.schemaVersion !== STATE_SCHEMA_VERSION) return false;
  const keys = Object.keys(value).sort();
  if (keys.join("\0") !== ["ownedPaths", "profile", "repositoryVersion", "schemaVersion", "surfaces"].join("\0")) return false;
  try {
    const normalized = buildManagedState(value);
    return JSON.stringify(normalized) === JSON.stringify(value);
  } catch {
    return false;
  }
}

/** Parse state defensively; missing/malformed state returns null so callers disable pruning. */
export function parseManagedState(value) {
  let parsed = value;
  if (value instanceof Uint8Array || typeof value === "string") {
    try {
      parsed = JSON.parse(typeof value === "string" ? value : new TextDecoder("utf-8", { fatal: true }).decode(value));
    } catch {
      return null;
    }
  }
  if (!validState(parsed)) return null;
  return structuredClone(parsed);
}

function operation(fileSystem, name, fallback) {
  const candidate = fileSystem?.[name];
  return typeof candidate === "function" ? candidate.bind(fileSystem) : fallback;
}

export async function readManagedState(root, { fileSystem = {}, relativePath = STATE_RELATIVE_PATH } = {}) {
  if (typeof root !== "string" || root.length === 0 || !safeRelativePath(relativePath)) throw new TypeError("root and relativePath must be valid");
  const read = operation(fileSystem, "readFile", readFile);
  try {
    return parseManagedState(await read(resolve(root, ...relativePath.split("/"))));
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
    return null;
  }
}

export async function writeManagedState({ root, state, fileSystem = {}, relativePath = STATE_RELATIVE_PATH } = {}) {
  if (typeof root !== "string" || root.length === 0 || !safeRelativePath(relativePath)) throw new TypeError("root and relativePath must be valid");
  const content = serializeManagedState(state);
  return atomicReplaceFile({
    destination: resolve(root, ...relativePath.split("/")),
    content,
    expectedHash: hashBytes(content),
    allowedProductRoots: [root],
    fileSystem
  });
}

export const validateManagedState = validState;
export { safeRelativePath };
