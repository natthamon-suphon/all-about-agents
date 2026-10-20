#!/usr/bin/env node
// Manual model-run trigger suite (phase 4b of docs/plans/2026-09-18-simplify-to-claude-codex.md).
// Runs real `claude -p` sessions for the routing cases of a few critical skills and records
// PASS / FAIL / NOT_RUN_UNAVAILABLE per case. Never part of quality:quick or quality:full.
// Every process runs through scripts/lib/process-runner.mjs with a structured argument
// list; prompts and paths never pass through a shell.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { equalBytes } from "../../installers/lib/hash.mjs";
import { renderForSurface } from "../../installers/lib/render.mjs";
import { runProcess } from "../../scripts/lib/process-runner.mjs";
import { TRIGGER_SUITE_PREFIX } from "./suite-age.mjs";

const ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const DEFAULT_CASE_TIMEOUT_MS = 300_000;
const OUTPUT_DIR = ".aaa/eval-runs";
const EXCERPT_LENGTH = 400;
const PLUGIN_SELECTOR = "all-about-agents@all-about-agents";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Redact user paths and email-like tokens before anything leaves the process. */
export function redact(text, home = homedir()) {
  let value = String(text ?? "");
  if (home) value = value.split(home).join("<HOME>").split(home.replaceAll("\\", "/")).join("<HOME>");
  value = value.replace(/(?:[A-Za-z]:\\Users\\|\/(?:Users|home)\/)[^\s"'`]+/gu, "<USER_PATH>");
  value = value.replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/gu, "<EMAIL>");
  value = value.replace(/\b(?:sk|pk)-[A-Za-z0-9_-]{16,}|\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|\b(?:api[_ -]?key|access[_ -]?token|password|secret)\s*[:=]\s*\S+/giu, "[REDACTED]");
  return value;
}

/** Resolve the per-case budget; a slow session is an environment fact, not a routing verdict. */
export function resolveCaseTimeoutMs(env = process.env) {
  const raw = Number(env?.AAA_CASE_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CASE_TIMEOUT_MS;
}

// The question is scoped to this package. A machine may carry unrelated skills
// that outcompete one of ours, which is a fact about that machine and not a
// defect this package can fix, so the suite asks which of ours applies.
const TRAILER_INSTRUCTION = "End your answer with one final line, exactly:\nskill: <the all-about-agents skill you route this to, or none>";
const TRAILER_LINE = /^[\s*_`#>-]*skill\s*:\s*(.+?)\s*$/iu;
const NAMESPACE_PREFIX = "all-about-agents:";
const SKILL_TOKEN = /[a-z0-9][a-z0-9:-]*/u;
const SKILL_FILE = /^skills\/[^/]+\/SKILL\.md$/u;

/** Append the routing trailer the scorer reads. The case prompt itself stays untouched. */
export function buildCasePrompt(prompt) {
  return `${String(prompt ?? "")}\n\n${TRAILER_INSTRUCTION}`;
}

/**
 * Read the routed skill from the last `skill:` line. Prose that merely contains
 * the word does not match, so declining a skill by name never reads as routing
 * to it. Only the first skill name counts, so "none - nothing applies" reads as
 * "none". A bare namespace is not a name, so "all-about-agents: brainstorming"
 * reads as "brainstorming". Returns that name, or null when no trailer names one.
 */
export function parseSkillTrailer(text) {
  const lines = String(text ?? "").split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = lines[index].match(TRAILER_LINE);
    if (!match) continue;
    const value = match[1].toLowerCase();
    const token = value.match(SKILL_TOKEN);
    if (!token) return null;
    if (!token[0].startsWith(NAMESPACE_PREFIX)) return token[0];
    const name = token[0].slice(NAMESPACE_PREFIX.length) || value.slice(token.index + token[0].length).match(SKILL_TOKEN)?.[0];
    return name || null;
  }
  return null;
}

/**
 * Classify one routing case from the model's final text. Pure; no I/O.
 *
 * A router skill dispatches to another skill, so its trigger case asserts that
 * the check produced a route, not that the router named itself, and its
 * nontrigger case asserts no route at all. Its pressure case stays strict,
 * because the rule under pressure lives in the router itself.
 */
export function evaluateRouteText({ skill, caseSpec, resultText, forbiddenPressurePhrases, isRouter = false, packageSkills = null }) {
  const text = String(resultText ?? "");
  const routed = parseSkillTrailer(text);
  const kind = /-TRIGGER-/u.test(caseSpec.id) ? "trigger" : /-NONTRIGGER-/u.test(caseSpec.id) ? "nontrigger" : /-PRESSURE-/u.test(caseSpec.id) ? "pressure" : "unknown";
  if (kind === "unknown") return { status: "FAIL", kind, reason: "case id does not name TRIGGER, NONTRIGGER, or PRESSURE" };
  if (routed === null) return { status: "FAIL", kind, reason: "no skill: trailer line with a skill name, so no routing verdict was given" };
  const matched = routed === skill.toLowerCase();
  if (kind === "nontrigger") {
    if (isRouter) return routed === "none" ? { status: "PASS", kind, reason: "bootstrap routing stayed off" } : { status: "FAIL", kind, reason: `a dispatched worker must not route, but routed to "${routed}"` };
    // A nontrigger case asserts that this skill stays unrouted, not that the
    // answer routes nowhere, so another skill in the trailer is still a pass.
    return matched ? { status: "FAIL", kind, reason: "skill was routed for a nontrigger prompt" } : { status: "PASS", kind, reason: `skill stayed unrouted (trailer: ${routed})` };
  }
  if (isRouter && kind === "trigger") {
    return packageSkills?.has(routed) ? { status: "PASS", kind, reason: `skill check routed to ${routed}` } : { status: "FAIL", kind, reason: `the skill check produced no route to a skill of this package (trailer: ${routed})` };
  }
  if (!matched) {
    const foreign = routed !== "none" && packageSkills && !packageSkills.has(routed) ? " (not a skill of this package)" : "";
    return { status: "FAIL", kind, reason: `routed to "${routed}"${foreign} instead of ${skill}` };
  }
  if (kind === "pressure") {
    const hit = (forbiddenPressurePhrases ?? []).find((phrase) => text.toLowerCase().includes(String(phrase).toLowerCase()));
    if (hit) return { status: "FAIL", kind, reason: `pressure case implemented anyway ("${hit}")` };
  }
  return { status: "PASS", kind, reason: "skill routed" };
}

const MAX_STREAM_BYTES = 8 * 1024 * 1024;
const canonicalPath = (value) => {
  if (typeof value !== "string" || !value) return null;
  const path = existsSync(value) ? realpathSync(value) : resolve(value);
  return process.platform === "win32" ? path.toLowerCase() : path;
};
const toolText = (content) => typeof content === "string" ? content : Array.isArray(content) ? content.filter((part) => part?.type === "text").map((part) => part.text).join("\n") : "";

/** Parse complete native records only; retain normalized facts, never raw init or tool bodies. */
export function parseClaudeStream(stdout, { candidateRoot, packageSkills = new Set(), outputTooLarge = false, maxBytes = MAX_STREAM_BYTES } = {}) {
  const errors = [];
  const calls = new Map();
  const completed = new Set();
  const loaded = new Set();
  const models = new Set();
  const array = (value, label) => {
    if (value === undefined) return [];
    if (Array.isArray(value)) return value;
    errors.push(`invalid ${label} array`);
    return [];
  };
  let init = null, result = null, effort = null;
  const raw = String(stdout ?? "");
  if (outputTooLarge || Buffer.byteLength(raw) > maxBytes) errors.push("stream output exceeded capture limit");
  const lines = raw.split(/\r?\n/u).filter((line) => line.trim());
  if (lines.length > 10000) errors.push("stream record limit exceeded");
  for (const line of lines.slice(0, 10000)) {
    if (Buffer.byteLength(line) > 1024 * 1024) { errors.push("stream record exceeded size limit"); continue; }
    let event;
    try { event = JSON.parse(line); } catch { errors.push("malformed or partial stream record"); continue; }
    if (!event || typeof event !== "object" || Array.isArray(event) || typeof event.type !== "string") { errors.push("invalid stream envelope"); continue; }
    if (result && ["assistant", "user", "result"].includes(event.type)) errors.push("conversation record follows final result");
    if (event.type === "system" && event.subtype === "init") {
      if (init) errors.push("duplicate init event");
      init = event;
      if (typeof event.model === "string") models.add(event.model);
      if (typeof event.effort === "string") effort = event.effort;
    }
    if (event.type === "assistant") {
      if (typeof event.message?.model === "string") models.add(event.message.model);
      for (const block of array(event.message?.content, "assistant content")) {
        if (block?.type !== "tool_use") continue;
        if (typeof block.id !== "string" || !/^[\w-]{1,160}$/u.test(block.id)) { errors.push("invalid tool-use ID"); continue; }
        const parent = event.parent_tool_use_id;
        const key = `${String(parent)}:${block.id}`;
        if (calls.has(key)) { errors.push("duplicate tool-use ID"); continue; }
        let skill = null, fullReadPath = null;
        if (block.name === "Skill") {
          const name = typeof block.input?.skill === "string" && block.input.skill.startsWith(NAMESPACE_PREFIX) ? block.input.skill.slice(NAMESPACE_PREFIX.length) : null;
          if (packageSkills.has(name)) skill = name;
          else errors.push("native Skill call names an unknown candidate skill");
        }
        if (block.name === "Read" && typeof block.input?.file_path === "string") {
          for (const name of packageSkills) {
            const expected = join(candidateRoot, "skills", name, "SKILL.md");
            if (canonicalPath(block.input.file_path) === canonicalPath(expected)) { skill = name; fullReadPath = expected; break; }
          }
        }
        calls.set(key, { id: block.id, main: parent === null, tool: block.name === "Skill" || block.name === "Read" ? block.name : "other", skill, fullReadPath, completed: false, success: false });
      }
    }
    if (event.type === "user") {
      for (const block of array(event.message?.content, "user content")) {
        if (block?.type !== "tool_result") continue;
        const key = `${String(event.parent_tool_use_id)}:${block.tool_use_id}`;
        const call = calls.get(key);
        if (!call) continue;
        if (completed.has(key)) { errors.push("duplicate tool completion"); continue; }
        completed.add(key);
        call.completed = true;
        const text = toolText(block.content);
        call.success = block.is_error !== true && text.trim().length > 0 && !/^\s*(?:error\b|permission denied\b|tool (?:use |call )?denied\b|unknown skill\b|skill .*not found\b)/iu.test(text);
        if (call.tool === "Read") {
          const file = event.tool_use_result?.type === "text" ? event.tool_use_result.file : null;
          call.success &&= !!file && canonicalPath(file.filePath) === canonicalPath(call.fullReadPath) && file.startLine === 1 && Number.isInteger(file.totalLines) && file.totalLines > 0 && file.numLines === file.totalLines && file.truncatedByTokenCap !== true && typeof file.content === "string" && file.content.length > 0;
        }
        if (call.main && call.success && call.skill) loaded.add(call.skill);
      }
    }
    if (event.type === "result") {
      if (result) errors.push("duplicate final result");
      result = event;
      for (const model of Object.keys(event.modelUsage ?? {})) models.add(model);
    }
  }
  if (!init) errors.push("candidate init event is missing");
  if (!result || typeof result.result !== "string") errors.push("complete final result is missing");
  if (result && (result.is_error === true || result.subtype !== "success")) errors.push("native final result is an error");
  if (array(result?.permission_denials, "permission denials").length > 0) errors.push("native permission denial was reported");
  const plugins = array(init?.plugins, "init plugins");
  const tools = array(init?.tools, "init tools");
  const servers = array(init?.mcp_servers, "init MCP servers");
  const availableSkills = array(init?.skills, "init skills");
  const candidateSkillCount = availableSkills.filter((skill) => typeof skill === "string" && skill.startsWith(NAMESPACE_PREFIX) && packageSkills.has(skill.slice(NAMESPACE_PREFIX.length))).length;
  const candidateEntries = plugins.filter((plugin) => plugin?.name === "all-about-agents");
  const candidateLoaded = !!candidateRoot && candidateEntries.length === 1 && canonicalPath(candidateEntries[0].path) === canonicalPath(candidateRoot);
  if (!candidateLoaded) errors.push("candidate init plugin path does not match the selected load root");
  const pluginErrors = array(init?.plugin_errors, "init plugin errors").length;
  if (pluginErrors > 0) errors.push("native plugin component error was reported");
  return {
    valid: errors.length === 0, errors: [...new Set(errors)], candidateLoaded,
    loadedSkills: [...loaded].sort(),
    calls: [...calls.values()].map(({ fullReadPath: _path, ...call }) => call),
    models: [...models].sort(), effort, cliVersion: typeof init?.claude_code_version === "string" ? init.claude_code_version : null,
    noncandidatePluginCount: plugins.length - candidateEntries.length,
    candidateSkillCount, foreignSkillCount: availableSkills.length - candidateSkillCount,
    mcpServerCount: servers.length,
    unexpectedTools: tools.filter((tool) => !["Skill", "EndConversation"].includes(tool)).length,
    pluginErrorCount: pluginErrors,
    resultText: typeof result?.result === "string" ? result.result : "",
    isError: result?.is_error === true,
    resultErrors: Array.isArray(result?.errors) ? result.errors.slice(0, 3).map((error) => redact(oneLine(error))) : []
  };
}

/** Route text is a separate claim. Invocation PASS also requires native load evidence. */
export function evaluateCase(options) {
  const textVerdict = evaluateRouteText(options);
  const observation = options.observation;
  if (!observation?.valid || !observation.candidateLoaded) return { status: "FAIL", kind: textVerdict.kind, reason: observation?.errors?.join("; ") || "native candidate invocation evidence is missing" };
  const routed = parseSkillTrailer(options.resultText);
  if (routed !== null && routed !== "none" && !options.packageSkills?.has(routed)) return { status: "FAIL", kind: textVerdict.kind, reason: "trailer names an unknown package skill" };
  if (textVerdict.kind === "nontrigger") {
    const unwanted = observation.calls.some((call) => call.main && ["Skill", "Read"].includes(call.tool) && (options.isRouter || call.skill === options.skill));
    return unwanted ? { status: "FAIL", kind: textVerdict.kind, reason: "native load was attempted for a nontrigger prompt" } : textVerdict;
  }
  if (textVerdict.status !== "PASS") return textVerdict;
  const expected = options.isRouter && textVerdict.kind === "trigger" ? routed : options.skill;
  return observation.loadedSkills.includes(expected) ? { ...textVerdict, reason: "route text and correlated main-conversation candidate load agree" } : { status: "FAIL", kind: textVerdict.kind, reason: "route text has no successful matching main-conversation candidate load" };
}

// Claude loads skills from its plugin cache, which a same-version install does
// not refresh. Every skill description shapes routing, so any drift is stale.
async function staleSkillFiles(root, installPath, home) {
  const rendered = await renderForSurface({ repositoryRoot: root, surface: "claude", env: {}, homeDir: home, platform: process.platform });
  return rendered.files.filter((file) => SKILL_FILE.test(file.relativePath)).filter((file) => {
    const installed = join(installPath, ...file.relativePath.split("/"));
    return !existsSync(installed) || !equalBytes(readFileSync(installed), file.content);
  }).map((file) => file.relativePath);
}

/** Preconditions that make a green run meaningful; each failure is a NOT_RUN_UNAVAILABLE reason. */
export async function checkPreconditions({ root = ROOT, home = homedir(), env = process.env, run = runProcess, mode = "installed" } = {}) {
  const reasons = [];
  const pkg = readJson(join(root, "package.json"));
  const version = await run({ executable: "claude", args: ["--version"], cwd: root, timeoutMs: 20_000 });
  if (version.unavailable || version.exitCode !== 0) reasons.push("claude executable is unavailable");
  const configDir = env.CLAUDE_CONFIG_DIR && env.CLAUDE_CONFIG_DIR.trim() ? env.CLAUDE_CONFIG_DIR : join(home, ".claude");
  if (mode === "rendered") {
    if (reasons.length === 0) {
      const auth = await run({ executable: "claude", args: ["auth", "status", "--json"], cwd: root, timeoutMs: 20_000 });
      let loggedIn = false;
      try { loggedIn = JSON.parse(auth.stdout).loggedIn === true; } catch { reasons.push("claude auth status did not return valid JSON"); }
      if (auth.unavailable || auth.exitCode !== 0 || !loggedIn) reasons.push("claude session is not authenticated");
    }
    return { ok: reasons.length === 0, reasons, packageVersion: pkg.version, configDir, mode };
  }
  if (mode !== "installed") throw new TypeError("model suite mode must be installed or rendered");
  const installed = join(configDir, "plugins", "installed_plugins.json");
  let installPath = null;
  if (!existsSync(installed)) reasons.push("installed_plugins.json is missing");
  else {
    const entry = readJson(installed).plugins?.[PLUGIN_SELECTOR]?.[0];
    installPath = entry?.installPath ?? null;
    if (!entry) reasons.push("all-about-agents plugin is not installed");
    else if (entry.version !== pkg.version) reasons.push(`installed package stale: plugin ${entry.version}, package.json ${pkg.version}`);
    else if (!existsSync(join(entry.installPath, ".claude-plugin", "plugin.json"))) reasons.push("installed plugin cache is missing its manifest");
    else {
      try {
        const stale = await staleSkillFiles(root, entry.installPath, home);
        if (stale.length > 0) reasons.push(`installed plugin cache is stale: ${String(stale.length)} skill file(s) differ from this checkout, such as ${stale.slice(0, 3).join(", ")}; run claude plugin uninstall ${PLUGIN_SELECTOR} --scope user --keep-data, then claude plugin install ${PLUGIN_SELECTOR} --scope user`);
      } catch (error) {
        reasons.push(`this checkout does not render for Claude, so the plugin cache cannot be compared: ${oneLine(error?.message ?? error)}`);
      }
    }
  }
  if (!existsSync(join(configDir, "CLAUDE.md"))) reasons.push("rendered global CLAUDE.md is not deployed to the config directory");
  return { ok: reasons.length === 0, reasons, packageVersion: pkg.version, configDir, installPath, mode };
}

/** Return the fixture repository, or the reason it could not be made. */
async function makeDisposableRepo(run) {
  const dir = mkdtempSync(join(tmpdir(), "aaa-trigger-suite-"));
  writeFileSync(join(dir, "README.md"), "# Trigger suite fixture\n\nA small repository used only for headless routing checks.\n", "utf8");
  const init = await run({ executable: "git", args: ["init", "-q"], cwd: dir, timeoutMs: 30_000 });
  if (!init.unavailable && init.exitCode === 0) return { dir, error: null };
  rmSync(dir, { recursive: true, force: true });
  return { dir: null, error: `git init failed: ${init.unavailable ? "git is unavailable" : oneLine(init.stderr) || `exit ${String(init.exitCode)}`}` };
}

function oneLine(text) {
  return String(text ?? "").trim().split("\n")[0].slice(0, 200);
}

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const digestFiles = (files) => hash(files.map((file) => `${file.relativePath}\0${file.sha256}\n`).join(""));
const LAUNCH_ERROR_CODES = new Set(["EACCES", "EPERM", "ENOENT", "ENOTDIR", "ENOEXEC", "EAGAIN", "EMFILE", "ENFILE", "ENOMEM", "ETXTBSY"]);
const prerequisiteError = (message) => Object.assign(new Error(message), { code: "model-suite-prerequisite" });

async function prepareCandidate(root, mode, pre, profile) {
  const rendered = await renderForSurface({ repositoryRoot: root, surface: "claude", profile, env: pre.configDir ? { CLAUDE_CONFIG_DIR: pre.configDir } : {}, homeDir: homedir(), platform: process.platform });
  const temporary = mode === "rendered";
  const dir = temporary ? mkdtempSync(join(tmpdir(), "aaa-model-candidate-")) : pre.installPath;
  if (!dir || !existsSync(dir)) throw prerequisiteError("selected candidate load root is unavailable");
  try {
    for (const file of rendered.files) {
      if (!temporary) continue;
      const destination = join(dir, ...file.relativePath.split("/"));
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, file.content);
    }
    const files = rendered.files.map((file) => ({ relativePath: file.relativePath, sha256: hash(file.content) }));
    const manifest = readJson(join(dir, ".claude-plugin", "plugin.json"));
    if (manifest.name !== "all-about-agents" || manifest.version !== pre.packageVersion) throw prerequisiteError("candidate manifest does not match this package name/version");
    const global = rendered.files.find((file) => file.relativePath === "config/CLAUDE.md");
    if (!global) throw prerequisiteError("candidate global instructions are missing");
    const candidate = { dir, temporary, files, sourceHash: digestFiles(files), globalHash: hash(global.content), globalText: new TextDecoder().decode(global.content) };
    if (snapshotCandidate(candidate).hash !== candidate.sourceHash) throw prerequisiteError("candidate bytes differ from selected profile/config render before any model call");
    return candidate;
  } catch (error) {
    if (temporary) rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

function snapshotCandidate(candidate) {
  const files = candidate.files.map(({ relativePath }) => {
    const path = join(candidate.dir, ...relativePath.split("/"));
    return { relativePath, sha256: existsSync(path) ? hash(readFileSync(path)) : "MISSING" };
  });
  return { files, hash: digestFiles(files) };
}

async function isolatedSettings(candidate, run, cwd) {
  const listing = await run({ executable: "claude", args: ["--plugin-dir", candidate.dir, "--setting-sources", "user", "plugin", "list", "--json"], cwd, timeoutMs: 20_000, maxOutputBytes: MAX_STREAM_BYTES });
  if (listing.unavailable || listing.exitCode !== 0 || listing.outputTooLarge || listing.timedOut) throw prerequisiteError("candidate plugin inventory is unavailable");
  let plugins;
  try { plugins = JSON.parse(listing.stdout); } catch { throw prerequisiteError("candidate plugin inventory is not valid JSON"); }
  if (!Array.isArray(plugins) || plugins.some((plugin) => typeof plugin?.id !== "string" || typeof plugin?.enabled !== "boolean")) throw prerequisiteError("candidate plugin inventory has an unsupported schema");
  const enabledPlugins = Object.fromEntries(plugins.filter((plugin) => plugin.id !== "all-about-agents@inline").map((plugin) => [plugin.id, false]));
  enabledPlugins["all-about-agents@inline"] = true;
  return { disableAllHooks: true, disableSkillShellExecution: true, disableClaudeAiConnectors: true, disableBundledSkills: true, autoMemoryEnabled: false, enabledPlugins };
}

async function effectiveInventory(candidate, settings, run, cwd) {
  const result = await run({ executable: "claude", args: ["--plugin-dir", candidate.dir, "--setting-sources", "user", "--settings", JSON.stringify(settings), "plugin", "list", "--json"], cwd, timeoutMs: 20_000, maxOutputBytes: MAX_STREAM_BYTES });
  if (result.unavailable || result.exitCode !== 0 || result.timedOut || result.outputTooLarge) throw prerequisiteError("effective per-run plugin inventory is unavailable");
  let plugins;
  try { plugins = JSON.parse(result.stdout); } catch { throw prerequisiteError("effective plugin inventory is not valid JSON"); }
  if (!Array.isArray(plugins) || plugins.some((plugin) => typeof plugin?.id !== "string" || typeof plugin?.enabled !== "boolean")) throw prerequisiteError("effective plugin inventory has an unsupported schema");
  const candidateRows = plugins.filter((plugin) => plugin.id === "all-about-agents@inline");
  const otherRows = plugins.filter((plugin) => plugin.id !== "all-about-agents@inline");
  return { rowCount: plugins.length, candidateRows: candidateRows.length, enabledCandidateRows: candidateRows.filter((plugin) => plugin.enabled).length, disabledNoncandidateRows: otherRows.filter((plugin) => !plugin.enabled).length, enabledNoncandidateRows: otherRows.filter((plugin) => plugin.enabled).length };
}

async function runClaude(prompt, cwd, run, timeoutMs, candidate, settings, packageSkills) {
  const started = Date.now();
  const before = snapshotCandidate(candidate);
  let result;
  try { result = await run({
    executable: "claude",
    args: ["-p", prompt, "--output-format", "stream-json", "--verbose", "--permission-mode", "plan", "--permission-prompts", "none", "--no-session-persistence",
      "--plugin-dir", candidate.dir, "--append-system-prompt", candidate.globalText, "--setting-sources", "user", "--settings", JSON.stringify(settings),
      "--tools", "Skill", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--disallowedTools", "mcp__*", "--no-chrome"],
    cwd,
    timeoutMs,
    maxOutputBytes: MAX_STREAM_BYTES,
    envOverrides: { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" }
  }); } catch (error) {
    if (!LAUNCH_ERROR_CODES.has(error?.code)) throw error;
    const launchError = { code: error.code, reason: redact(`claude launch failed (${error.code}): ${oneLine(error.message)}`).slice(0, EXCERPT_LENGTH) };
    result = { exitCode: null, stdout: "", stderr: "", unavailable: true, timedOut: false, outputTooLarge: false, launchError };
  }
  const after = snapshotCandidate(candidate);
  const observation = parseClaudeStream(result.stdout, { candidateRoot: candidate.dir, packageSkills, outputTooLarge: result.outputTooLarge });
  const stable = before.hash === after.hash && before.hash === candidate.sourceHash;
  const isolation = observation.noncandidatePluginCount === 0 && observation.mcpServerCount === 0 && observation.unexpectedTools === 0;
  if (!stable) observation.errors.push("candidate bytes differ from stable rendered source");
  if (!isolation) observation.errors.push("native init reports tools, plugins or MCP outside routing-only controls");
  observation.valid &&= stable && isolation;
  const text = observation.resultText;
  const routed = parseSkillTrailer(text);
  const normalized = {
    candidatePath: redact(candidate.dir), candidatePathMatches: observation.candidateLoaded, candidateHashBefore: before.hash, candidateHashAfter: after.hash,
    stable, isolation, models: observation.models, effort: observation.effort ?? "NOT_RUN_UNAVAILABLE: omitted by native stream", cliVersion: observation.cliVersion,
    calls: observation.calls, errors: observation.errors, pluginErrorCount: observation.pluginErrorCount, noncandidatePluginCount: observation.noncandidatePluginCount,
    mcpServerCount: observation.mcpServerCount, unexpectedToolCount: observation.unexpectedTools,
    candidateSkillCount: observation.candidateSkillCount, foreignSkillCount: observation.foreignSkillCount,
    trailer: routed === "none" || packageSkills.has(routed) ? routed : routed === null ? null : "UNKNOWN_PACKAGE_SKILL",
    nativeResultErrors: observation.resultErrors,
    exitCode: result.exitCode, timedOut: result.timedOut === true, outputTooLarge: result.outputTooLarge === true, durationMs: Date.now() - started,
    ...(result.launchError ? { launchError: result.launchError } : {})
  };
  return { ...result, stdout: undefined, text, observation, normalized, isError: observation.isError, durationMs: normalized.durationMs };
}

/** A session that did not produce a normal answer gives no routing verdict; return why, or null. */
function sessionFailure(result, timeoutMs) {
  if (result.launchError) return result.launchError.reason;
  if (result.unavailable) return "claude did not start";
  if (result.timedOut) return `claude did not finish within ${String(timeoutMs)} ms`;
  if (result.outputTooLarge) return "claude exceeded the stream capture limit";
  if (result.exitCode === 0 && !result.isError) return null;
  if (/not logged in|authentication|unauthorized|login required/iu.test(`${result.stderr}\n${result.text}`)) return "claude session is not authenticated";
  if (result.exitCode !== 0) return `claude exited ${String(result.exitCode)}: ${oneLine(result.stderr) || oneLine(result.text)}`;
  return `claude returned an error result: ${oneLine(result.text)}`;
}

export async function runSuite({ root = ROOT, run = runProcess, suitePath = join(root, "tests", "model", "suite.json"), outputDir = join(root, OUTPUT_DIR), preconditions = checkPreconditions,
  mode = process.env.AAA_MODEL_MODE || "installed", profile = process.env.AAA_MODEL_PROFILE || "portable", skills = null, caseIds = null, qualificationOnly = false, diagnosticOnly = false } = {}) {
  const suite = readJson(suitePath);
  const routers = new Set(suite.routers ?? []);
  const packageSkills = new Set(readdirSync(join(root, "core", "skills"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name));
  const caseTimeoutMs = resolveCaseTimeoutMs();
  const cases = [];
  for (const skill of skills ?? suite.skills) {
    if (!suite.skills.includes(skill)) throw new TypeError(`skill is not in the manual suite: ${skill}`);
    const routing = readJson(join(root, "core", "evals", "skill-routing", `${skill}.json`));
    for (const caseSpec of routing.cases) if (caseIds === null || caseIds.includes(caseSpec.id)) cases.push({ skill, caseSpec });
  }
  if (caseIds && caseIds.some((id) => !cases.some(({ caseSpec }) => caseSpec.id === id))) throw new TypeError("requested case ID is not in the selected manual suite");
  if (!qualificationOnly && !diagnosticOnly && cases.length === 0) throw new TypeError("normal model suite selection must include at least one natural case");
  const pre = await preconditions({ root, run, mode });
  const { assertContainedOutputDir, runEvaluationBatch } = await import(pathToFileURL(join(root, "core", "evals", "runner.mjs")).href);
  // Each run gets its own folder, so a later run never replaces an earlier record.
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const runDir = mkdtempSync(join(await assertContainedOutputDir(outputDir, root), `${TRIGGER_SUITE_PREFIX}${stamp}-`));
  const repo = pre.ok ? await makeDisposableRepo(run) : { dir: null, error: null };
  let candidate = null, settings = null;
  let qualification = { status: "NOT_RUN_UNAVAILABLE", reason: pre.reasons.join("; ") || repo.error || "qualification did not run" };
  const evidence = { mode, profile, probeKind: diagnosticOnly ? "metadata-diagnostic" : "forced-qualification", packageVersion: pre.packageVersion, qualification: null, cases: [], limits: "Skill-only route/load decisions; no file-read, full workflow, installed lifecycle or runtime effort claim" };
  const completedResults = [];
  try {
    if (pre.ok && !repo.error) {
      try {
        candidate = await prepareCandidate(root, mode, pre, profile);
        settings = await isolatedSettings(candidate, run, repo.dir);
        evidence.sourceHash = candidate.sourceHash;
        evidence.globalInstructionsHash = candidate.globalHash;
        evidence.files = candidate.files;
        if (diagnosticOnly) evidence.inventoryBefore = await effectiveInventory(candidate, settings, run, repo.dir);
        const prompt = diagnosticOnly ? "Metadata diagnostic only. Do not call any tools. Reply metadata diagnostic complete and use none in the final trailer. This is not qualification or a natural routing case." : "Qualification probe only. Use the Skill tool to load all-about-agents:using-all-about-agents once. Do no other work. This forced call is infrastructure qualification, not a natural routing case.";
        const probe = await runClaude(buildCasePrompt(prompt), repo.dir, run, caseTimeoutMs, candidate, settings, packageSkills);
        if (diagnosticOnly) evidence.inventoryAfter = await effectiveInventory(candidate, settings, run, repo.dir);
        const failure = sessionFailure(probe, caseTimeoutMs);
        const loaded = probe.observation.valid && probe.observation.loadedSkills.includes("using-all-about-agents");
        qualification = { status: !diagnosticOnly && !failure && loaded ? "PASS" : "NOT_RUN_UNAVAILABLE", reason: diagnosticOnly ? "metadata diagnostic only; not qualification or natural routing evidence" : failure || (loaded ? "forced candidate Skill load qualified; not a natural-trigger result" : probe.observation.errors.join("; ") || "forced candidate Skill load has no correlated successful completion"), evidence: probe.normalized };
      } catch (error) {
        if (error?.code !== "model-suite-prerequisite" && !LAUNCH_ERROR_CODES.has(error?.code)) throw error;
        qualification = { status: "NOT_RUN_UNAVAILABLE", reason: redact(oneLine(error?.message ?? error)) };
      }
    }
    evidence.qualification = qualification;
    process.stdout.write(`qualification: ${qualification.status} ${redact(qualification.reason)}\n`);
    if (qualificationOnly || diagnosticOnly) {
      writeFileSync(join(runDir, "native-evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
      return { summary: { total: 0, pass: 0, fail: 0, notRun: 0 }, qualification, preconditions: pre, runDir };
    }
    let unavailableReason = qualification.status === "PASS" ? null : qualification.reason;
    const batch = await runEvaluationBatch({
      cases,
      variant: "candidate",
      samples: cases.length,
      outputDir: runDir,
      repositoryRoot: root,
      executeSample: async ({ skill, caseSpec }, index) => {
        let status, reason, text = "", exitCode = null, durationMs = 0;
        if (unavailableReason) { status = "NOT_RUN_UNAVAILABLE"; reason = unavailableReason; }
        else {
          const result = await runClaude(buildCasePrompt(caseSpec.prompt), repo.dir, run, caseTimeoutMs, candidate, settings, packageSkills);
          ({ text, exitCode, durationMs } = result);
          evidence.cases.push({ caseId: caseSpec.id, skill, ...result.normalized });
          const failure = sessionFailure(result, caseTimeoutMs);
          if (failure !== null) { status = "NOT_RUN_UNAVAILABLE"; reason = failure; unavailableReason = failure; }
          else if (!result.observation.candidateLoaded || !result.normalized.stable || !result.normalized.isolation) { status = "NOT_RUN_UNAVAILABLE"; reason = result.observation.errors.join("; "); unavailableReason = reason; }
          else ({ status, reason } = evaluateCase({ skill, caseSpec, resultText: text, observation: result.observation, forbiddenPressurePhrases: suite.forbiddenPressurePhrases, isRouter: routers.has(skill), packageSkills }));
        }
        process.stdout.write(`${status.padEnd(20)} ${skill.padEnd(34)} ${caseSpec.id.padEnd(40)} ${redact(reason)}\n`);
        const envelope = {
          schemaVersion: 1,
          sampleId: `sample-${String(index + 1).padStart(2, "0")}`,
          caseId: caseSpec.id,
          variant: "candidate",
          output: text ? `skill: ${packageSkills.has(parseSkillTrailer(text)) || parseSkillTrailer(text) === "none" ? parseSkillTrailer(text) : "UNKNOWN_OR_MISSING"}` : "",
          scores: { pass: status === "PASS" ? 1 : 0 },
          metadata: { status, skill, reason: redact(reason).slice(0, EXCERPT_LENGTH), exitCode: String(exitCode), durationMs: String(durationMs), packageVersion: pre.packageVersion, mode, evidenceKind: "native-main-conversation-route-load" }
        };
        completedResults.push(envelope);
        return envelope;
      }
    });
    const statuses = batch.results.map((entry) => entry.metadata.status);
    const summary = { total: statuses.length, pass: statuses.filter((s) => s === "PASS").length, fail: statuses.filter((s) => s === "FAIL").length, notRun: statuses.filter((s) => s === "NOT_RUN_UNAVAILABLE").length };
    process.stdout.write(`\nsummary: ${JSON.stringify(summary)}\n`);
    writeFileSync(join(runDir, "native-evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
    return { batch, summary, qualification, preconditions: pre, runDir };
  } catch (error) {
    evidence.qualification = qualification;
    evidence.abort = { name: redact(oneLine(error?.name ?? "UnknownError")), reason: redact(oneLine(error?.message ?? error)) };
    evidence.partialResults = completedResults;
    writeFileSync(join(runDir, "native-evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
    throw error;
  } finally {
    if (candidate?.temporary) rmSync(candidate.dir, { recursive: true, force: true });
    if (repo.dir) rmSync(repo.dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const { summary } = await runSuite();
  process.exitCode = summary.fail > 0 ? 1 : 0;
}
