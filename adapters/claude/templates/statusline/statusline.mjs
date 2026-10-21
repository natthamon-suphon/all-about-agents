#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, constants, openSync, readSync, realpathSync } from "node:fs";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_CONFIG_BYTES = 8_192;
const MAX_STDIN_BYTES = 64 * 1024;
const MAX_DISPLAY_CODE_POINTS = 64;
const MAX_FIELD_CODE_POINTS = 256;
const MAX_KEY_CODE_POINTS = 64;
const ANSI_ESCAPE = /\u001b(?:\][\s\S]*?(?:\u0007|\u001b\\)|\[[0-?]*[ -/]*[@-~]|[()][0-2A-Z]|[@-_])/gu;
const TERMINAL_CONTROL = /[\u0000-\u001f\u007f-\u009f]/gu;

/** Remove terminal control data without changing the surrounding line shape. */
export function sanitizeTerminalText(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(ANSI_ESCAPE, "")
    .replace(TERMINAL_CONTROL, " ")
    .replace(/[\u2028\u2029]/gu, " ")
    .trim();
}

/** Convert any external percentage to a finite integer in the display range. */
export function clampPercent(value) {
  let number;
  try { number = Number(value); } catch { return 0; }
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino !== 0n && left.ino === right.ino;
}

function matchesHandle(pathInfo, handleInfo) {
  // Node 22 on Windows reports zero for path-stat dev; handles retain the volume ID.
  const deviceMatches = pathInfo.dev === handleInfo.dev || (process.platform === "win32" && pathInfo.dev === 0n);
  return deviceMatches && pathInfo.ino !== 0n && pathInfo.ino === handleInfo.ino && pathInfo.birthtimeNs === handleInfo.birthtimeNs;
}

async function directoryChain(root, allowMissing = false) {
  const entries = new Map();
  for (let current = root; ; current = dirname(current)) {
    try {
      const info = await lstat(current, { bigint: true });
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("statusline root must not cross a link or non-directory");
      const canonical = await realpath(current);
      const actual = await lstat(canonical, { bigint: true });
      if (!sameIdentity(info, actual)) throw new Error("statusline root crosses a redirect");
      entries.set(current, info);
    } catch (error) {
      if (!allowMissing || error?.code !== "ENOENT") throw error;
    }
    if (dirname(current) === current) return entries;
  }
}

function assertDirectoryIdentity(expected, actual) {
  for (const [path, info] of expected) {
    if (!actual.has(path) || !sameIdentity(info, actual.get(path))) throw new Error("statusline root changed");
  }
}

function assertRegularLog(info) {
  if (!info.isFile() || info.nlink !== 1n) throw new Error("statusline log must be a single regular file");
}

/** Resolve only the known system-temp prefix; leave log descendants for link checks. */
export async function resolveStatuslineLogRoot(value) {
  const temp = resolve(tmpdir());
  const root = typeof value === "string" && value.trim() ? resolve(value) : join(temp, "claude-statusline");
  const suffix = relative(temp, root);
  const withinTemp = suffix === "" || (suffix !== ".." && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix));
  return withinTemp ? resolve(await realpath(temp), suffix) : root;
}

/** Keep log reads and writes on a checked handle within a verified directory chain. */
export async function withStatuslineLog(logRoot, name, mode, operation) {
  if (typeof logRoot !== "string" || !logRoot.trim() || /[\u0000-\u001f\u007f]/u.test(logRoot) || !/^[A-Za-z0-9._-]+-(?:agents|skills)\.log$/u.test(name) || !["read", "append", "rotate"].includes(mode)) {
    throw new TypeError("invalid statusline log path");
  }
  const root = await resolveStatuslineLogRoot(logRoot);
  const create = mode === "append";
  const initialDirectories = await directoryChain(root, create);
  if (create) await mkdir(root, { recursive: true, mode: 0o700 });
  const directories = await directoryChain(root);
  assertDirectoryIdentity(initialDirectories, directories);
  const noFollow = (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
  let directoryHandle;
  let handle;
  try {
    directoryHandle = await open(root, constants.O_RDONLY | noFollow | (constants.O_DIRECTORY ?? 0));
    const directoryInfo = await directoryHandle.stat({ bigint: true });
    if (!directoryInfo.isDirectory() || !matchesHandle(directories.get(root), directoryInfo)) throw new Error("statusline root changed before open");
    const filePath = join(root, name);
    let before;
    try {
      before = await lstat(filePath, { bigint: true });
      assertRegularLog(before);
    } catch (error) {
      if (!create || error?.code !== "ENOENT") throw error;
    }
    const flags = (mode === "read" ? constants.O_RDONLY : constants.O_WRONLY | (create ? constants.O_APPEND : 0)) | noFollow;
    handle = await open(filePath, flags | (before ? 0 : constants.O_CREAT | constants.O_EXCL), 0o600);
    const opened = await handle.stat({ bigint: true });
    assertRegularLog(opened);
    if (opened.dev !== directoryInfo.dev || (before && !matchesHandle(before, opened))) throw new Error("statusline log changed before open");
    assertDirectoryIdentity(directories, await directoryChain(root));
    const after = await lstat(filePath, { bigint: true });
    assertRegularLog(after);
    if (!matchesHandle(after, opened)) throw new Error("statusline log changed after open");
    return await operation(handle, opened);
  } finally {
    await handle?.close().catch(() => undefined);
    await directoryHandle?.close().catch(() => undefined);
  }
}

function readBoundedTextSync(filePath, maxBytes) {
  let descriptor;
  try {
    descriptor = openSync(filePath, "r");
    const buffer = Buffer.alloc(maxBytes + 1);
    const bytesRead = readSync(descriptor, buffer, 0, buffer.length, 0);
    if (bytesRead > maxBytes) return null;
    return buffer.subarray(0, bytesRead).toString("utf8");
  } catch {
    return null;
  } finally {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch { /* optional config read */ }
    }
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Collect hook input without retaining more than the renderer's input bound. */
export async function collectBoundedStdin(maxBytes = MAX_STDIN_BYTES) {
  const chunks = [];
  let totalBytes = 0;
  try {
    for await (const chunk of process.stdin) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.byteLength;
      if (totalBytes > maxBytes) return null;
      chunks.push(buffer);
    }
    return Buffer.concat(chunks, totalBytes).toString("utf8");
  } catch {
    return null;
  }
}

/** Read only the generated JSON config; missing, malformed, and oversized files are empty. */
export function readStatuslineConfig(root) {
  if (typeof root !== "string" || root.trim().length === 0) return { displayName: "" };
  const text = readBoundedTextSync(join(resolve(root), "all-about-agents", "statusline.json"), MAX_CONFIG_BYTES);
  if (text === null) return { displayName: "" };
  try {
    const parsed = JSON.parse(text);
    if (!isPlainObject(parsed) || parsed.schemaVersion !== 1 || typeof parsed.displayName !== "string") return { displayName: "" };
    const displayName = sanitizeTerminalText(parsed.displayName);
    return [...displayName].length <= MAX_DISPLAY_CODE_POINTS ? { displayName } : { displayName: "" };
  } catch {
    return { displayName: "" };
  }
}

/** Keep shared filename normalization inside the separately deployed statusline modules. */
function canonicalSafeLogKey(id) {
  const normalized = id.normalize("NFKC")
    .replace(/[^A-Za-z0-9._-]/gu, "-")
    .replace(/-{2,}/gu, "-")
    .replace(/^[-.]+|[-.]+$/gu, "");
  const key = [...normalized].slice(0, MAX_KEY_CODE_POINTS).join("");
  return key && key !== "." && key !== ".." ? key : "unknown";
}

/** Add an input hash so normalization collisions remain distinct. */
export function safeStatuslineLogKey(id) {
  if (typeof id !== "string") throw new TypeError("id must be a string");
  const canonical = canonicalSafeLogKey(id);
  const digest = createHash("sha256").update(id, "utf8").digest("hex").slice(0, 16);
  return `${canonical.slice(0, 47)}-${digest}`;
}

function boundedField(value, fallback) {
  const sanitized = sanitizeTerminalText(value);
  return sanitized ? [...sanitized].slice(0, MAX_FIELD_CODE_POINTS).join("") : fallback;
}

function repoName(value) {
  const sanitized = sanitizeTerminalText(value);
  if (!sanitized) return "unknown";
  const segments = sanitized.split(/[\\/]/u).filter(Boolean);
  return boundedField(segments.at(-1), "unknown");
}

function finiteNonNegative(value) {
  let number;
  try { number = Number(value); } catch { return 0; }
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function formatTokens(value) {
  const tokens = finiteNonNegative(value);
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return `${Math.round(tokens)}`;
}

function formatResetIn(resetsAt) {
  const target = Number(resetsAt);
  if (!Number.isFinite(target)) return "";
  const diff = Math.floor(target - Date.now() / 1_000);
  if (diff <= 0) return "";
  const days = Math.floor(diff / 86_400);
  const hours = Math.floor((diff % 86_400) / 3_600);
  const minutes = Math.floor((diff % 3_600) / 60);
  if (days > 0) return ` resets in ${days}d ${hours}h`;
  return hours > 0 ? ` resets in ${hours}h ${minutes}m` : ` resets in ${minutes}m`;
}

/**
 * The renderer's own colors are the only escape sequences it emits: fixed SGR
 * codes written as source escapes, so no raw control byte enters this file and
 * every external field still passes through sanitizeTerminalText first.
 */
const sgr = (code) => `${String.fromCharCode(27)}[${code}m`;

const STYLE = Object.freeze({
  reset: sgr(0),
  model: sgr("1;38;5;213"),
  effort: sgr("38;5;183"),
  directory: sgr("1;38;5;39"),
  branch: sgr("38;5;114"),
  clean: sgr("1;38;5;82"),
  dirty: sgr("1;38;5;203"),
  window: sgr("38;5;208"),
  weekly: sgr("38;5;147"),
  muted: sgr("2;38;5;244"),
  extras: sgr("38;5;245")
});

const USAGE_TIERS = Object.freeze([
  { limit: 50, style: sgr("1;38;5;114") },
  { limit: 70, style: sgr("1;38;5;226") },
  { limit: 85, style: sgr("1;38;5;214") },
  { limit: Number.POSITIVE_INFINITY, style: sgr("1;38;5;167") }
]);

function usageStyle(percent) {
  return USAGE_TIERS.find((tier) => percent <= tier.limit).style;
}

function paint(style, text) {
  return `${style}${text}${STYLE.reset}`;
}

function progressBar(percent, width = 10) {
  const filled = Math.round((percent / 100) * width);
  return `${paint(usageStyle(percent), "▰".repeat(filled))}${paint(STYLE.muted, "▱".repeat(width - filled))}`;
}

function usageLine(icon, label, labelStyle, percent, resetIn) {
  const meter = `${progressBar(percent)} ${paint(usageStyle(percent), `${percent}%`)}`;
  return `${icon} ${paint(labelStyle, label)} ${meter}${resetIn ? paint(STYLE.muted, resetIn) : ""}`;
}

/** Read branch and dirty state together; unavailable Git state omits the indicator. */
function gitState(cwd) {
  if (typeof cwd !== "string" || !isAbsolute(cwd) || /[\u0000-\u001f\u007f]/u.test(cwd)) return null;
  try {
    const output = execFileSync("git", ["--no-optional-locks", "-C", cwd, "status", "--porcelain=v2", "--branch"], {
      encoding: "utf8",
      timeout: 500,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"]
    });
    const lines = output.split("\n");
    const head = lines.find((line) => line.startsWith("# branch.head "))?.slice(14);
    const oid = lines.find((line) => line.startsWith("# branch.oid "))?.slice(13);
    const branch = head === "(detached)" ? `HEAD${oid ? ` (${oid.slice(0, 7)})` : ""}` : head;
    return { branch, dirty: lines.some((line) => line && !line.startsWith("# ")) };
  } catch {
    return null;
  }
}

function emptyRender() {
  return "🤖 unknown  ·  📂 unknown  ·  🌳 N/A  ·  🚀 0/0 0%\n🔥 5h ▱▱▱▱▱▱▱▱▱▱ 0%\n🌙 7d ▱▱▱▱▱▱▱▱▱▱ 0%\n.";
}

/** Render four deterministic lines. Optional reads and malformed fields fail open. */
export async function renderStatusline(data = {}, options = {}) {
  try {
    const payload = isPlainObject(data) ? data : {};
    const configRoot = typeof options.configRoot === "string" && options.configRoot.trim()
      ? options.configRoot
      : (process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"));
    const { displayName } = readStatuslineConfig(configRoot);
    const repo = repoName(payload.workspace?.project_dir);
    const cwd = [payload.workspace?.current_dir, payload.cwd, payload.workspace?.project_dir]
      .find((value) => typeof value === "string" && isAbsolute(value) && !/[\u0000-\u001f\u007f]/u.test(value));
    const git = gitState(cwd);
    const branch = boundedField(git?.branch || payload.worktree?.branch, "N/A");
    const model = boundedField(payload.model?.display_name, "unknown");
    const effort = boundedField(payload.effort?.level, "");
    const dirty = git?.dirty;
    const contextPct = clampPercent(payload.context_window?.used_percentage);
    const inputTokens = formatTokens(payload.context_window?.total_input_tokens);
    const totalTokens = formatTokens(payload.context_window?.context_window_size);
    const rate5h = clampPercent(payload.rate_limits?.five_hour?.used_percentage);
    const rate7d = clampPercent(payload.rate_limits?.seven_day?.used_percentage);
    const reset5h = formatResetIn(payload.rate_limits?.five_hour?.resets_at);
    const reset7d = formatResetIn(payload.rate_limits?.seven_day?.resets_at);
    const identity = [
      `🤖 ${paint(STYLE.model, model)}`,
      effort ? `🎚 ${paint(STYLE.effort, effort)}` : "",
      `📂 ${paint(STYLE.directory, repo)}`,
      `🌳 ${paint(STYLE.branch, branch)}${dirty === true ? ` ${paint(STYLE.dirty, "✗")}` : dirty === false ? ` ${paint(STYLE.clean, "✓")}` : ""}`,
      `🚀 ${paint(usageStyle(contextPct), `${inputTokens}/${totalTokens} ${contextPct}%`)}`
    ].filter(Boolean);
    const line1 = identity.join(paint(STYLE.muted, "  ·  "));
    const line2 = usageLine("🔥", "5h", STYLE.window, rate5h, reset5h);
    const line3 = usageLine("🌙", "7d", STYLE.weekly, rate7d, reset7d);
    const line4 = displayName ? paint(STYLE.extras, displayName) : ".";
    return `${line1}\n${line2}\n${line3}\n${line4}`;
  } catch {
    return emptyRender();
  }
}

async function main() {
  const input = await collectBoundedStdin();
  let payload;
  try {
    if (input === null) throw new Error("stdin exceeds the configured bound");
    payload = JSON.parse(input);
  } catch {
    process.stderr.write("invalid statusline JSON\n");
    process.exitCode = 1;
    return;
  }
  process.stdout.write(await renderStatusline(payload));
}

/** True when Node started this file, including through a symlinked path. */
export function isMainModule(moduleUrl) {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

if (isMainModule(import.meta.url)) {
  main().catch(() => {
    process.stdout.write(emptyRender());
  });
}

export const render = renderStatusline;
