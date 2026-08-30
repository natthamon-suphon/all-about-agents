#!/usr/bin/env node
import { createHash } from "node:crypto";
import { closeSync, openSync, readSync } from "node:fs";
import { open } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_CONFIG_BYTES = 8_192;
const MAX_LOG_BYTES = 8_192;
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

/** Read only the generated JSON config; missing, malformed, and oversized files are empty. */
export function readStatuslineConfig(root) {
  if (typeof root !== "string" || root.trim().length === 0) return { displayName: "" };
  const text = readBoundedTextSync(join(resolve(root), "all-about-agents", "statusline.json"), MAX_CONFIG_BYTES);
  if (text === null) return { displayName: "" };
  try {
    const parsed = JSON.parse(text);
    if (!isPlainObject(parsed) || typeof parsed.displayName !== "string") return { displayName: "" };
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

function formatDuration(value) {
  const seconds = Math.floor(finiteNonNegative(value) / 1_000);
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function progressBar(percent, width = 15) {
  const filled = Math.round((percent / 100) * width);
  return `${"━".repeat(filled)}${"─".repeat(width - filled)}`;
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
  return "📁 unknown 🔀 N/A 🧠 unknown\n────────────────  \n⏳ 0% · ⇣ 0 ⇡ 0 · ⏱ 0m 0s\n.";
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
    const rate5h = clampPercent(payload.rate_limits?.five_hour?.used_percentage);
    const rate7d = clampPercent(payload.rate_limits?.seven_day?.used_percentage);
    const inputTokens = formatTokens(payload.context_window?.total_input_tokens);
    const outputTokens = formatTokens(payload.context_window?.total_output_tokens);
    const duration = formatDuration(payload.cost?.total_duration_ms);
    const sessionId = typeof payload.session_id === "string" && payload.session_id ? payload.session_id : "default";
    const [agents, skills] = await Promise.all([
      readLogValues(logRoot, sessionId, "agents"),
      readLogValues(logRoot, sessionId, "skills")
    ]);
    const line1 = `📁 ${repo} 🔀 ${branch} 🧠 ${model}`;
    const metrics = [`⏳ ${progressBar(rate5h)} ${rate5h}%`, `🔤 ${inputTokens} ⇣ ${outputTokens} ⇡`, `⏱ ${duration}`];
    if (agents) metrics.push(`🤖 ${agents}`);
    if (skills) metrics.push(`⚡ ${skills}`);
    const line3 = metrics.join(" · ");
    const barWidth = Math.max(1, Math.max([...line1].length, [...line3].length));
    const line2 = `${progressBar(rate7d, barWidth)}${displayName ? `   ${displayName}` : ""}`;
    return `${line1}\n${line2}\n${line3}\n.`;
  } catch {
    return emptyRender();
  }
}

async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const input = Buffer.concat(chunks).toString("utf8");
  let payload;
  try {
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
