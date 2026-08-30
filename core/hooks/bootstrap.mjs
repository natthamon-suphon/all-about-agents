#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const DEFAULT_MAX_STDIN_BYTES = 64 * 1024;

/** Collect hook input without allowing an unbounded stream to accumulate. */
export async function readBoundedStdin(stream = process.stdin, maxBytes = DEFAULT_MAX_STDIN_BYTES) {
  if (!Number.isInteger(maxBytes) || maxBytes < 1) throw new TypeError("maxBytes must be a positive integer");
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of stream) {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk);
    totalBytes += bytes.byteLength;
    if (totalBytes > maxBytes) return null;
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export const MAX_STDIN_BYTES = DEFAULT_MAX_STDIN_BYTES;

const EMPTY_OUTPUTS = Object.freeze({
  claude: Object.freeze({}),
  codex: Object.freeze({}),
  "antigravity-2": Object.freeze({ injectSteps: [] }),
  agy: Object.freeze({})
});

const SESSION_START_SURFACES = new Set(["claude", "codex"]);
const INVOCATION_SURFACES = new Set(["antigravity-2"]);
const BOOTSTRAP_CONTRACT_KEYS = new Set([
  "schemaVersion",
  "id",
  "description",
  "contentRef",
  "failureMode",
  "failureDiagnostic"
]);
const EXPECTED_CONTENT_REF = "core/skills/using-all-about-agents/SKILL.md";

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function emptyOutput(surface) {
  const output = EMPTY_OUTPUTS[surface] || EMPTY_OUTPUTS.claude;
  return JSON.parse(JSON.stringify(output));
}

function hasSessionStartEvent(request) {
  return request.hook_event_name === "SessionStart" && typeof request.source === "string";
}

function hasFirstInvocation(request) {
  return Number.isInteger(request.invocationNum)
    && Number.isInteger(request.initialNumSteps)
    && request.invocationNum === 0
    && request.initialNumSteps === 0;
}

/** Normalize only documented native event fields; malformed input stays fail-open. */
export function normalizeRequest(surface, request) {
  if (typeof surface !== "string" || !isPlainObject(request)) return null;
  if (SESSION_START_SURFACES.has(surface)) {
    if (!hasSessionStartEvent(request)) return null;
    return { surface, event: "SessionStart", source: request.source };
  }
  if (INVOCATION_SURFACES.has(surface)) {
    if (!Number.isInteger(request.invocationNum) || !Number.isInteger(request.initialNumSteps)) return null;
    return {
      surface,
      event: "PreInvocation",
      invocationNum: request.invocationNum,
      initialNumSteps: request.initialNumSteps
    };
  }
  return null;
}

function contextOutput(event, canonicalContent) {
  return {
    hookSpecificOutput: {
      hookEventName: event,
      additionalContext: canonicalContent
    }
  };
}

/** Build the native output without reading ambient session state or writing files. */
export function buildBootstrapOutput(surface, request, canonicalContent) {
  const normalized = normalizeRequest(surface, request);
  if (!normalized || typeof canonicalContent !== "string") return emptyOutput(surface);
  if (SESSION_START_SURFACES.has(surface)) {
    return normalized.source === "startup" ? contextOutput(normalized.event, canonicalContent) : emptyOutput(surface);
  }
  if (surface === "antigravity-2") {
    return hasFirstInvocation(normalized)
      ? { injectSteps: [{ ephemeralMessage: canonicalContent }] }
      : emptyOutput(surface);
  }
  return emptyOutput(surface);
}

/** Serialize a valid native event response with the platform JSON serializer. */
export function serializeBootstrapOutput(surface, request, canonicalContent) {
  return JSON.stringify(buildBootstrapOutput(surface, request, canonicalContent));
}

function parseInput(rawInput) {
  try {
    const parsed = JSON.parse(rawInput);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseBootstrapContract(rawContract) {
  try {
    const parsed = JSON.parse(rawContract);
    if (!isPlainObject(parsed)) return null;
    if ([...Object.keys(parsed)].some((key) => !BOOTSTRAP_CONTRACT_KEYS.has(key))) return null;
    if (parsed.schemaVersion !== 1 || parsed.id !== "bootstrap") return null;
    if (parsed.contentRef !== EXPECTED_CONTENT_REF || parsed.failureMode !== "fail-open") return null;
    if (typeof parsed.description !== "string" || typeof parsed.failureDiagnostic !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

async function readBootstrapContract(configPath) {
  if (!configPath) return null;
  try {
    return parseBootstrapContract(await readFile(configPath, "utf8"));
  } catch {
    return null;
  }
}

function argumentValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 && typeof argv[index + 1] === "string" ? argv[index + 1] : "";
}

function boundedRawInput(rawInput) {
  return typeof rawInput === "string" && Buffer.byteLength(rawInput, "utf8") <= MAX_STDIN_BYTES ? rawInput : null;
}

/** Execute the package-local handler using only explicit argv and stdin inputs. */
export async function runBootstrap(argv = process.argv.slice(2), rawInput = null) {
  const surface = argumentValue(argv, "--surface");
  const skillPath = argumentValue(argv, "--skill-path");
  const configPath = argumentValue(argv, "--config-path");
  const contract = await readBootstrapContract(configPath);
  let canonicalContent = null;
  if (contract && skillPath) {
    try {
      canonicalContent = await readFile(skillPath, "utf8");
    } catch {
      canonicalContent = null;
    }
  }
  const request = parseInput(rawInput === null ? await readBoundedStdin() : boundedRawInput(rawInput));
  return serializeBootstrapOutput(surface, request, canonicalContent);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.stdout.write(`${await runBootstrap()}\n`);
  } catch {
    process.stdout.write("{}\n");
  }
}
