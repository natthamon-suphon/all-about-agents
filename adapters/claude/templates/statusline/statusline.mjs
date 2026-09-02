#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, openSync, readSync } from "node:fs";
import { open } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_CONFIG_BYTES = 8_192;
const MAX_LOG_BYTES = 8_192;
const MAX_STDIN_BYTES = 64 * 1024;
const MAX_DISPLAY_CODE_POINTS = 64;
const MAX_FIELD_CODE_POINTS = 256;
const ANSI_ESCAPE = /\u001b(?:\][\s\S]*?(?:\u0007|\u001b\\)|\[[0-?]*[ -/]*[@-~]|[()][0-2A-Z]|[@-_])/gu;
const TERMINAL_CONTROL = /[\u0000-\u001f\u007f-\u009f]/gu;

async function loadCanonicalSafeLogKey() {
  for (const modulePath of ["../../../../installers/lib/audit-log.mjs", "../hooks/audit-log.mjs"]) {
    try {
      const module = await import(modulePath);
      if (typeof module.safeLogKey === "function") return module.safeLogKey;
    } catch { /* source and generated package roots have different layouts */ }
  }
  return null;
}

const canonicalSafeLogKey = await loadCanonicalSafeLogKey();

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

async function readBoundedText(filePath, maxBytes) {
  let handle;
  try {
    handle = await open(filePath, "r");
    const buffer = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > maxBytes) return null;
    return buffer.subarray(0, bytesRead).toString("utf8");
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
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

/** Extend the canonical audit key with an input hash so normalization collisions remain distinct. */
export function safeStatuslineLogKey(id) {
  if (typeof id !== "string") throw new TypeError("id must be a string");
  if (typeof canonicalSafeLogKey !== "function") return "unknown-0000000000000000";
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

/** Best-effort git dirty check: absent git, non-repo paths, and slow calls all fail open to null (indicator omitted). */
function gitDirty(cwd) {
  if (typeof cwd !== "string" || !cwd.trim()) return null;
  try {
    const output = execFileSync("git", ["-C", cwd, "status", "--porcelain"], {
      encoding: "utf8",
      timeout: 200,
      stdio: ["ignore", "pipe", "ignore"]
    });
    return output.trim().length > 0;
  } catch {
    return null;
  }
}

async function readLogValues(logRoot, sessionId, kind) {
  const key = safeStatuslineLogKey(sessionId);
  const text = await readBoundedText(join(logRoot, `${key}-${kind}.log`), MAX_LOG_BYTES);
  if (!text) return "";
  const values = [];
  for (const raw of text.split(/\r?\n/gu)) {
    const value = boundedField(raw, "");
    if (value && !values.includes(value)) values.push(value);
  }
  return values.join(", ");
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
    const logRoot = typeof options.logRoot === "string" && options.logRoot.trim()
      ? options.logRoot
      : join(tmpdir(), "claude-statusline");
    const { displayName } = readStatuslineConfig(configRoot);
    const repo = repoName(payload.workspace?.project_dir);
    const branch = boundedField(payload.worktree?.branch, "N/A");
    const model = boundedField(payload.model?.display_name, "unknown");
    const effort = boundedField(payload.effort?.level, "");
    const dirty = gitDirty(typeof payload.workspace?.current_dir === "string" ? payload.workspace.current_dir : "");
    const contextPct = clampPercent(payload.context_window?.used_percentage);
    const inputTokens = formatTokens(payload.context_window?.total_input_tokens);
    const totalTokens = formatTokens(payload.context_window?.context_window_size);
    const rate5h = clampPercent(payload.rate_limits?.five_hour?.used_percentage);
    const rate7d = clampPercent(payload.rate_limits?.seven_day?.used_percentage);
    const reset5h = formatResetIn(payload.rate_limits?.five_hour?.resets_at);
    const reset7d = formatResetIn(payload.rate_limits?.seven_day?.resets_at);
    const sessionId = typeof payload.session_id === "string" && payload.session_id ? payload.session_id : "default";
    const [agents, skills] = await Promise.all([
      readLogValues(logRoot, sessionId, "agents"),
      readLogValues(logRoot, sessionId, "skills")
    ]);

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
    const extras = [agents ? `🤖 ${agents}` : "", skills ? `⚡ ${skills}` : "", displayName || ""].filter(Boolean);
    const line4 = extras.length ? paint(STYLE.extras, extras.join(" · ")) : ".";
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    process.stdout.write(emptyRender());
  });
}

export const render = renderStatusline;
