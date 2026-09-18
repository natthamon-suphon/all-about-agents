import { lstatSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";

const SURFACES = new Set(["claude", "codex"]);

/** A stable error for unavailable or unsafe automatic root discovery. */
export class RootResolutionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RootResolutionError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new RootResolutionError(code, message);
}

function moduleFor(platform) {
  if (platform === "win32") return win32;
  if (platform === "darwin") return posix;
  fail("unsupported-platform", "platform must be win32 or darwin");
}

function isContained(root, candidate, pathModule) {
  const left = pathModule.normalize(root);
  const right = pathModule.normalize(candidate);
  const comparableRoot = pathModule === win32 ? left.toLowerCase() : left;
  const comparableCandidate = pathModule === win32 ? right.toLowerCase() : right;
  const relativePath = pathModule.relative(comparableRoot, comparableCandidate);
  return relativePath === "" || (relativePath !== ".." && !relativePath.startsWith(`..${pathModule.sep}`) && !pathModule.isAbsolute(relativePath));
}

function validateHome(homeDir, pathModule) {
  if (typeof homeDir !== "string" || homeDir.trim() === "" || homeDir.includes("\0")) fail("invalid-home", "homeDir must be a non-empty path");
  if (!pathModule.isAbsolute(homeDir)) fail("invalid-home", "homeDir must be absolute for the selected platform");
  return pathModule.normalize(homeDir);
}

function rawTraversal(value, pathModule) {
  const separator = pathModule === win32 ? /[\\/]/u : /\//u;
  return value.split(separator).some((segment) => segment === "..");
}

function canonicalPath(value, pathModule) {
  const normalized = pathModule.normalize(value);
  return pathModule === win32 ? normalized.toLowerCase() : normalized;
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function inspectExistingEntry(current, pathModule) {
  let metadata;
  try {
    metadata = lstatSync(current);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR" || error?.code === "UNKNOWN") return false;
    fail("unreadable-root", `unable to inspect destination root ancestor: ${error.message}`);
  }
  if (metadata.isSymbolicLink()) fail("unsafe-root", "destination root may not cross a symlink or junction ancestor");
  if (!metadata.isDirectory()) fail("invalid-root", "destination root ancestors must be directories");
  // Tests may exercise foreign-platform path semantics on the host platform.
  // Do not apply host-native canonicalization to those synthetic paths.
  const nativePlatformMatches = (pathModule === win32 && process.platform === "win32") || (pathModule !== win32 && process.platform !== "win32");
  if (!nativePlatformMatches) return true;
  // On Windows, a directory reparse point can redirect without being reported
  // as a symbolic link. Resolving every existing component and comparing it
  // with the lexical path rejects that class of redirection conservatively.
  try {
    const resolved = realpathSync.native(current);
    if (canonicalPath(resolved, pathModule) !== canonicalPath(current, pathModule)) {
      // Windows may expose an ordinary directory through an 8.3 short-name
      // alias. Permit that spelling only when the native file identity is
      // unchanged; a junction or other redirect has a different identity and
      // therefore remains fail-closed even when it is reported as a directory.
      if (pathModule !== win32 || !sameFileIdentity(lstatSync(current), lstatSync(resolved))) {
        fail("unsafe-root", "destination root may not cross a redirecting reparse point");
      }
    }
  } catch (error) {
    if (error instanceof RootResolutionError) throw error;
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR" || error?.code === "UNKNOWN") return false;
    fail("unreadable-root", `unable to canonicalize destination root ancestor: ${error.message}`);
  }
  return true;
}

function candidatePath(value, homeDir, pathModule) {
  if (typeof value !== "string" || value.trim() === "" || value.includes("\0")) fail("invalid-root", "destination root must be a non-empty path");
  const trimmed = value.trim();
  if (rawTraversal(trimmed, pathModule)) fail("root-traversal", "destination root may not contain raw '..' traversal segments");
  const expanded = trimmed === "~" ? homeDir : trimmed.startsWith("~/") || trimmed.startsWith("~\\") ? pathModule.join(homeDir, trimmed.slice(2)) : trimmed;
  const absolute = pathModule.isAbsolute(expanded) ? pathModule.normalize(expanded) : pathModule.resolve(homeDir, expanded);
  // Relative configuration must not escape the supplied home anchor through
  // traversal. Absolute explicit disposable roots remain operator-selected.
  if (!pathModule.isAbsolute(expanded) && !isContained(homeDir, absolute, pathModule)) fail("root-traversal", "destination root escapes homeDir");
  return absolute;
}

function inspectExistingAncestors(root, pathModule) {
  const parsed = pathModule.parse(root);
  const relativePath = pathModule.relative(parsed.root, root);
  let current = parsed.root;
  const segments = relativePath === "" ? [] : relativePath.split(pathModule.sep).filter(Boolean);
  for (const segment of segments) {
    current = pathModule.join(current, segment);
    // Once a component is absent, every descendant is absent too. Keep the
    // unresolved suffix intact; the plan/apply layer will create it safely.
    if (!inspectExistingEntry(current, pathModule)) return;
  }

  inspectExistingEntry(root, pathModule);
}

function broadRoot(root, home, pathModule) {
  const normalizedRoot = pathModule.normalize(root);
  if (canonicalPath(normalizedRoot, pathModule) === canonicalPath(pathModule.parse(normalizedRoot).root, pathModule)) return true;
  return isContained(normalizedRoot, home, pathModule);
}

function allowedRoots(values, home, pathModule) {
  if (!Array.isArray(values) || values.length === 0) fail("allowed-roots-required", "allowedProductRoots must name at least one verified product or disposable root");
  const roots = [];
  for (const value of values) {
    if (typeof value !== "string" || value.trim() === "" || value.includes("\0") || rawTraversal(value, pathModule) || !pathModule.isAbsolute(value)) {
      fail("invalid-allowed-root", "allowedProductRoots must contain absolute paths without traversal");
    }
    const normalized = pathModule.normalize(value);
    if (broadRoot(normalized, home, pathModule)) fail("invalid-allowed-root", "allowedProductRoots may not contain a filesystem, account-container, or home root");
    if (!roots.some((root) => canonicalPath(root, pathModule) === canonicalPath(normalized, pathModule))) roots.push(normalized);
  }
  return roots;
}

/** Validate an already-resolved root without creating or mutating it. */
export function assertSafeDestinationRoot(root, { platform = process.platform, homeDir = homedir(), allowedProductRoots = [] } = {}) {
  const pathModule = moduleFor(platform);
  if (typeof root !== "string" || !pathModule.isAbsolute(root) || root.includes("\0")) fail("invalid-root", "destination root must be an absolute path");
  const normalized = pathModule.normalize(root);
  const home = validateHome(homeDir, pathModule);
  if (broadRoot(normalized, home, pathModule)) fail("broad-root", "destination root may not be a filesystem, account-container, or home root");
  const allowed = allowedRoots(allowedProductRoots, home, pathModule);
  if (!allowed.some((candidate) => isContained(candidate, normalized, pathModule))) fail("root-outside-allowed", "destination root must be contained by an allowed product or disposable root");
  inspectExistingAncestors(normalized, pathModule);
  return normalized;
}

/**
 * Resolve a vendor root without creating directories or touching configuration.
 * Claude/Codex honor their documented environment variables.
 */
export function resolveDestinationRoot({ surface, override = null, env = process.env, platform = process.platform, homeDir = homedir() } = {}) {
  if (!SURFACES.has(surface)) fail("unsupported-surface", `unsupported surface: ${String(surface)}`);
  if (!env || typeof env !== "object" || Array.isArray(env)) fail("invalid-environment", "env must be an object");
  const pathModule = moduleFor(platform);
  const home = validateHome(homeDir, pathModule);
  const environmentName = surface === "claude" ? "CLAUDE_CONFIG_DIR" : surface === "codex" ? "CODEX_HOME" : null;
  let selected = override;
  if (selected !== null && selected !== undefined) {
    selected = selected;
  } else if (environmentName && typeof env[environmentName] === "string" && env[environmentName].trim() !== "") {
    selected = env[environmentName];
  } else if (environmentName) {
    selected = pathModule.join(home, surface === "claude" ? ".claude" : ".codex");
  } else {
    fail("manual-discovery-required", `${surface} has no verified automatic persistent root; provide an explicit destination root for manual/disposable installation`);
  }
  const root = candidatePath(selected, home, pathModule);
  return assertSafeDestinationRoot(root, { platform, homeDir: home, allowedProductRoots: [root] });
}

/**
 * Resolve the shared documented Gemini instruction home without creating it
 * or reading any product settings. An explicit override is intended for a
 * disposable package root; it is still subjected to the same fail-closed
 * destination checks as the native home.
 */
export { isContained, inspectExistingAncestors };
