#!/usr/bin/env node
import { appendFile, mkdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { collectBoundedStdin, safeStatuslineLogKey, sanitizeTerminalText } from "./statusline.mjs";

const MAX_LOG_BYTES = 8_192;
const MAX_VALUE_CODE_POINTS = 256;
const queues = new Map();

function boundedLogValue(value) {
  const sanitized = sanitizeTerminalText(value).replace(/[\\/]/gu, "-");
  return [...sanitized].slice(0, MAX_VALUE_CODE_POINTS).join("");
}

async function appendBounded(filePath, value) {
  const line = `${value}\n`;
  const bytes = Buffer.byteLength(line, "utf8");
  if (bytes > MAX_LOG_BYTES) return;
  let current = 0;
  try {
    current = (await stat(filePath)).size;
  } catch (error) {
    if (error?.code !== "ENOENT") return;
  }
  if (current + bytes > MAX_LOG_BYTES) await writeFile(filePath, "", "utf8");
  await appendFile(filePath, line, "utf8");
}

function enqueue(filePath, operation) {
  const previous = queues.get(filePath) || Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  queues.set(filePath, current);
  return current.finally(() => {
    if (queues.get(filePath) === current) queues.delete(filePath);
  });
}

/** Track only known, sanitized labels; every filesystem failure is optional. */
export async function trackToolEvent(payload, options = {}) {
  try {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
    const sessionId = typeof payload.session_id === "string" && payload.session_id ? payload.session_id : "default";
    const toolInput = payload.tool_input;
    if (!toolInput || typeof toolInput !== "object" || Array.isArray(toolInput)) return;
    const kind = payload.tool_name === "Agent" ? "agents" : payload.tool_name === "Skill" ? "skills" : "";
    if (!kind) return;
    const candidate = kind === "agents" ? toolInput.subagent_type : toolInput.skill;
    const value = boundedLogValue(typeof candidate === "string" ? candidate : "unknown");
    if (!value) return;
    const logRoot = typeof options.logDir === "string" && options.logDir.trim()
      ? resolve(options.logDir)
      : join(tmpdir(), "claude-statusline");
    await mkdir(logRoot, { recursive: true });
    const filePath = join(logRoot, `${safeStatuslineLogKey(sessionId)}-${kind}.log`);
    await enqueue(filePath, () => appendBounded(filePath, value));
  } catch {
    // Tracking is optional and must never interrupt the tool lifecycle.
  }
}

async function main() {
  try {
    const input = await collectBoundedStdin();
    if (input === null) return;
    await trackToolEvent(JSON.parse(input));
  } catch {
    // Invalid hook input is intentionally fail-open.
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => undefined);
}

export const trackTool = trackToolEvent;
