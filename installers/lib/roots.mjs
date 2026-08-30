import { lstatSync } from "node:fs";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";

const SURFACES = new Set(["claude", "codex", "antigravity-2", "agy"]);

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
    try {
      const metadata = lstatSync(current);
      if (metadata.isSymbolicLink()) fail("unsafe-root", "destination root may not cross a symlink or junction ancestor");
      if (!metadata.isDirectory()) fail("invalid-root", "destination root ancestors must be directories");
    } catch (error) {
      if (error instanceof RootResolutionError) throw error;
      // Once a component is absent, every descendant is absent too. Keep the
      // unresolved suffix intact; the plan/apply layer will create it safely.
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR" || error?.code === "UNKNOWN") return;
      fail("unreadable-root", `unable to inspect destination root ancestor: ${error.message}`);
    }
  }

  try {
    const metadata = lstatSync(root);
    if (metadata.isSymbolicLink()) fail("unsafe-root", "destination root may not be a symlink or junction");
    if (!metadata.isDirectory()) fail("invalid-root", "destination root must be a directory");
  } catch (error) {
    if (error instanceof RootResolutionError) throw error;
    if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR" && error?.code !== "UNKNOWN") fail("unreadable-root", `unable to inspect destination root: ${error.message}`);
  }
}

/**
 * Resolve a vendor root without creating directories or touching configuration.
 * Claude/Codex honor their documented environment variables. Antigravity
 * Desktop and agy intentionally require an explicit disposable/manual root.
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
  inspectExistingAncestors(root, pathModule);
  return root;
}

export { isContained };
