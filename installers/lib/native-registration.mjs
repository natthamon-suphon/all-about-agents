import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { lstat as defaultLstat, readdir as defaultReaddir, readFile as defaultReadFile, realpath as defaultRealpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve, join } from "node:path";

import { renderClaudeStatuslineCommand, resolveClaudeConfigDir } from "../../adapters/claude/adapter.mjs";
import { resolveCodexHome } from "../../adapters/codex/adapter.mjs";
import { resolveGeminiHome } from "../../adapters/antigravity/adapter.mjs";
import { assertSafeDestinationRoot } from "./roots.mjs";
import { mergeSettingsOverlay } from "./settings-overlay.mjs";
import { atomicReplaceFile } from "./atomic-write.mjs";
import { hashBytes } from "./hash.mjs";
import { parseManagedState, STATE_RELATIVE_PATH } from "./state.mjs";
import { runProcess as defaultRunProcess } from "../../scripts/lib/process-runner.mjs";
import { SURFACES, SURFACE_SET as SUPPORTED_SURFACE_SET } from "../../adapters/shared/surfaces.mjs";

export const REGISTRATION_SURFACES = SURFACES;
const SURFACE_SET = SUPPORTED_SURFACE_SET;
const PROFILE_SET = new Set(["portable", "template"]);
const SHA256 = /^[0-9a-f]{64}$/u;
const AUTHENTIC_PLANS = new WeakSet();
const PLUGIN_SELECTOR = "all-about-agents@all-about-agents";
// Observed in a live Claude cache: product in-use markers and the logs the
// package hooks append beside themselves. Everything else must match.
const RUNTIME_FILE_PREFIXES = [".in_use/", "hooks/audit/", "hooks/checkpoints/"];
const RUNTIME_FILES = new Set([".all-about-agents/state.json"]);
// Claude Code loads every .md file below <CLAUDE_CONFIG_DIR>/rules/, so the
// package owns one subfolder and never writes beside the user's own rules.
const CLAUDE_RULES_FOLDER = "rules/all-about-agents";
const CLAUDE_RULE_FILE = /^rules\/all-about-agents\/[^/]+\.md$/u;

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function pathError(code, message) {
  const error = new TypeError(message);
  error.code = code;
  return error;
}

function safeRoot(value, label, { required = false } = {}) {
  if (typeof value !== "string" || value.trim() === "" || value.includes("\0")) throw pathError("invalid-root", `${label} must be a non-empty path`);
  if (!isAbsolute(value)) throw pathError("invalid-root", `${label} must be absolute; resolve repository-relative CLI input before planning`);
  if (value.split(/[\\/]/u).some((segment) => segment === "..")) throw pathError("root-traversal", `${label} may not contain raw '..' traversal segments`);
  const root = resolve(value);
  if (!isAbsolute(root)) throw pathError("invalid-root", `${label} must resolve to an absolute path`);
  assertSafeDestinationRoot(root, { allowedProductRoots: [root] });
  let metadata;
  try { metadata = lstatSync(root); } catch (error) {
    if (error?.code === "ENOENT" && !required) return root;
    throw pathError("invalid-root", `${label} is unavailable`);
  }
  if (metadata.isSymbolicLink()) throw pathError("unsafe-root", `${label} may not be a symlink, junction, or reparse point`);
  if (!metadata.isDirectory()) throw pathError("invalid-root", `${label} must be a directory`);
  return root;
}

function canonicalRoot(value) {
  const normalized = resolve(value);
  try {
    return resolve(realpathSync.native(normalized));
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return normalized;
    throw pathError("unreadable-root", "unable to canonicalize native destination root");
  }
}

function sameRoot(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftCanonical = canonicalRoot(left);
  const rightCanonical = canonicalRoot(right);
  return process.platform === "win32"
    ? leftCanonical.toLowerCase() === rightCanonical.toLowerCase()
    : leftCanonical === rightCanonical;
}

function assertRootPair(surface, productRoot, instructionRoot) {
  if (typeof productRoot !== "string" || typeof instructionRoot !== "string") throw pathError("instruction-root-required", "native registration requires both productRoot and instructionRoot");
  if (!SURFACE_SET.has(surface)) throw pathError("unsupported-surface", `unsupported registration surface: ${surface}`);
  if (!sameRoot(productRoot, instructionRoot)) throw pathError("root-confusion", `${surface} productRoot and instructionRoot must be the same canonical path`);
}

function requiredPackageFiles(surface) {
  if (surface === "antigravity") return ["plugin.json"];
  return surface === "claude"
    ? [".claude-plugin/plugin.json", ".claude-plugin/marketplace.json"]
    : [".codex-plugin/plugin.json", ".agents/plugins/marketplace.json"];
}

function requiredRegistrationSourceFiles(surface, profile) {
  const markers = requiredPackageFiles(surface);
  if (surface === "claude") return [...markers, "CLAUDE.md", "settings.json", "all-about-agents/statusline.json", "statusline/statusline.mjs", "statusline/track-tool.mjs", "statusline/statusline.ps1", "statusline/statusline.sh", `${CLAUDE_RULES_FOLDER}/presentation.md`];
  if (surface === "antigravity") return [...markers, "GEMINI.md", ...["architect", "implementer", "investigator", "researcher", "reviewer", "security-reviewer", "verifier"].map((role) => `agents/${role}.md`)];
  if (surface === "codex") return [...markers, "AGENTS.md", "config.toml", ...(profile === "template" ? ["terra-max.config.toml"] : []), ...["architect", "implementer", "investigator", "researcher", "reviewer", "security-reviewer", "verifier"].map((role) => `agents/${role}.toml`)];
  return markers;
}

function checkPackageFile(packageRoot, relativePath) {
  const target = resolve(packageRoot, ...relativePath.split("/"));
  const suffix = relative(packageRoot, target);
  if (isAbsolute(suffix) || suffix.split(/[\\/]/u)[0] === "..") throw pathError("package-escape", "package file escapes the package root");
  let current = packageRoot;
  const segments = relativePath.split("/");
  for (const segment of segments.slice(0, -1)) {
    current = join(current, segment);
    assertSafeDestinationRoot(current, { allowedProductRoots: [packageRoot] });
    let parentMetadata;
    try { parentMetadata = lstatSync(current); } catch (error) {
      if (error?.code === "ENOENT") throw pathError("package-file-missing", `package is missing ${relativePath}`);
      throw pathError("package-file-unreadable", `unable to inspect package marker ${relativePath}`);
    }
    if (parentMetadata.isSymbolicLink() || !parentMetadata.isDirectory()) throw pathError("unsafe-package-file", `package ${relativePath} has an unsafe marker ancestor`);
  }
  let metadata;
  try { metadata = lstatSync(target); } catch (error) {
    if (error?.code === "ENOENT") throw pathError("package-file-missing", `package is missing ${relativePath}`);
    throw pathError("package-file-unreadable", `unable to inspect package marker ${relativePath}`);
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) throw pathError("unsafe-package-file", `package ${relativePath} must be a regular file`);
  return target;
}

function managedStateLocation(packageRoot, surface) {
  let statePath;
  try {
    statePath = checkPackageFile(packageRoot, STATE_RELATIVE_PATH);
  } catch (error) {
    if (error?.code !== "package-file-missing") throw pathError("package-state-invalid", "package managed state is unsafe or unreadable");
    const parentRoot = dirname(packageRoot);
    if (basename(packageRoot) !== surface || parentRoot === packageRoot) throw pathError("package-state-missing", "package managed state is missing; render the package before registration");
    try {
      statePath = checkPackageFile(parentRoot, STATE_RELATIVE_PATH);
    } catch (parentError) {
      if (parentError?.code === "package-file-missing") throw pathError("package-state-missing", "package managed state is missing; render the package before registration");
      throw pathError("package-state-invalid", "package managed state is unsafe or unreadable");
    }
    return { statePath, stateRoot: parentRoot, ownershipPrefix: `${surface}/` };
  }
  return { statePath, stateRoot: packageRoot, ownershipPrefix: "" };
}

function validateManagedPackage(packageRoot, surface, profile) {
  const { statePath, stateRoot, ownershipPrefix } = managedStateLocation(packageRoot, surface);
  let state;
  try {
    state = parseManagedState(readFileSync(statePath));
  } catch {
    state = null;
  }
  if (!state) throw pathError("package-state-invalid", "package managed state is malformed or unreadable");
  if (state.profile !== profile) throw pathError("package-profile-mismatch", "requested profile does not match the rendered package profile");
  if (!state.surfaces.includes(surface)) throw pathError("package-surface-mismatch", "requested surface is not owned by the rendered package state");

  const scopedOwnership = state.ownedPaths.filter((entry) => entry.relativePath.startsWith(ownershipPrefix));
  const ownership = new Map(scopedOwnership.map((entry) => [entry.relativePath, entry.sha256]));
  for (const relativePath of requiredRegistrationSourceFiles(surface, profile)) {
    if (!ownership.has(`${ownershipPrefix}${relativePath}`)) throw pathError("package-source-unowned", `required registration source is not owned: ${relativePath}`);
  }
  for (const entry of scopedOwnership) {
    let content;
    try {
      content = readFileSync(checkPackageFile(stateRoot, entry.relativePath));
    } catch {
      throw pathError("package-owned-file-invalid", `managed package file is missing, unsafe, or unreadable: ${entry.relativePath}`);
    }
    if (hashBytes(content) !== entry.sha256) throw pathError("package-owned-hash-mismatch", `managed package file does not match its recorded hash: ${entry.relativePath}`);
  }
  return { state, ownershipPrefix, ownership };
}

function processAction(id, executable, args, cwd, environmentKey, expectedProbe, mutates = true) {
  return { id, kind: "process", executable, args: [...args], cwd, environmentKeys: environmentKey ? [environmentKey] : [], mutates, required: true, expectedProbe };
}

// A required manual step marks work the plan could not do, so the apply
// report ends manual-required instead of complete.
function manualAction(id, message, { required = false } = {}) {
  return { id, kind: "manual", mutates: false, required, message };
}

function fileCopyAction(id, packageRoot, destinationRoot, sourceRelativePath, destinationRelativePath, { mode = null, transform = null, guard = null, match = null, expectedSourceHash, allowedRoot = destinationRoot } = {}) {
  if (!(mode === null || (Number.isInteger(mode) && mode >= 0 && mode <= 0o777))) throw new TypeError("native config copy mode must be null or a Unix mode from 0 through 0777");
  if (!(transform === null || transform === "claude-statusline-product-root")) throw new TypeError("unsupported native config copy transform");
  if (typeof expectedSourceHash !== "string" || !SHA256.test(expectedSourceHash)) throw new TypeError("native config copy requires a managed source hash");
  const sourcePath = checkPackageFile(packageRoot, sourceRelativePath);
  const targetPath = resolve(destinationRoot, ...destinationRelativePath.split("/"));
  const suffix = relative(destinationRoot, targetPath);
  if (isAbsolute(suffix) || suffix.split(/[\\/]/u)[0] === "..") throw pathError("destination-escape", "native config destination escapes the selected native root");
  assertSafeDestinationRoot(dirname(targetPath), { allowedProductRoots: [allowedRoot] });
  if (!(guard === null || guard === "no-clobber")) throw new TypeError("unsupported native config copy guard");
  if (guard === "no-clobber" ? !CONTAINMENT_CHECKS.has(match) : match !== null) throw new TypeError("a no-clobber native config copy needs a supported match, and only it takes one");
  return { id, kind: "file-copy", sourcePath, sourceRelativePath, expectedSourceHash, targetPath, destinationRelativePath, allowedRoot, mode, transform, guard, match, mutates: true, required: true, expectedProbe: guard === "no-clobber" ? "hash-verified-write-or-refuse" : "hash-verified-overwrite", automaticWrite: true };
}

// A linked or non-folder rules path, or a linked or non-file rule target
// (common with dotfiles), blocks only the rule copies, never the rest of the
// Claude registration.
function ruleTargetsAreSafe(productRoot, rules) {
  try {
    assertSafeDestinationRoot(join(productRoot, ...CLAUDE_RULES_FOLDER.split("/")), { allowedProductRoots: [productRoot] });
  } catch (error) {
    if (error?.code === "unsafe-root" || error?.code === "invalid-root") return false;
    throw error;
  }
  for (const rule of rules) {
    let metadata;
    try {
      metadata = lstatSync(join(productRoot, ...rule.split("/")));
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") continue;
      throw pathError("destination-unreadable", `unable to inspect <CLAUDE_CONFIG_DIR>/${rule}`);
    }
    if (!metadata.isFile()) return false;
  }
  return true;
}

function extraRuleEntries(productRoot, renderedNames) {
  let entries;
  try {
    entries = readdirSync(join(productRoot, ...CLAUDE_RULES_FOLDER.split("/")), { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return [];
    throw pathError("destination-unreadable", `unable to list <CLAUDE_CONFIG_DIR>/${CLAUDE_RULES_FOLDER}`);
  }
  return entries.filter((entry) => !renderedNames.has(entry.name)).map((entry) => `${CLAUDE_RULES_FOLDER}/${entry.name}${entry.isDirectory() ? "/" : ""}`).sort();
}

function textLines(text) {
  return text.replace(/\r\n?/gu, "\n").split("\n").map((line) => line.trimEnd());
}

// Line-based, not a TOML parser: each "[header]" line starts a table, and the
// lines before the first header are the top-level keys. The rendered file has
// only one-line keys, so this is exact for it.
function tomlTables(text) {
  const tables = new Map([["", []]]);
  let header = "";
  for (const line of textLines(text).map((entry) => entry.trim())) {
    if (line === "") continue;
    if (/^\[.*\]$/u.test(line)) {
      header = line;
      if (!tables.has(header)) tables.set(header, []);
    } else {
      tables.get(header).push(line);
    }
  }
  return tables;
}

function missingTomlTables(managed, existing) {
  const present = tomlTables(existing);
  return [...tomlTables(managed)]
    .filter(([header, lines]) => lines.length > 0 || header !== "")
    .filter(([header, lines]) => !present.has(header) || lines.some((line) => !present.get(header).includes(line)))
    .map(([header]) => header === "" ? "top-level keys" : header);
}

function missingTextBlock(managed, existing) {
  const block = textLines(managed).join("\n").replace(/^\n+|\n+$/gu, "");
  return `\n${textLines(existing).join("\n")}\n`.includes(`\n${block}\n`) ? [] : ["the managed GEMINI.md body as one block"];
}

// A shared destination is complete when it already contains the managed
// content; the operator and the product may keep more beside it.
const CONTAINMENT_CHECKS = new Map([["toml-tables", missingTomlTables], ["text-block", missingTextBlock]]);

function lifecycle(surface) {
  const registrationEvidence = "Native registration has not been attempted by this dry-run plan.";
  const trust = surface === "claude"
    ? { status: "not-run-unavailable", evidence: "Claude has no separate native trust step for this package registration." }
    : { status: "not-run", evidence: "Native trust has not been observed; a manual product step may be required." };
  return {
    rendered: { status: "pass", evidence: "Observed required marker regular files under the package root." },
    validated: { status: "not-run", evidence: "Only local structural path checks ran; native schema and product validation were not observed." },
    registered: { status: "not-run", evidence: registrationEvidence },
    trusted: trust,
    active: { status: "not-run", evidence: "A fresh native session has not been opened." },
    runtimeVerified: { status: "not-run", evidence: "No native runtime behavior was executed by this planner." }
  };
}

function assertRenderedConsistency(rendered, surface) {
  if (rendered === undefined || rendered === null) return;
  if (!object(rendered)) throw new TypeError("rendered must be an object when supplied");
  if (Array.isArray(rendered.registrations)) {
    for (const registration of rendered.registrations) {
      if (registration?.surface !== undefined && registration.surface !== surface) continue;
      // Registration metadata is evidence only. It is intentionally never
      // used as an executable instruction source.
    }
  }
}

/** Build a deterministic plan from fixed, reviewed product command builders. */
export function planNativeRegistration({ surface, packageRoot, productRoot, instructionRoot, profile, platform = process.platform, rendered } = {}) {
  if (!SURFACE_SET.has(surface)) throw pathError("unsupported-surface", `unsupported registration surface: ${String(surface)}`);
  if (!PROFILE_SET.has(profile)) throw pathError("invalid-profile", "profile must be portable or template");
  if (typeof platform !== "string" || !platform.trim()) throw new TypeError("platform must be a non-empty string");
  assertRenderedConsistency(rendered, surface);

  const pkg = safeRoot(packageRoot, "packageRoot", { required: true });
  for (const relativePath of requiredPackageFiles(surface)) checkPackageFile(pkg, relativePath);
  const managedPackage = validateManagedPackage(pkg, surface, profile);
  const product = safeRoot(productRoot, "productRoot");
  const instruction = safeRoot(instructionRoot ?? product, "instructionRoot");
  assertRootPair(surface, product, instruction);
  const actions = [];
  const deployFile = (id, sourceRelativePath, destinationRelativePath, options = {}, destinationRoot = product) => fileCopyAction(id, pkg, destinationRoot, sourceRelativePath, destinationRelativePath, {
    ...options,
    expectedSourceHash: managedPackage.ownership.get(`${managedPackage.ownershipPrefix}${sourceRelativePath}`)
  });

  if (surface === "claude") {
    actions.push(deployFile("claude-instructions-deploy", "CLAUDE.md", "CLAUDE.md"));
    actions.push({ id: "claude-settings-deploy", kind: "settings-overlay", targetPath: join(product, "settings.json"), overlayPath: join(pkg, "settings.json"), expectedOverlayHash: managedPackage.ownership.get(`${managedPackage.ownershipPrefix}settings.json`), allowedRoot: product, transform: "claude-statusline-product-root", mutates: true, required: true, expectedProbe: "settings-merge", automaticWrite: true });
    actions.push(deployFile("claude-statusline-config-deploy", "all-about-agents/statusline.json", "all-about-agents/statusline.json"));
    actions.push(deployFile("claude-statusline-renderer-deploy", "statusline/statusline.mjs", "statusline/statusline.mjs", { mode: 0o755 }));
    actions.push(deployFile("claude-statusline-tracker-deploy", "statusline/track-tool.mjs", "statusline/track-tool.mjs", { mode: 0o755 }));
    actions.push(deployFile("claude-statusline-windows-launcher-deploy", "statusline/statusline.ps1", "statusline/statusline.ps1"));
    actions.push(deployFile("claude-statusline-posix-launcher-deploy", "statusline/statusline.sh", "statusline/statusline.sh", { mode: 0o755 }));
    const rules = [...managedPackage.ownership.keys()]
      .map((relativePath) => relativePath.slice(managedPackage.ownershipPrefix.length))
      .filter((relativePath) => CLAUDE_RULE_FILE.test(relativePath))
      .sort();
    if (ruleTargetsAreSafe(product, rules)) {
      for (const rule of rules) actions.push(deployFile(`claude-rule-${basename(rule, ".md")}-deploy`, rule, rule));
      const extras = extraRuleEntries(product, new Set(rules.map((rule) => basename(rule))));
      if (extras.length > 0) {
        const count = extras.length === 1 ? "1 entry is" : `${extras.length} entries are`;
        actions.push(manualAction("claude-rules-extra-files", `${count} in ${CLAUDE_RULES_FOLDER}/ but not rendered by this package, such as ${extras.slice(0, 5).join(", ")}. Claude Code loads every .md file below rules/, so review and remove them by hand; registration never deletes them.`, { required: true }));
      }
    } else {
      actions.push(manualAction("claude-rules-deploy", `<CLAUDE_CONFIG_DIR>/rules or ${CLAUDE_RULES_FOLDER} is a symlink, junction, or not a folder, or a rule file there is a link or not a regular file, so no rule file is written; copy the package ${CLAUDE_RULES_FOLDER}/*.md files into <CLAUDE_CONFIG_DIR>/${CLAUDE_RULES_FOLDER}/ by hand.`, { required: true }));
    }
    actions.push(processAction("claude-marketplace-add", "claude", ["plugin", "marketplace", "add", pkg, "--scope", "user"], pkg, "CLAUDE_CONFIG_DIR", "none"));
    actions.push(processAction("claude-plugin-install", "claude", ["plugin", "install", PLUGIN_SELECTOR, "--scope", "user"], pkg, "CLAUDE_CONFIG_DIR", "none"));
    actions.push(processAction("claude-plugin-list", "claude", ["plugin", "list", "--json"], pkg, "CLAUDE_CONFIG_DIR", "json", false));
    actions.push({ id: "claude-plugin-cache-check", kind: "plugin-cache-check", probe: "claude-plugin-list", mutates: false, required: true, expectedProbe: "installed-copy-matches-package" });
    actions.push(manualAction("claude-reload", "Restart Claude Code or reload the plugin before checking native behavior."));
  } else if (surface === "codex") {
    actions.push(deployFile("codex-instructions-deploy", "AGENTS.md", "AGENTS.md"));
    actions.push(deployFile("codex-config-deploy", "config.toml", "config.toml", { guard: "no-clobber", match: "toml-tables" }));
    if (profile === "template") actions.push(deployFile("codex-terra-profile-deploy", "terra-max.config.toml", "terra-max.config.toml"));
    for (const role of ["architect", "implementer", "investigator", "researcher", "reviewer", "security-reviewer", "verifier"]) {
      actions.push(deployFile(`codex-agent-${role}-deploy`, `agents/${role}.toml`, `agents/${role}.toml`));
    }
    actions.push(processAction("codex-marketplace-add", "codex", ["plugin", "marketplace", "add", pkg, "--json"], pkg, "CODEX_HOME", "json"));
    actions.push(processAction("codex-plugin-install", "codex", ["plugin", "add", PLUGIN_SELECTOR, "--json"], pkg, "CODEX_HOME", "json"));
    actions.push(processAction("codex-plugin-list", "codex", ["plugin", "list", "--available", "--json"], pkg, "CODEX_HOME", "json", false));
    actions.push({ id: "codex-plugin-source-check", kind: "git-source-check", executable: "git", prefixArgs: ["-c", "core.fsmonitor=false", "rev-parse", "--show-prefix"], statusArgs: ["-c", "core.fsmonitor=false", "--no-optional-locks", "status", "--porcelain", "--untracked-files=all", "--", "."], cwd: pkg, environmentKeys: [], mutates: false, required: true, expectedProbe: "own-repository-clean-working-tree" });
    actions.push(manualAction("codex-hooks-trust", "Open `/hooks` in Codex and review/trust the registered hook only if the product presents that step."));
  } else if (surface === "antigravity") {
    // GEMINI.md is not a superset of the live file the way CLAUDE.md is: an
    // operator may keep unrelated always-on sections there. Refuse rather than
    // replace. See docs/plans/2026-09-19-restore-antigravity.md decision A6.
    actions.push(deployFile("antigravity-instructions-deploy", "GEMINI.md", "GEMINI.md", { guard: "no-clobber", match: "text-block" }, instruction));
    actions.push(processAction("antigravity-plugin-validate", "agy", ["plugin", "validate", pkg], pkg, null, "none", false));
    actions.push(processAction("antigravity-plugin-install", "agy", ["plugin", "install", pkg], pkg, null, "none"));
    actions.push(processAction("antigravity-plugin-list", "agy", ["plugin", "list"], pkg, null, "json", false));
    actions.push(manualAction("antigravity-desktop-slot", "Copy plugin.json, skills/, and agents/ into <workspace>/.agents/plugins/all-about-agents/ for Antigravity Desktop; see docs/manual-desktop.md."));
  }

  const plan = {
    schemaVersion: 1,
    surface,
    packageRoot: pkg,
    productRoot: product,
    instructionRoot: instruction,
    profile,
    platform,
    actions,
    lifecycle: lifecycle(surface)
  };
  deepFreeze(plan);
  AUTHENTIC_PLANS.add(plan);
  return plan;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) deepFreeze(value[key], seen);
  return Object.freeze(value);
}

function envFor(plan, action) {
  const env = {};
  for (const key of action.environmentKeys || []) {
    if (key === "CLAUDE_CONFIG_DIR" || key === "CODEX_HOME") env[key] = plan.productRoot;
    else throw pathError("unknown-environment-key", `unsupported native environment key ${key}`);
  }
  return env;
}

function probeOutput(action, result) {
  if (action.expectedProbe !== "json") return null;
  if (result.stdout === undefined || String(result.stdout).trim() === "") {
    const error = new Error(`native action ${action.id} returned empty JSON output`);
    error.code = "malformed-native-json";
    throw error;
  }
  try { return JSON.parse(String(result.stdout)); } catch (cause) {
    const error = new Error(`native action ${action.id} returned malformed JSON`, { cause });
    error.code = "malformed-native-json";
    throw error;
  }
}

function reportAction(action, status, extra = {}) {
  return { ...action, status, ...extra };
}

async function readExistingDestination(targetPath, fileSystem) {
  const inspect = typeof fileSystem?.lstat === "function" ? fileSystem.lstat.bind(fileSystem) : defaultLstat;
  let metadata;
  try {
    metadata = await inspect(targetPath);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
    throw pathError("destination-unreadable", "unable to inspect the native instruction destination");
  }
  if (metadata?.isSymbolicLink?.() || metadata?.isDirectory?.() || !metadata?.isFile?.()) {
    throw pathError("unsafe-destination", "native instruction destination must be a regular file, not a symlink, junction, reparse point, or directory");
  }
  const read = typeof fileSystem?.readFile === "function" ? fileSystem.readFile.bind(fileSystem) : defaultReadFile;
  let content;
  try {
    content = await read(targetPath);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
    throw pathError("destination-unreadable", "unable to read the native instruction destination");
  }
  if (!(content instanceof Uint8Array)) throw pathError("invalid-destination-bytes", "native instruction destination did not return bytes");
  return { content, mode: Number.isInteger(metadata.mode) ? metadata.mode & 0o777 : null };
}

// atomic-write sets an explicit mode on POSIX only, so only there can it drift.
function modeMatches(action, existing) {
  return action.mode === null || process.platform === "win32" || existing.mode === action.mode;
}

function transformCopyContent(action, content, plan) {
  if (action.transform === null) return content;
  if (action.transform !== "claude-statusline-product-root") throw pathError("unsupported-copy-transform", `unsupported native config copy transform for ${action.id}`);
  let settings;
  try {
    settings = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(content));
  } catch (cause) {
    throw pathError("invalid-claude-settings", `native config source for ${action.id} is not strict UTF-8 JSON`);
  }
  if (!object(settings) || !object(settings.statusLine) || settings.statusLine.type !== "command" || typeof settings.statusLine.command !== "string") {
    throw pathError("invalid-claude-settings", `native config source for ${action.id} has no supported statusLine command`);
  }
  settings.statusLine.command = renderClaudeStatuslineCommand({ configRoot: plan.productRoot, platform: plan.platform });
  return Buffer.from(`${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

function revalidatePlan(plan, { validateState = true } = {}) {
  const packageRoot = safeRoot(plan.packageRoot, "packageRoot", { required: true });
  for (const relativePath of requiredPackageFiles(plan.surface)) checkPackageFile(packageRoot, relativePath);
  if (validateState) validateManagedPackage(packageRoot, plan.surface, plan.profile);
  const productRoot = safeRoot(plan.productRoot, "productRoot", { required: true });
  const instructionRoot = safeRoot(plan.instructionRoot, "instructionRoot", { required: true });
  assertRootPair(plan.surface, productRoot, instructionRoot);
  for (const action of plan.actions) {
    if (action.kind !== "file-copy") continue;
    const sourcePath = checkPackageFile(packageRoot, action.sourceRelativePath);
    if (sourcePath !== action.sourcePath) throw pathError("source-mismatch", "native config source changed after planning");
    const selectedRoot = action.allowedRoot;
    if (selectedRoot !== productRoot && selectedRoot !== instructionRoot) throw pathError("root-confusion", "native config action uses an unplanned native root");
    const targetPath = resolve(selectedRoot, ...action.destinationRelativePath.split("/"));
    if (targetPath !== action.targetPath) throw pathError("destination-mismatch", "native config destination changed after planning");
    assertSafeDestinationRoot(dirname(targetPath), { allowedProductRoots: [selectedRoot] });
  }
}

function fsOperation(fileSystem, name, fallback) {
  return typeof fileSystem?.[name] === "function" ? fileSystem[name].bind(fileSystem) : fallback;
}

// File names come from the product cache; escape control characters so a
// crafted name cannot forge extra lines in the text report or on stderr.
function printable(value) {
  return String(value).replace(/[\u0000-\u001f\u007f-\u009f]/gu, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

function runtimeFile(relativePath) {
  return RUNTIME_FILES.has(relativePath) || RUNTIME_FILE_PREFIXES.some((prefix) => relativePath.startsWith(prefix));
}

function contains(root, candidate) {
  const suffix = relative(root, candidate);
  return !isAbsolute(suffix) && suffix.split(/[\\/]/u)[0] !== "..";
}

// Symlinks are never followed: a linked folder is reported as drift, and an
// owned file whose real parent leaves the copy is drift without being read.
async function treeDrift(root, expected, fileSystem) {
  const inspect = fsOperation(fileSystem, "lstat", defaultLstat);
  const read = fsOperation(fileSystem, "readFile", defaultReadFile);
  const list = fsOperation(fileSystem, "readdir", defaultReaddir);
  const canonical = fsOperation(fileSystem, "realpath", defaultRealpath);
  const realRoot = await canonical(root);
  const drift = new Set();
  for (const [relativePath, sha256] of expected) {
    const path = join(root, ...relativePath.split("/"));
    try {
      if (!contains(realRoot, await canonical(dirname(path)))) {
        drift.add(relativePath);
        continue;
      }
      const metadata = await inspect(path);
      if (!metadata.isFile() || hashBytes(await read(path)) !== sha256) drift.add(relativePath);
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") throw error;
      drift.add(relativePath);
    }
  }
  const visit = async (directory, prefix) => {
    for (const entry of await list(directory, { withFileTypes: true })) {
      const relativePath = `${prefix}${entry.name}`;
      if (entry.isDirectory()) await visit(join(directory, entry.name), `${relativePath}/`);
      else if (!expected.has(relativePath) && !runtimeFile(relativePath)) drift.add(relativePath);
    }
  };
  await visit(root, "");
  return [...drift].sort();
}

async function claudeCacheCheck(plan, listing, fileSystem) {
  const commands = [`claude plugin uninstall ${PLUGIN_SELECTOR} --scope user --keep-data`, `claude plugin install ${PLUGIN_SELECTOR} --scope user`];
  const uncomparable = "so the copy Claude loads cannot be compared with the package";
  const entry = Array.isArray(listing) ? listing.find((candidate) => object(candidate) && candidate.id === PLUGIN_SELECTOR && candidate.scope === "user") : undefined;
  if (!entry) return { reason: `claude plugin list --json has no user-scope entry for ${PLUGIN_SELECTOR}, ${uncomparable}`, commands };
  if (typeof entry.installPath !== "string" || entry.installPath.trim() === "") {
    return { reason: `the user-scope ${PLUGIN_SELECTOR} entry in claude plugin list --json has no installPath, ${uncomparable}`, commands };
  }
  const installPath = resolve(plan.productRoot, entry.installPath);
  const pluginCache = join(plan.productRoot, "plugins", "cache");
  try {
    assertSafeDestinationRoot(installPath, { allowedProductRoots: [pluginCache] });
  } catch (error) {
    return { reason: `the plugin copy Claude reports is outside the plugin cache ${pluginCache} or unsafe (${printable(error.message)}), ${uncomparable}`, commands };
  }
  const { ownershipPrefix, ownership } = validateManagedPackage(plan.packageRoot, plan.surface, plan.profile);
  const expected = new Map([...ownership].map(([relativePath, sha256]) => [relativePath.slice(ownershipPrefix.length), sha256]));
  let drift;
  try {
    await fsOperation(fileSystem, "lstat", defaultLstat)(installPath);
    drift = await treeDrift(installPath, expected, fileSystem);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return { reason: `the plugin copy Claude reports at ${printable(installPath)} does not exist`, commands };
    if (error?.code === "EACCES" || error?.code === "EPERM") return { reason: `the plugin copy Claude reports at ${printable(installPath)} cannot be read (${error.code}), ${uncomparable}`, commands };
    throw error;
  }
  if (drift.length === 0) return { reason: null, result: { comparedFiles: expected.size } };
  return { reason: `Claude loads the plugin from ${printable(installPath)}, which differs from the package in ${drift.length} file(s), such as ${drift.slice(0, 3).map(printable).join(", ")}. An install with an unchanged plugin version does not refresh that copy.`, commands };
}

// process-runner merges envOverrides into the ambient environment and cannot
// unset a key, so git and the Codex commands get a full copy without inherited
// GIT_* repository redirects. The copy is never written to a report.
function gitEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/iu.test(key)));
}

async function codexSourceCheck(plan, action, runProcess) {
  const git = async (args) => {
    const result = await runProcess({ executable: action.executable, args: [...args], cwd: action.cwd, env: gitEnvironment(), shell: false });
    if (!result || typeof result !== "object") throw pathError("invalid-process-result", `native action ${action.id} returned an invalid process result`);
    return result;
  };
  const failed = (result) => result.timedOut || result.outputTooLarge || result.exitCode !== 0;
  const prefix = await git(action.prefixArgs);
  if (prefix.unavailable) return { reason: "git is unavailable, so it cannot be checked that Codex serves the current package. Install git, then register again.", commands: [] };
  if (failed(prefix) || String(prefix.stdout ?? "").trim() !== "") {
    return { reason: "the package root must be its own Git repository, because Codex installs a Git clone of it. See docs/maintenance/native-registration.md, section Codex CLI.", commands: [] };
  }
  const status = await git(action.statusArgs);
  if (status.unavailable || failed(status)) return { reason: "git status could not read the package root, so it cannot be checked that Codex serves the current package.", commands: [] };
  if (String(status.stdout ?? "").trim() !== "") {
    // sanitizeReport replaces every packageRoot with <PACKAGE_ROOT>, so no
    // path text, and no quote in it, reaches a printed command.
    return {
      reason: "Codex installs a Git clone of the package root, and the package working tree differs from its HEAD commit, so Codex keeps serving the last commit.",
      commands: [
        `git -C '${plan.packageRoot}' status --short`,
        `git -C '${plan.packageRoot}' add -A`,
        `git -C '${plan.packageRoot}' -c user.name=all-about-agents -c user.email=all-about-agents@invalid.example commit -m "Update local Codex plugin source"`,
        `codex plugin remove ${PLUGIN_SELECTOR} --json`,
        `codex plugin add ${PLUGIN_SELECTOR} --json`
      ]
    };
  }
  return { reason: null, result: { exitCode: 0 } };
}

function failedLifecycle(plan, error) {
  return {
    ...plan.lifecycle,
    registered: {
      status: "fail",
      evidence: `Required registration action failed before native semantic discovery was observed: ${error.code || "native-action-failed"}.`
    }
  };
}

function sanitizeString(value, plan) {
  let output = value;
  const protectedEmergencyPath = "write_file(/home/user/.ssh)";
  const protectedToken = "__AAA_PROTECTED_EMERGENCY_PATH__";
  output = output.split(protectedEmergencyPath).join(protectedToken);
  const homeCandidates = [
    homedir(),
    process.env.USERPROFILE,
    process.env.HOMEDRIVE && process.env.HOMEPATH ? join(process.env.HOMEDRIVE, process.env.HOMEPATH) : null
  ].filter((candidate, index, values) => typeof candidate === "string" && candidate !== "" && values.indexOf(candidate) === index);
  const replacements = [
    [plan.packageRoot, "<PACKAGE_ROOT>"],
    [plan.productRoot, "<PRODUCT_ROOT>"],
    [plan.instructionRoot, "<INSTRUCTION_ROOT>"],
    ...homeCandidates.map((candidate) => [candidate, "<HOME>"])
  ].filter(([needle]) => typeof needle === "string" && needle !== "");
  const variants = replacements.flatMap(([needle, replacement]) => plan.platform === "win32"
    ? [[needle, replacement], [needle.replaceAll("\\", "/"), replacement], [needle.replaceAll("/", "\\"), replacement]]
    : [[needle, replacement]]);
  const seen = new Set();
  for (const [needle, replacement] of variants.sort((left, right) => right[0].length - left[0].length)) {
    const key = `${needle}\0${replacement}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    output = output.replace(new RegExp(escaped, plan.platform === "win32" ? "giu" : "gu"), replacement);
  }
  return output.split(protectedToken).join(protectedEmergencyPath);
}

function sanitizeReport(value, plan) {
  if (typeof value === "string") return sanitizeString(value, plan);
  if (Array.isArray(value)) return value.map((entry) => sanitizeReport(entry, plan));
  if (!object(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, sanitizeReport(child, plan)]));
}

function assertAuthenticPlan(plan) {
  if (!object(plan) || !AUTHENTIC_PLANS.has(plan)) {
    const error = new TypeError("native registration plan was not created by planNativeRegistration");
    error.code = "untrusted-plan";
    throw error;
  }
}

/** Execute a plan with injected process/filesystem seams; dry-run is side-effect free. */
export async function runNativeRegistration(plan, { mode = "dry-run", runProcess = defaultRunProcess, fileSystem = {} } = {}) {
  assertAuthenticPlan(plan);
  if (plan.schemaVersion !== 1 || !SURFACE_SET.has(plan.surface) || !Array.isArray(plan.actions)) throw new TypeError("invalid native registration plan");
  if (mode !== "dry-run" && mode !== "apply") throw new TypeError("mode must be dry-run or apply");
  if (typeof runProcess !== "function") throw new TypeError("runProcess must be a function");
  if (mode === "dry-run") {
    revalidatePlan(plan, { validateState: true });
    return sanitizeReport({ schemaVersion: 1, action: "register", mode, status: "dry-run", surface: plan.surface, profile: plan.profile, packageRoot: plan.packageRoot, productRoot: plan.productRoot, instructionRoot: plan.instructionRoot, actions: plan.actions.map((action) => reportAction(action, action.kind === "manual" ? "manual-required" : "planned")), completed: [], failed: null, notAttempted: [], lifecycle: plan.lifecycle }, plan);
  }
  const completed = [];
  const actionReports = [];
  const probes = new Map();
  let overlay = null;
  let stale = null;
  let followUp = null;
  for (let index = 0; index < plan.actions.length; index += 1) {
    const action = plan.actions[index];
    try {
      // Re-check every immutable plan's roots and fixed marker paths immediately
      // before each action. A root can be redirected after planning.
      revalidatePlan(plan, { validateState: index === 0 || action.kind === "process" || action.kind === "settings-overlay" });
      if (action.kind === "manual") {
        actionReports.push(reportAction(action, "manual-required"));
        if (action.required) followUp ??= action.message;
      } else if (action.kind === "plugin-cache-check" || action.kind === "git-source-check") {
        const check = action.kind === "plugin-cache-check" ? await claudeCacheCheck(plan, probes.get(action.probe), fileSystem) : await codexSourceCheck(plan, action, runProcess);
        if (check.reason !== null) {
          stale ??= check.reason;
          actionReports.push(reportAction(action, "manual-required", { reason: check.reason, commands: check.commands }));
          continue;
        }
        actionReports.push(reportAction(action, "complete", { result: check.result }));
      } else if (action.kind === "settings-overlay") {
        const transformOverlay = action.transform ? (bytes) => transformCopyContent(action, bytes, plan) : null;
        try {
          overlay = await mergeSettingsOverlay({ targetPath: action.targetPath, overlayPath: action.overlayPath, expectedOverlayHash: action.expectedOverlayHash, allowedRoot: action.allowedRoot, transformOverlay, fileSystem });
        } catch (error) {
          if (error?.code !== "settings-permission-list-invalid") throw error;
          followUp ??= error.message;
          actionReports.push(reportAction(action, "manual-required", { reason: error.message }));
          continue;
        }
        actionReports.push(reportAction(action, "complete", { result: { changed: overlay.changed, bytes: overlay.bytes, beforeHash: overlay.beforeHash, afterHash: overlay.afterHash } }));
      } else if (action.kind === "file-copy") {
        const read = typeof fileSystem?.readFile === "function" ? fileSystem.readFile.bind(fileSystem) : defaultReadFile;
        const sourceContent = await read(action.sourcePath);
        if (!(sourceContent instanceof Uint8Array)) throw pathError("invalid-source-bytes", `native config source for ${action.id} did not return bytes`);
        if (hashBytes(sourceContent) !== action.expectedSourceHash) throw pathError("package-owned-hash-mismatch", `managed package source changed after planning: ${action.sourceRelativePath}`);
        const content = transformCopyContent(action, sourceContent, plan);
        const expectedHash = hashBytes(content);
        const existing = await readExistingDestination(action.targetPath, fileSystem);
        const sameBytes = existing !== null && hashBytes(existing.content) === expectedHash;
        if (sameBytes && modeMatches(action, existing)) {
          actionReports.push(reportAction(action, "complete", { result: { bytes: content.byteLength, sha256: expectedHash, overwrite: false, changed: false } }));
          completed.push(action);
          continue;
        }
        if (action.guard === "no-clobber" && existing !== null && !sameBytes) {
          // The destination is shared with the product and other tools. Never
          // replace it; it is complete when it already contains the managed content.
          const decoder = new TextDecoder("utf-8");
          const missing = CONTAINMENT_CHECKS.get(action.match)(decoder.decode(content), decoder.decode(existing.content));
          if (missing.length === 0) {
            actionReports.push(reportAction(action, "complete", { result: { bytes: content.byteLength, sha256: expectedHash, overwrite: false, changed: false, containsManagedContent: true } }));
            completed.push(action);
            continue;
          }
          const reason = `${action.destinationRelativePath} already exists and differs from the managed source, and it lacks managed content: ${missing.join(", ")}; merge the missing content into it by hand instead of overwriting unowned content`;
          followUp ??= reason;
          actionReports.push(reportAction(action, "manual-required", { reason }));
          continue;
        }
        const written = await atomicReplaceFile({ destination: action.targetPath, content, expectedHash, mode: action.mode, allowedProductRoots: [action.allowedRoot], fileSystem });
        actionReports.push(reportAction(action, "complete", { result: { bytes: content.byteLength, sha256: written.sha256, overwrite: true, changed: true } }));
      } else {
        const explicitEnv = envFor(plan, action);
        // Codex clones the package with git, so a GIT_* redirect inherited from
        // a git hook must not reach that clone.
        const environment = plan.surface === "codex" ? { env: { ...gitEnvironment(), ...explicitEnv } } : { envOverrides: explicitEnv };
        const result = await runProcess({ executable: action.executable, args: [...action.args], cwd: action.cwd, environmentKeys: [...(action.environmentKeys || [])], ...environment, shell: false });
        if (!result || typeof result !== "object") throw pathError("invalid-process-result", `native action ${action.id} returned an invalid process result`);
        if (result.unavailable) throw pathError("native-executable-unavailable", `${action.executable} is unavailable; install it and retry registration`);
        if (result.timedOut) throw pathError("native-process-timeout", `${action.id} timed out`);
        if (result.outputTooLarge) throw pathError("native-process-output-too-large", `${action.id} exceeded the bounded output capture`);
        if (result.exitCode !== 0) throw pathError("native-process-failed", `${action.id} exited with code ${String(result.exitCode)}`);
        const parsed = probeOutput(action, result);
        probes.set(action.id, parsed);
        actionReports.push(reportAction(action, "complete", { result: { exitCode: result.exitCode, probe: parsed === null ? "not-run" : "valid-json" } }));
      }
      if (action.kind !== "manual") completed.push(action);
    } catch (error) {
      const message = printable(error.message);
      const failed = { action: reportAction(action, "failed", { reason: message }), reason: message, error: { code: error.code || "native-action-failed", message } };
      actionReports.push(failed.action);
      return sanitizeReport({ schemaVersion: 1, action: "register", mode, status: completed.length > 0 ? "partial" : "failed", surface: plan.surface, profile: plan.profile, packageRoot: plan.packageRoot, productRoot: plan.productRoot, instructionRoot: plan.instructionRoot, actions: actionReports, completed, failed, error: failed.error, notAttempted: plan.actions.slice(index + 1), lifecycle: failedLifecycle(plan, failed.error), ...(overlay ? { overlay } : {}) }, plan);
    }
  }
  const registered = stale
    ? { status: "fail", evidence: "The product still serves an older copy of the package; run the commands of the manual-required check, then register again." }
    : { status: "not-run", evidence: "Commands completed, but native semantic registration/discovery was not independently observed; run the product discovery probe and record T07 evidence." };
  const error = stale
    ? { code: "installed-copy-not-confirmed", message: stale }
    : followUp ? { code: "manual-step-required", message: followUp } : null;
  return sanitizeReport({ schemaVersion: 1, action: "register", mode, status: error ? "manual-required" : "complete", surface: plan.surface, profile: plan.profile, packageRoot: plan.packageRoot, productRoot: plan.productRoot, instructionRoot: plan.instructionRoot, actions: actionReports, completed, failed: null, notAttempted: [], lifecycle: { ...plan.lifecycle, registered }, ...(error ? { error } : {}), ...(overlay ? { overlay } : {}) }, plan);
}

export function resolveNativeProductRoot(surface, { env = process.env, homeDir = homedir(), platform = process.platform } = {}) {
  if (surface === "antigravity") return resolveGeminiHome({ env, homeDir, platform });
  if (surface === "claude") return resolveClaudeConfigDir({ env, homeDir, platform });
  if (surface === "codex") return resolveCodexHome({ env, homeDir, platform });
  return null;
}

export function resolveNativeInstructionRoot(surface, { env = process.env, homeDir = homedir(), platform = process.platform } = {}) {
  if (surface === "antigravity") return resolveGeminiHome({ env, homeDir, platform });
  if (surface === "claude") return resolveClaudeConfigDir({ env, homeDir, platform });
  if (surface === "codex") return resolveCodexHome({ env, homeDir, platform });
  throw pathError("unsupported-surface", `unsupported registration surface: ${String(surface)}`);
}

export function formatNativeRegistrationText(report) {
  const lines = [`action=${report.action} mode=${report.mode} status=${report.status}`, `surface=${report.surface} profile=${report.profile}`, `productRoot=${report.productRoot ?? "<NONE>"} instructionRoot=${report.instructionRoot ?? "<NONE>"}`];
  for (const action of report.actions || []) {
    lines.push(`${action.status}\t${printable(action.id)}\t${action.kind}`);
    const note = action.reason ?? action.message;
    if (action.status === "manual-required" && note) lines.push(`reason\t${printable(action.id)}\t${printable(note)}`);
    for (const command of action.commands || []) lines.push(`run\t${printable(action.id)}\t${printable(command)}`);
  }
  if (report.error) lines.push(`error\t${report.error.code}\t${printable(report.error.message)}`);
  return `${lines.join("\n")}\n`;
}
