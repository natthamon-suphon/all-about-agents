#!/usr/bin/env node
import { closeSync, openSync, readSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_CONFIG_BYTES = 8_192;
const MAX_STDIN_BYTES = 64 * 1024;
const MAX_FIELD_CODE_POINTS = 256;
const MAX_DISPLAY_CODE_POINTS = 64;
const ANSI_ESCAPE = /\u001b(?:\][\s\S]*?(?:\u0007|\u001b\\)|\[[0-?]*[ -/]*[@-~]|[()][0-2A-Z]|[@-_])/gu;
const TERMINAL_CONTROL = /[\u0000-\u001f\u007f-\u009f]/gu;

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Remove terminal controls and ANSI escapes from untrusted display values. */
export function sanitizeTerminalText(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(ANSI_ESCAPE, "")
    .replace(TERMINAL_CONTROL, " ")
    .replace(/[\u2028\u2029]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function boundedField(value, fallback) {
  const sanitized = sanitizeTerminalText(value);
  if (!sanitized) return fallback;
  return [...sanitized].slice(0, MAX_FIELD_CODE_POINTS).join("");
}

function boundedDisplayName(value) {
  const name = sanitizeTerminalText(value);
  return [...name].length <= MAX_DISPLAY_CODE_POINTS ? name : "";
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

/** Read the install-time display name without accepting arbitrary JSON fields. */
export function readAgyStatuslineConfig(configPath) {
  if (typeof configPath !== "string" || configPath.trim().length === 0) return { displayName: "" };
  const text = readBoundedTextSync(configPath, MAX_CONFIG_BYTES);
  if (text === null) return { displayName: "" };
  try {
    const parsed = JSON.parse(text);
    if (!isPlainObject(parsed) || parsed.schemaVersion !== 1 || typeof parsed.displayName !== "string") return { displayName: "" };
    const displayName = boundedDisplayName(parsed.displayName);
    return { displayName };
  } catch {
    return { displayName: "" };
  }
}

/** Collect native stdin with a strict bound and no input echo. */
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

function clampPercent(value) {
  let number;
  try { number = Number(value); } catch { return 0; }
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function projectName(value) {
  const sanitized = sanitizeTerminalText(value);
  if (!sanitized) return "unknown";
  const parts = sanitized.split(/[\\/]/u).filter(Boolean);
  return boundedField(parts.at(-1), "unknown");
}

function taskCount(value) {
  let number;
  try { number = Number(value); } catch { return 0; }
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.min(9_999, Math.floor(number));
}

function emptyRender() {
  return "📁 unknown · 🧠 unknown · ⏳ 0% · idle · 🌿 N/A · 0 tasks · unknown";
}

/** Render one bounded line using only the documented low-risk agy fields. */
export function renderAgyStatusline(payload = {}, { configPath } = {}) {
  try {
    const data = isPlainObject(payload) ? payload : {};
    const resolvedConfigPath = typeof configPath === "string" && configPath.trim().length > 0
      ? configPath
      : join(dirname(fileURLToPath(import.meta.url)), "statusline.json");
    const { displayName } = readAgyStatuslineConfig(resolvedConfigPath);
    const project = projectName(data.workspace?.project_dir);
    const model = boundedField(data.model?.display_name, "unknown");
    const context = clampPercent(data.context_window?.used_percentage);
    const state = boundedField(data.agent_state, "idle");
    const branch = boundedField(data.vcs?.branch, "N/A");
    const dirty = data.vcs?.dirty === true ? "*" : "";
    const tasks = taskCount(data.task_count);
    const taskLabel = tasks === 1 ? "task" : "tasks";
    const mode = boundedField(data.execution_mode, "unknown");
    const prefix = displayName ? `${displayName} · ` : "";
    return `${prefix}📁 ${project} · 🧠 ${model} · ⏳ ${context}% · ${state} · 🌿 ${branch}${dirty} · ${tasks} ${taskLabel} · ${mode}`;
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
  process.stdout.write(await renderAgyStatusline(payload));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    process.stderr.write("invalid statusline JSON\n");
    process.exitCode = 1;
  });
}

export const render = renderAgyStatusline;
export const sanitize = sanitizeTerminalText;
export const configPath = join(dirname(fileURLToPath(import.meta.url)), "statusline.json");
