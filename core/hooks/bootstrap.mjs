#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const EMPTY_OUTPUTS = Object.freeze({
  claude: Object.freeze({}),
  codex: Object.freeze({}),
  "antigravity-2": Object.freeze({ injectSteps: [] }),
  agy: Object.freeze({})
});

const SESSION_START_SURFACES = new Set(["claude", "codex"]);
const INVOCATION_SURFACES = new Set(["antigravity-2"]);

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

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function parseInput(rawInput) {
  try {
    const parsed = JSON.parse(rawInput);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function argumentValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 && typeof argv[index + 1] === "string" ? argv[index + 1] : "";
}

/** Execute the package-local handler using only explicit argv and stdin inputs. */
export async function runBootstrap(argv = process.argv.slice(2), rawInput = null) {
  const surface = argumentValue(argv, "--surface");
  const skillPath = argumentValue(argv, "--skill-path");
  let canonicalContent = null;
  if (skillPath) {
    try {
      canonicalContent = await readFile(skillPath, "utf8");
    } catch {
      canonicalContent = null;
    }
  }
  const request = parseInput(rawInput === null ? await readStdin() : rawInput);
  return serializeBootstrapOutput(surface, request, canonicalContent);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.stdout.write(`${await runBootstrap()}\n`);
  } catch {
    process.stdout.write("{}\n");
  }
}
