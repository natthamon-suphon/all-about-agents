#!/usr/bin/env node

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createQualityReport, formatQualityReport, writeQualityReport } from "./lib/quality-report.mjs";
import { runProcess } from "./lib/process-runner.mjs";
import { inspectSyncStatus } from "./sync-status.mjs";

const MODES = new Set(["quick", "full", "skill"]);
const FORMATS = new Set(["text", "json"]);
const SKILL_ID = /^[a-z0-9][a-z0-9-]*$/u;
const FOCUSED_TIMEOUT_MS = 300_000;
const FULL_TIMEOUT_MS = 900_000;
const MAX_EVIDENCE_LENGTH = 2_000;

function check(id, executable, args, { required = true, timeoutMs = FOCUSED_TIMEOUT_MS } = {}) {
  return Object.freeze({ id, required, executable, args: Object.freeze([...args]), timeoutMs });
}

const QUICK_CHECKS = Object.freeze([
  check("repository-contracts", process.execPath, ["scripts/aaa.mjs", "validate", "--scope", "all", "--format", "json"]),
  check("focused-contracts", process.execPath, [
    "--test",
    "tests/contracts/process-runner.test.mjs",
    "tests/contracts/quality-report.test.mjs",
    "tests/contracts/sync-status.test.mjs",
    "tests/contracts/skill-validation.test.mjs",
    "tests/contracts/adapter-contract.test.mjs",
    "tests/contracts/quality-gate.test.mjs"
  ]),
  check("static-contracts", process.execPath, ["--test", "tests/static/runtime.test.mjs", "tests/static/repository-layout.test.mjs"]),
  check("documentation-contracts", process.execPath, [
    "--test",
    "tests/static/documentation.test.mjs",
    "tests/static/contributor-entrypoints.test.mjs",
    "tests/static/maintenance-docs.test.mjs"
  ]),
  check("safety-contracts", process.execPath, [
    "--test",
    "tests/contracts/roots.test.mjs",
    "tests/contracts/apply.test.mjs"
  ]),
  check("installer-contracts", process.execPath, ["--test", "tests/integration/cli.test.mjs"]),
  check("release-contracts", process.execPath, ["--test", "tests/behavioral/release-gates.test.mjs"])
]);

const FULL_ONLY_CHECKS = Object.freeze([
  check("full-test-suite", process.execPath, ["--test"], { timeoutMs: FULL_TIMEOUT_MS }),
  check("native-claude-version", "claude", ["--version"], { required: false }),
  check("native-codex-version", "codex", ["--version"], { required: false }),
  check("native-agy-version", "agy", ["--version"], { required: false })
]);

function copyChecks(checks) {
  return checks.map((entry) => ({ ...entry, args: [...entry.args] }));
}

export function selectChecks({ mode, skill = null } = {}) {
  if (!MODES.has(mode)) throw new TypeError("mode must be quick, full, or skill");
  if (mode === "skill") {
    if (!SKILL_ID.test(skill ?? "")) throw new TypeError("skill mode requires one kebab-case skill name");
    return [
      { ...check("skill-artifacts", process.execPath, ["scripts/aaa.mjs", "validate", "--scope", "skill", "--skill", skill, "--format", "json"]), args: ["scripts/aaa.mjs", "validate", "--scope", "skill", "--skill", skill, "--format", "json"] },
      { ...check("skill-behavior", process.execPath, ["--test", `tests/behavioral/skills/${skill}.test.mjs`]), args: ["--test", `tests/behavioral/skills/${skill}.test.mjs`] }
    ];
  }
  if (skill !== null) throw new TypeError("skill is valid only in skill mode");
  return copyChecks(mode === "quick" ? QUICK_CHECKS : [...QUICK_CHECKS, ...FULL_ONLY_CHECKS]);
}

function asDate(clock, name) {
  const value = clock();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new TypeError(`${name} clock value must be a valid Date`);
  return value;
}

function nodeSupported(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/u.exec(version);
  if (!match) return false;
  const [major, minor] = [Number(match[1]), Number(match[2])];
  return major > 22 || major === 22 && minor >= 12;
}

function boundedEvidence(result) {
  const details = [result.stdout, result.stderr].filter((value) => typeof value === "string" && value.trim() !== "").join("\n").trim();
  const summary = result.outputTooLarge
    ? `process output exceeded the bounded capture${details ? `; ${details}` : ""}`
    : details || (result.timedOut ? "process timed out" : result.unavailable ? "executable is unavailable" : `process exited ${String(result.exitCode)}`);
  return summary.length <= MAX_EVIDENCE_LENGTH ? summary : `${summary.slice(0, MAX_EVIDENCE_LENGTH - 25)}\n...[evidence truncated]`;
}

function resultStatus(definition, result) {
  if (result.unavailable) return "NOT_RUN_UNAVAILABLE";
  if (result.timedOut) return "FAIL";
  if (result.outputTooLarge) return "FAIL";
  if (result.exitCode === 0) return "PASS";
  return "FAIL";
}

function validateProcessResult(result, checkId) {
  if (!result || typeof result !== "object" || typeof result.unavailable !== "boolean" || typeof result.timedOut !== "boolean" || typeof result.outputTooLarge !== "boolean") {
    throw new TypeError(`process runner returned an invalid result for ${checkId}`);
  }
}

export async function runQualityGate({
  mode,
  skill = null,
  repositoryRoot = process.cwd(),
  outputPath = null,
  format = "text",
  run = runProcess,
  clock = () => new Date()
} = {}) {
  if (!MODES.has(mode)) throw new TypeError("mode must be quick, full, or skill");
  if (!FORMATS.has(format)) throw new TypeError("format must be text or json");
  if (typeof repositoryRoot !== "string" || repositoryRoot.trim() === "" || repositoryRoot.includes("\0")) throw new TypeError("repositoryRoot must be a non-empty path");
  if (typeof run !== "function") throw new TypeError("run must be a process runner function");
  if (typeof clock !== "function") throw new TypeError("clock must be a function");
  const definitions = selectChecks({ mode, skill });
  const started = asDate(clock, "startedAt");
  const cwd = resolve(repositoryRoot);
  const sync = await inspectSyncStatus({ cwd, run });
  if (sync.commit === null || sync.relation === "git-unavailable" || sync.relation === "not-a-repository") {
    throw new Error(`quality gate requires readable Git repository metadata; observed ${sync.relation}`);
  }

  const checks = [];
  checks.push({
    id: "node-version",
    status: nodeSupported(process.versions.node) ? "PASS" : "FAIL",
    required: true,
    command: [process.execPath, "--version"],
    evidence: `Node ${process.version}`,
    durationMs: 0
  });
  checks.push({
    id: "git-metadata",
    status: "PASS",
    required: true,
    command: ["git", "status", "--porcelain=v1", "-z", "--untracked-files=all"],
    evidence: `branch=${sync.branch ?? "DETACHED"} commit=${sync.commit} relation=${sync.relation} dirty=${String(sync.dirty)}; remote comparison uses local refs`,
    durationMs: 0
  });

  for (const definition of definitions) {
    const checkStarted = asDate(clock, `${definition.id} start`);
    const result = await run({
      executable: definition.executable,
      args: [...definition.args],
      cwd,
      timeoutMs: definition.timeoutMs
    });
    validateProcessResult(result, definition.id);
    const checkFinished = asDate(clock, `${definition.id} finish`);
    checks.push({
      id: definition.id,
      status: resultStatus(definition, result),
      required: definition.required,
      command: [definition.executable, ...definition.args],
      evidence: boundedEvidence(result),
      durationMs: Math.max(0, checkFinished.getTime() - checkStarted.getTime())
    });
  }

  const finished = asDate(clock, "finishedAt");
  const report = createQualityReport({
    mode,
    skill,
    repository: { branch: sync.branch ?? "DETACHED", commit: sync.commit },
    runtime: { platform: process.platform, nodeVersion: process.version },
    checks,
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString()
  });
  if (outputPath !== null) await writeQualityReport(report, { outputPath, repositoryRoot: cwd });
  return report;
}

function parseArgs(argv) {
  if (argv.length === 0) throw new TypeError("quality mode is required: quick, full, or skill");
  if (argv[0] === "--help" || argv[0] === "-h") return { help: true, mode: null, skill: null, format: "text", outputPath: null };
  const mode = argv[0];
  if (!MODES.has(mode)) throw new TypeError("quality mode must be quick, full, or skill");
  let index = 1;
  let skill = null;
  if (mode === "skill") {
    skill = argv[index];
    if (!SKILL_ID.test(skill ?? "")) throw new TypeError("skill mode requires one kebab-case skill name");
    index += 1;
  }
  let format = "text";
  let outputPath = null;
  for (; index < argv.length; index += 1) {
    const option = argv[index];
    const equals = option.indexOf("=");
    const name = equals >= 0 ? option.slice(0, equals) : option;
    const inline = equals >= 0 ? option.slice(equals + 1) : null;
    if (name !== "--format" && name !== "--output") throw new TypeError(`unknown option: ${option}`);
    const value = inline ?? argv[index + 1];
    if (typeof value !== "string" || value === "" || (inline === null && value.startsWith("--"))) throw new TypeError(`${name} requires a value`);
    if (inline === null) index += 1;
    if (name === "--format") {
      if (!FORMATS.has(value)) throw new TypeError("--format must be text or json");
      format = value;
    } else {
      if (outputPath !== null) throw new TypeError("--output may be supplied only once");
      outputPath = value;
    }
  }
  return { help: false, mode, skill, format, outputPath };
}

const HELP = `Usage:\n  node scripts/quality-gate.mjs quick [--format text|json] [--output PATH]\n  node scripts/quality-gate.mjs full [--format text|json] [--output PATH]\n  node scripts/quality-gate.mjs skill SKILL_NAME [--format text|json] [--output PATH]\n`;

export async function main(argv = process.argv.slice(2), io = { stdout: process.stdout, stderr: process.stderr }, runtime = {}) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    io.stderr.write(`${error.message}\n`);
    return 2;
  }
  if (options.help) {
    io.stdout.write(HELP);
    return 0;
  }
  try {
    const report = await runQualityGate({
      mode: options.mode,
      skill: options.skill,
      repositoryRoot: runtime.repositoryRoot ?? process.cwd(),
      outputPath: options.outputPath,
      format: options.format,
      run: runtime.run ?? runProcess,
      clock: runtime.clock ?? (() => new Date())
    });
    io.stdout.write(formatQualityReport(report, { format: options.format }));
    return report.status === "PASS" ? 0 : 1;
  } catch (error) {
    io.stderr.write(`quality gate failed: ${error.message}\n`);
    return 1;
  }
}

const invokedUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedUrl === import.meta.url) process.exitCode = await main();
