#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { isAbsolute, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { readBoundedStdin, MAX_STDIN_BYTES } from "./bootstrap.mjs";

const AUTOMATIC_SURFACES = new Set(["claude", "codex"]);
const NATIVE_FIELDS = Object.freeze(["hook_event_name", "tool_name", "tool_input", "tool_use_id"]);
const COMMAND_TOOLS = new Set(["bash", "powershell", "shell", "run_command"]);
const READ_TOOLS = new Set(["read", "read_file", "view_file"]);
const WRITE_TOOLS = new Set(["write", "write_file", "edit", "replace_file_content", "multi_replace_file_content", "delete", "delete_file"]);
const CANONICAL_REASONS = Object.freeze({
  "filesystem-root-erasure": "Denied: broad or unresolved filesystem erasure is an emergency action.",
  "raw-disk-destruction": "Denied: raw-disk or partition destruction is an emergency action.",
  "git-force-push": "Denied: force-push would rewrite shared Git history.",
  "git-history-rewrite": "Denied: destructive Git history rewriting is an emergency action.",
  "git-discard-uncommitted": "Denied: this operation can discard uncommitted user work.",
  "secret-credential-access": "Denied: credential or secret-store access is an emergency action.",
  "secret-output-or-transmission": "Denied: secret output or transmission is an emergency action.",
  "guardrail-bypass": "Denied: disabling or bypassing safety guardrails is an emergency action."
});

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function argumentValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 && typeof argv[index + 1] === "string" ? argv[index + 1] : "";
}

function absolutePath(value) {
  return typeof value === "string" && (isAbsolute(value) || win32.isAbsolute(value));
}

function parseInput(rawInput) {
  try {
    const parsed = JSON.parse(rawInput);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parsePolicy(rawPolicy, canonicalRuleIds) {
  try {
    const policy = JSON.parse(rawPolicy);
    if (!isPlainObject(policy) || policy.schemaVersion !== 1 || policy.id !== "emergency-guard") return null;
    if (!Array.isArray(canonicalRuleIds) || !Array.isArray(policy.orderedRuleIds) || policy.orderedRuleIds.length !== canonicalRuleIds.length || policy.orderedRuleIds.some((id, index) => id !== canonicalRuleIds[index])) return null;
    if (!Array.isArray(policy.rules) || policy.rules.length !== canonicalRuleIds.length || policy.rules.some((rule, index) => !isPlainObject(rule) || rule.id !== canonicalRuleIds[index] || rule.decision !== "deny")) return null;
    return policy;
  } catch {
    return null;
  }
}

function parseVerifiedRoot(rawRoot) {
  if (typeof rawRoot !== "string" || rawRoot.length === 0) return null;
  try {
    const proof = JSON.parse(rawRoot);
    return isPlainObject(proof) ? proof : null;
  } catch {
    return null;
  }
}

/** Normalize only documented Claude Code/Codex PreToolUse fields. */
export function normalizeNativeRequest(surface, request) {
  if (!AUTOMATIC_SURFACES.has(surface) || !isPlainObject(request)) return null;
  if (request.hook_event_name !== "PreToolUse" || typeof request.tool_name !== "string" || !isPlainObject(request.tool_input)) return null;
  const toolName = request.tool_name.toLowerCase();
  const toolInput = request.tool_input;
  const paths = typeof toolInput.file_path === "string" ? [toolInput.file_path] : [];
  return {
    capability: COMMAND_TOOLS.has(toolName) ? "command-execution" : READ_TOOLS.has(toolName) ? "filesystem-read" : WRITE_TOOLS.has(toolName) ? "filesystem-write" : "",
    command: typeof toolInput.command === "string" ? toolInput.command : "",
    paths,
    gitOperation: typeof toolInput.command === "string" ? toolInput.command : null,
    secretOperation: READ_TOOLS.has(toolName) ? { operation: "read" } : null,
    nativeTool: request.tool_name
  };
}

export function buildNativeDecision(surface, classification) {
  const reason = isPlainObject(classification) && Object.hasOwn(CANONICAL_REASONS, classification.ruleId) ? CANONICAL_REASONS[classification.ruleId] : "";
  if (!AUTOMATIC_SURFACES.has(surface) || !isPlainObject(classification) || classification.decision !== "deny" || !reason) return {};
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason
    }
  };
}

async function readPolicy(policyPath, canonicalRuleIds) {
  if (!absolutePath(policyPath)) return null;
  try {
    return parsePolicy(await readFile(policyPath, "utf8"), canonicalRuleIds);
  } catch {
    return null;
  }
}

/** Execute an automatic Claude Code/Codex CLI guard from explicit argv/stdin. */
export async function runEmergencyGuard(argv = process.argv.slice(2), rawInput = null) {
  const surface = argumentValue(argv, "--surface");
  const policyPath = argumentValue(argv, "--policy-path");
  const verifiedRoot = argumentValue(argv, "--verified-disposable-root");
  if (!AUTOMATIC_SURFACES.has(surface)) return "{}";
  let policyModule;
  try {
    policyModule = await import(new URL("./emergency-policy.mjs", import.meta.url));
  } catch {
    return "{}";
  }
  const policy = await readPolicy(policyPath, policyModule.DEFAULT_RULE_IDS);
  const input = rawInput === null ? await readBoundedStdin(process.stdin, MAX_STDIN_BYTES) : rawInput;
  if (typeof input !== "string" || Buffer.byteLength(input, "utf8") > MAX_STDIN_BYTES) return "{}";
  const request = parseInput(input);
  const normalized = normalizeNativeRequest(surface, request);
  if (!normalized) return "{}";
  const verifiedDisposableRoot = parseVerifiedRoot(verifiedRoot);
  try {
    const extractedPaths = typeof policyModule.extractCandidatePaths === "function" ? policyModule.extractCandidatePaths(normalized.command) : [];
    const classification = policyModule.classifyEmergencyAction({ ...normalized, paths: [...normalized.paths, ...extractedPaths], verifiedDisposableRoot, policy });
    return JSON.stringify(buildNativeDecision(surface, classification));
  } catch {
    return "{}";
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.stdout.write(`${await runEmergencyGuard()}\n`);
  } catch {
    process.stdout.write("{}\n");
  }
}

export { NATIVE_FIELDS };
