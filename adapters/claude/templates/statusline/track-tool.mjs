#!/usr/bin/env node
import { join } from "node:path";

import { collectBoundedStdin, isMainModule, resolveStatuslineLogRoot, safeStatuslineLogKey, sanitizeTerminalText, withStatuslineLog } from "./statusline.mjs";

const MAX_LOG_BYTES = 8_192;
const MAX_VALUE_CODE_POINTS = 256;
const queues = new Map();

function boundedLogValue(value) {
  const sanitized = sanitizeTerminalText(value).replace(/[\\/]/gu, "-");
  return [...sanitized].slice(0, MAX_VALUE_CODE_POINTS).join("");
}

async function appendBounded(logRoot, name, value) {
  const line = `${value}\n`;
  const bytes = Buffer.byteLength(line, "utf8");
  if (bytes > MAX_LOG_BYTES) return;
  await withStatuslineLog(logRoot, name, "append", async (handle, info) => {
    if (info.size + BigInt(bytes) > BigInt(MAX_LOG_BYTES)) {
      // Windows append-only handles cannot truncate; verify the second handle before rotation.
      await withStatuslineLog(logRoot, name, "rotate", async (rotationHandle, rotationInfo) => {
        if (info.dev !== rotationInfo.dev || info.ino !== rotationInfo.ino) throw new Error("statusline log changed before rotation");
        await rotationHandle.truncate(0);
      });
    }
    await handle.writeFile(line, "utf8");
  });
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
    const logRoot = await resolveStatuslineLogRoot(options.logDir);
    const name = `${safeStatuslineLogKey(sessionId)}-${kind}.log`;
    await enqueue(join(logRoot, name), () => appendBounded(logRoot, name, value));
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

if (isMainModule(import.meta.url)) {
  main().catch(() => undefined);
}

export const trackTool = trackToolEvent;
