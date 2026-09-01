import { lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import { atomicReplaceFile } from "../../installers/lib/atomic-write.mjs";
import { hashBytes } from "../../installers/lib/hash.mjs";
import { assertSafeDestinationRoot } from "../../installers/lib/roots.mjs";

const MODES = new Set(["quick", "full", "skill"]);
const CHECK_STATUSES = new Set(["PASS", "FAIL", "NOT_RUN", "NOT_RUN_UNAVAILABLE"]);
const FORMATS = new Set(["text", "json"]);
const SKILL_ID = /^[a-z0-9][a-z0-9-]*$/u;
const CHECK_ID = /^[a-z0-9][a-z0-9-]*$/u;
const COMMIT = /^[0-9a-f]{40,64}$/u;
const compareCodePoints = (left, right) => left === right ? 0 : left < right ? -1 : 1;

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isoTimestamp(value, name) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new TypeError(`${name} must be an ISO timestamp`);
  }
  return value;
}

export function redactQualityText(value) {
  if (typeof value !== "string") throw new TypeError("quality evidence must be a string");
  let output = value;
  const exactHomePaths = [homedir(), process.env.USERPROFILE, process.env.HOME]
    .filter((candidate, index, values) => typeof candidate === "string" && candidate.length > 0 && values.indexOf(candidate) === index)
    .flatMap((candidate) => [candidate, candidate.replaceAll("\\", "/"), candidate.replaceAll("/", "\\")]);
  for (const candidate of [...new Set(exactHomePaths)].sort((left, right) => right.length - left.length)) {
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    output = output.replace(new RegExp(escaped, process.platform === "win32" ? "giu" : "gu"), "[REDACTED_HOME]");
  }
  return output
    .replace(/:\/\/[^/@\s:]+:[^/@\s]+@/gu, "://[REDACTED]@")
    .replace(/\bAuthorization\s*:\s*(?:Basic|Bearer)\s+[^\s,;]+/giu, "Authorization: [REDACTED]")
    .replace(/\bBearer\s+[^\s]+/giu, "Bearer [REDACTED]")
    .replace(/\b(Set-Cookie|Cookie)\s*:\s*[^\r\n]*/giu, "$1: [REDACTED]")
    .replace(/(["'])(password|pass_word|token|api[_-]?key|secret|authorization|session|cookie)\1\s*:\s*(["'])[^"'\r\n]*\3/giu, "$1$2$1:$3[REDACTED]$3")
    .replace(/\b([A-Z0-9_]*(?:ACCESS[_-]?KEY(?:_ID)?|TOKEN|API[_-]?KEY|SECRET|PASSWORD|SESSION|COOKIE)[A-Z0-9_]*)\s*[:=]\s*[^\s,;]+/giu, "$1=[REDACTED]")
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/gu, "[REDACTED_TOKEN]")
    .replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/gu, "[REDACTED_TOKEN]")
    .replace(/\bsk-[A-Za-z0-9_-]{10,}\b/gu, "[REDACTED]")
    .replace(/\b([A-Za-z]:[\\/]+Users[\\/]+)[^\\/\s"'<>|]+/giu, "$1[REDACTED_USER]")
    .replace(/(\/(?:home|Users)\/)[^/\s"'<>]+/gu, "$1[REDACTED_USER]")
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gu, "[REDACTED PRIVATE KEY]");
}

function redactCommand(command) {
  const result = command.map((value) => redactQualityText(value));
  for (let index = 0; index < result.length - 1; index += 1) {
    if (/^--?(?:token|api[-_]?key|secret|password)$/iu.test(result[index])) result[index + 1] = "[REDACTED]";
  }
  return result;
}

function validateRepository(repository) {
  if (!object(repository) || typeof repository.branch !== "string" || repository.branch.trim() === "" || !COMMIT.test(repository.commit)) {
    throw new TypeError("repository must include a non-empty branch and lowercase commit SHA");
  }
  return { branch: repository.branch, commit: repository.commit };
}

function validateRuntime(runtime) {
  if (!object(runtime) || !["win32", "darwin", "linux"].includes(runtime.platform) || typeof runtime.nodeVersion !== "string" || !/^v\d+\.\d+\.\d+/u.test(runtime.nodeVersion)) {
    throw new TypeError("runtime must include a supported platform and Node.js version");
  }
  return { platform: runtime.platform, nodeVersion: runtime.nodeVersion };
}

function normalizeChecks(checks) {
  if (!Array.isArray(checks) || checks.length === 0) throw new TypeError("checks must be a non-empty array");
  const seen = new Set();
  const normalized = checks.map((check) => {
    if (!object(check) || !CHECK_ID.test(check.id ?? "")) throw new TypeError("every check must have a kebab-case id");
    if (seen.has(check.id)) throw new TypeError(`duplicate check id: ${check.id}`);
    seen.add(check.id);
    if (!CHECK_STATUSES.has(check.status)) throw new TypeError(`check ${check.id} has an invalid status`);
    if (typeof check.required !== "boolean") throw new TypeError(`check ${check.id} must declare required`);
    if (!Array.isArray(check.command) || check.command.some((value) => typeof value !== "string")) throw new TypeError(`check ${check.id} command must be a string array`);
    if (typeof check.evidence !== "string" || check.evidence.trim() === "") throw new TypeError(`check ${check.id} evidence must be non-empty`);
    if (!Number.isInteger(check.durationMs) || check.durationMs < 0) throw new TypeError(`check ${check.id} durationMs must be a non-negative integer`);
    return {
      id: check.id,
      status: check.status,
      required: check.required,
      command: redactCommand(check.command),
      evidence: redactQualityText(check.evidence),
      durationMs: check.durationMs
    };
  });
  return normalized.sort((left, right) => compareCodePoints(left.id, right.id));
}

export function createQualityReport({
  mode,
  skill = null,
  repository,
  runtime,
  checks,
  startedAt,
  finishedAt
} = {}) {
  if (!MODES.has(mode)) throw new TypeError("mode must be quick, full, or skill");
  if (mode === "skill" && !SKILL_ID.test(skill ?? "")) throw new TypeError("skill mode requires a valid skill id");
  if (mode !== "skill" && skill !== null) throw new TypeError("skill must be null outside skill mode");
  const start = isoTimestamp(startedAt, "startedAt");
  const finish = isoTimestamp(finishedAt, "finishedAt");
  if (Date.parse(finish) < Date.parse(start)) throw new TypeError("finishedAt must not be earlier than startedAt");
  const normalizedChecks = normalizeChecks(checks);
  const status = normalizedChecks.some((check) => check.required && check.status !== "PASS") ? "FAIL" : "PASS";
  return {
    schemaVersion: 1,
    timestamp: finish,
    startedAt: start,
    finishedAt: finish,
    mode,
    skill,
    repository: validateRepository(repository),
    runtime: validateRuntime(runtime),
    checks: normalizedChecks,
    status,
    nextAction: status === "PASS"
      ? "Continue with the next approved step."
      : "Fix failed or unrun required checks, then run this quality command again."
  };
}

export function formatQualityReport(report, { format = "text" } = {}) {
  if (!FORMATS.has(format)) throw new TypeError("format must be text or json");
  if (!object(report) || report.schemaVersion !== 1 || !Array.isArray(report.checks)) throw new TypeError("report must be a quality report");
  if (format === "json") return `${JSON.stringify(report, null, 2)}\n`;
  const lines = [
    `Quality: ${report.status}`,
    `Mode: ${report.mode}${report.skill ? ` (${report.skill})` : ""}`,
    `Repository: ${report.repository.branch} ${report.repository.commit}`,
    `Runtime: ${report.runtime.platform} ${report.runtime.nodeVersion}`,
    "Checks:"
  ];
  for (const check of report.checks) lines.push(`- ${check.id}: ${check.status} — ${check.evidence}`);
  lines.push(`Next: ${report.nextAction}`);
  return `${lines.join("\n")}\n`;
}

function contained(root, candidate) {
  const relativePath = relative(root, candidate);
  return relativePath === "" || (relativePath !== ".." && !relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(relativePath));
}

function operation(fileSystem, name, fallback) {
  const candidate = fileSystem?.[name];
  return typeof candidate === "function" ? candidate.bind(fileSystem) : fallback;
}

async function rejectLinkDestination(destination, fileSystem) {
  const inspect = operation(fileSystem, "lstat", lstat);
  try {
    const metadata = await inspect(destination);
    if (metadata?.isSymbolicLink?.() || metadata?.isReparsePoint?.()) {
      throw new Error("quality report destination must not be a symlink or reparse point");
    }
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
}

export async function writeQualityReport(report, {
  outputPath,
  repositoryRoot,
  fileSystem = {}
} = {}) {
  if (typeof outputPath !== "string" || outputPath.trim() === "" || outputPath.includes("\0")) {
    throw new TypeError("outputPath must be an explicit non-empty path");
  }
  if (typeof repositoryRoot !== "string" || repositoryRoot.trim() === "" || repositoryRoot.includes("\0")) {
    throw new TypeError("repositoryRoot must be a non-empty path");
  }
  const root = resolve(repositoryRoot);
  const destination = isAbsolute(outputPath) ? resolve(outputPath) : resolve(root, outputPath);
  if (!contained(root, destination) || destination === root) throw new Error("quality report output must be contained by repositoryRoot");
  assertSafeDestinationRoot(root, { allowedProductRoots: [root] });
  assertSafeDestinationRoot(dirname(destination), { allowedProductRoots: [root] });
  await rejectLinkDestination(destination, fileSystem);
  const content = new TextEncoder().encode(formatQualityReport(report, { format: "json" }));
  const result = await atomicReplaceFile({
    destination,
    content,
    expectedHash: hashBytes(content),
    allowedProductRoots: [root],
    fileSystem
  });
  return { path: result.path, bytes: content.byteLength };
}
