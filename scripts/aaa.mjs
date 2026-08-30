import { existsSync, readFileSync } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import { readContainedUtf8Jsonl, runEvaluationBatch } from "../core/evals/runner.mjs";
import { loadCore } from "../installers/lib/load-core.mjs";
import { parseArgs } from "../installers/lib/args.mjs";
import { resolveDestinationRoot, assertSafeDestinationRoot } from "../installers/lib/roots.mjs";
import { renderForSurface, materializeRenderResult } from "../installers/lib/render.mjs";
import { buildPlan } from "../installers/lib/plan.mjs";
import { applyPlan } from "../installers/lib/apply.mjs";
import { readManagedState } from "../installers/lib/state.mjs";
import { hashBytes } from "../installers/lib/hash.mjs";
import { validateRenderResult } from "../adapters/shared/adapter-contract.mjs";
import { diagnose, SURFACES as DOCTOR_SURFACES } from "../installers/lib/doctor.mjs";
import { formatDiffText, formatPlanText, serializeReport } from "../installers/lib/report.mjs";

const HELP_TEXT = [
  "Usage: node scripts/aaa.mjs <action>",
  "",
  "Actions:",
  "  install   Install or update the local agent-system configuration",
  "  doctor    Check the local runtime and repository prerequisites",
  "  validate  Validate repository configuration and contracts",
  "  diff      Show the pending configuration diff",
  "  eval      Run an evaluation against a disposable root",
  "",
  "Options:",
  "  -h, --help  Show this help",
  ""
].join("\n");

const ACTIONS = new Set(["install", "doctor", "validate", "diff", "eval"]);
const REPOSITORY_VERSION_FALLBACK = "1.0.0";
const CONTENT_ACTIONS = new Set(["create", "replace", "unchanged"]);
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function hasValidFoundation(cwd) {
  try {
    const packagePath = resolve(cwd, "package.json");
    if (!existsSync(packagePath)) return false;
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
    return packageJson.type === "module" && packageJson.engines?.node === ">=22.12.0";
  } catch {
    return false;
  }
}

function repositoryVersion(cwd) {
  try {
    const value = JSON.parse(readFileSync(resolve(cwd, "package.json"), "utf8")).version;
    return typeof value === "string" && value.trim() ? value : REPOSITORY_VERSION_FALLBACK;
  } catch {
    return REPOSITORY_VERSION_FALLBACK;
  }
}

function parseEvalArgs(args) {
  const values = new Map();
  const allowed = new Set(["--skill", "--variant", "--samples", "--input-jsonl", "--output", "--format", "--surface"]);
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (!option.startsWith("--")) throw new Error(`Unexpected argument for eval: ${option}`);
    const equals = option.indexOf("=");
    const name = equals >= 0 ? option.slice(0, equals) : option;
    if (!allowed.has(name)) throw new Error(`Unknown eval option: ${name}`);
    if (values.has(name)) throw new Error(`Duplicate option: ${name}`);
    const inlineValue = equals >= 0 ? option.slice(equals + 1) : undefined;
    const value = inlineValue ?? args[index + 1];
    if (value === undefined || (inlineValue === undefined && value.startsWith("--")) || (inlineValue !== undefined && value.length === 0)) throw new Error(`Missing value for ${name}`);
    values.set(name, value);
    if (inlineValue === undefined) index += 1;
  }
  const required = ["--skill", "--variant", "--samples", "--input-jsonl", "--output"];
  for (const option of required) if (!values.has(option)) throw new Error(`Missing required option: ${option}`);
  const skill = values.get("--skill");
  const variant = values.get("--variant");
  const samples = Number(values.get("--samples"));
  const format = values.get("--format") || "text";
  const surface = values.get("--surface") || null;
  if (variant !== "control" && variant !== "candidate") throw new Error("--variant must be control or candidate");
  if (!Number.isInteger(samples) || samples < 1) throw new Error("--samples must be a positive integer");
  if (format !== "json" && format !== "text") throw new Error("--format must be json or text");
  if (surface !== null && !DOCTOR_SURFACES.includes(surface)) throw new Error(`--surface must be one of ${DOCTOR_SURFACES.join(", ")}`);
  return { skill, variant, samples, inputPath: values.get("--input-jsonl"), outputDir: values.get("--output"), format, surface };
}

function readCanonicalSkills(cwd) {
  const inventory = JSON.parse(readFileSync(resolve(cwd, "core/inventory.json"), "utf8"));
  return Array.isArray(inventory.skills) ? inventory.skills : [];
}

function parseValidateArgs(args) {
  const values = new Map();
  const allowed = new Set(["--scope", "--skill", "--format"]);
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (!option.startsWith("--")) throw new Error(`Unexpected argument for validate: ${option}`);
    const equals = option.indexOf("=");
    const name = equals >= 0 ? option.slice(0, equals) : option;
    if (!allowed.has(name)) throw new Error(`Unknown validate option: ${name}`);
    if (values.has(name)) throw new Error(`Duplicate option: ${name}`);
    const inlineValue = equals >= 0 ? option.slice(equals + 1) : undefined;
    const value = inlineValue ?? args[index + 1];
    if (value === undefined || (inlineValue === undefined && value.startsWith("--")) || (inlineValue !== undefined && value.length === 0)) throw new Error(`Missing value for ${name}`);
    values.set(name, value);
    if (inlineValue === undefined) index += 1;
  }
  const scope = values.get("--scope") || null;
  const skill = values.get("--skill") || null;
  const format = values.get("--format") || "text";
  if (scope !== null && scope !== "core" && scope !== "all" && scope !== "skill") throw new Error("--scope must be core, all, or skill");
  if (scope === "skill" && skill === null) throw new Error("--scope skill requires --skill SKILL_NAME");
  if (scope !== "skill" && skill !== null) throw new Error("--skill requires --scope skill");
  if (format !== "json" && format !== "text") throw new Error("--format must be json or text");
  return { scope, skill, format };
}

function formatError(error) {
  return { code: error?.code || "error", message: error?.message || String(error) };
}

function emitError(error, format, output, errorOutput, code = 1) {
  if (format === "json") output.write(serializeReport({ status: "fail", error: formatError(error) }));
  else errorOutput.write(`${error?.message || String(error)}\n`);
  return code;
}

function wantsJson(args) {
  return args.some((value, index) => value === "--format=json" || (value === "--format" && args[index + 1] === "json"));
}

function hasOption(args, name) {
  return args.some((value) => value === name || value.startsWith(`${name}=`));
}

async function terminalPrompt(label) {
  // Keep machine-readable stdout clean when an interactive caller requests
  // JSON; prompts belong on the diagnostic stream.
  const readline = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await readline.question(`${label}: `);
  } finally {
    readline.close();
  }
}

function emitValidationResult(result, output, errorOutput) {
  if (result.valid) {
    if (result.format === "json") output.write(serializeReport(result.report));
    else output.write(`valid scope=${result.scope}${result.skill ? ` skill=${result.skill}` : ""}\n`);
    return 0;
  }
  if (result.format === "json") output.write(serializeReport(result.report));
  else for (const error of result.errors || []) errorOutput.write(`${error.sourcePath || "<core>"}#${error.jsonPointer || ""} ${error.keyword || "validation"}: ${error.message}\n`);
  return 1;
}

function envForRoot(surface, root = null) {
  const env = { ...process.env };
  if (root !== null && root !== undefined && surface === "claude") env.CLAUDE_CONFIG_DIR = root;
  if (root !== null && root !== undefined && surface === "codex") env.CODEX_HOME = root;
  return env;
}

function normalizeParsedOptions(options, cwd) {
  if (options.destinationRoot === null) return options;
  const destinationRoot = isAbsolute(options.destinationRoot)
    ? options.destinationRoot
    : resolve(cwd, options.destinationRoot);
  return Object.freeze({ ...options, destinationRoot });
}

function surfaceRoots(options) {
  return options.surfaces.map((surface) => ({
    surface,
    root: resolveDestinationRoot({ surface, override: options.destinationRoot, env: process.env, platform: process.platform, homeDir: homedir() })
  }));
}

async function renderPlans(options, cwd) {
  const roots = surfaceRoots(options);
  const core = await loadCore(cwd);
  const entries = [];
  for (const { surface, root } of roots) {
    const rendered = await renderForSurface({ repositoryRoot: cwd, core, surface, profile: options.profile, statuslineName: options.statuslineName, platform: process.platform, env: envForRoot(surface, options.destinationRoot ? root : null) });
    const payload = materializeRenderResult(rendered);
    const validation = validateRenderResult(payload);
    if (!validation.valid) throw new Error(`render validation failed for ${surface}: ${JSON.stringify(validation.errors)}`);
    const previousState = await readManagedState(root);
    const plan = buildPlan({ payload, destinationRoot: root, previousState });
    const contents = new Map(payload.files.map((file) => [file.relativePath, file.content]));
    entries.push({ surface, root, payload, plan, contents });
  }
  if (options.destinationRoot && entries.length > 1) {
    const [first] = entries;
    // An explicitly supplied shared root is a disposable/operator sandbox.
    // Namespace each independently rendered package so vendor-neutral files
    // (for example hooks/activity-audit.json) cannot overwrite one another.
    const files = entries.flatMap((entry) => entry.payload.files.map((file) => ({
      ...file,
      relativePath: `${entry.surface}/${file.relativePath}`
    })));
    const payload = {
      surface: first.surface,
      files,
      registrations: entries.flatMap((entry) => entry.payload.registrations),
      diagnostics: entries.flatMap((entry) => entry.payload.diagnostics),
      ownership: entries.flatMap((entry) => entry.payload.ownership.map((ownership) => ({
        ...ownership,
        relativePath: `${entry.surface}/${ownership.relativePath}`
      })))
    };
    const previousState = await readManagedState(first.root);
    const plan = buildPlan({ payload, destinationRoot: first.root, previousState });
    return [{ surface: first.surface, root: first.root, payload, plan, contents: new Map(files.map((file) => [file.relativePath, file.content])) }];
  }
  return entries;
}

function targetPath(root, relativePath) {
  const target = resolve(root, ...relativePath.split("/"));
  const suffix = relative(root, target);
  if (isAbsolute(suffix) || suffix === ".." || suffix.startsWith("../") || suffix.startsWith("..\\")) throw new Error(`destination escapes selected root: ${relativePath}`);
  return target;
}

async function observedTarget(target) {
  try {
    const stats = await lstat(target);
    if (stats.isSymbolicLink()) return { kind: "symlink" };
    if (!stats.isFile()) return { kind: "not-file" };
    return { kind: "file", bytes: await readFile(target) };
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return { kind: "missing" };
    return { kind: "error", error };
  }
}

/** Read-only aggregate preflight used before any selected surface is applied. */
async function preflightEntries(entries) {
  for (const entry of entries) {
    const { plan, contents } = entry;
    try {
      assertSafeDestinationRoot(plan.root);
      assertSafeDestinationRoot(resolve(plan.root, ".all-about-agents"));
    } catch (error) {
      return { entry, action: plan.actions[0] || null, reason: `destination root is unsafe: ${error.message}` };
    }
    const errorDiagnostic = plan.diagnostics.find((diagnostic) => diagnostic.severity === "error");
    if (errorDiagnostic) return { entry, action: plan.actions[0] || null, reason: `plan contains error diagnostic: ${errorDiagnostic.message}` };
    for (const action of plan.actions) {
      if (action.kind === "reject") return { entry, action, reason: `plan rejected before mutation: ${action.reason}` };
      if (CONTENT_ACTIONS.has(action.kind)) {
        const content = contents.get(action.relativePath);
        if (!(content instanceof Uint8Array) || hashBytes(content) !== action.contentHash) return { entry, action, reason: "rendered content rejected before mutation: content hash does not match plan" };
      }
      let target;
      try {
        target = targetPath(plan.root, action.relativePath);
        assertSafeDestinationRoot(dirname(target));
      } catch (error) {
        return { entry, action, reason: error.message };
      }
      const observed = await observedTarget(target);
      if (action.kind === "create" && observed.kind !== "missing") return { entry, action, reason: "create destination appeared or is not writable as a new file" };
      if (["replace", "unchanged", "prune"].includes(action.kind)) {
        if (observed.kind === "missing") return { entry, action, reason: "destination disappeared after planning" };
        if (observed.kind === "symlink") return { entry, action, reason: "destination is a symlink or junction" };
        if (observed.kind !== "file") return { entry, action, reason: observed.error ? `destination cannot be read: ${observed.error.message}` : "destination is not a regular file" };
        const expected = action.kind === "unchanged" ? action.contentHash : action.expectedHash;
        if (hashBytes(observed.bytes) !== expected) return { entry, action, reason: "destination bytes changed after planning" };
      }
    }
  }
  return null;
}

function planHasFailure(plan) {
  return plan.actions.some((action) => action.kind === "reject") || plan.diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

function installText(report) {
  const lines = [`action=${report.action} mode=${report.mode} status=${report.status}`, `profile=${report.profile} surfaces=${report.surfaces.join(",")}`];
  for (const plan of report.plans) lines.push(formatPlanText(plan).trimEnd());
  for (const result of report.results || []) lines.push(`apply=${result.status} completed=${result.completed.length} failed=${result.failed?.relativePath || ""}`);
  return `${lines.join("\n")}\n`;
}

function emitActionReport(report, format, output, errorOutput, exitCode) {
  if (format === "json") output.write(serializeReport(report));
  else output.write(installText(report));
  if (exitCode !== 0 && format !== "json" && report.error) errorOutput.write(`${report.error}\n`);
  return exitCode;
}

async function installOrDiff(options, output, errorOutput, cwd) {
  let entries;
  try {
    entries = await renderPlans(options, cwd);
  } catch (error) {
    return emitError(error, options.format, output, errorOutput, 1);
  }
  if (options.action === "diff") {
    const changes = [];
    for (const entry of entries) {
      for (const action of entry.plan.actions) {
        if (action.kind === "unchanged") continue;
        let before = "";
        if (["replace", "prune"].includes(action.kind)) {
          const observed = await observedTarget(targetPath(entry.root, action.relativePath));
          before = observed.kind === "file" ? safeDiffText(observed.bytes) : "";
        }
        const desired = CONTENT_ACTIONS.has(action.kind) ? safeDiffText(entry.contents.get(action.relativePath)) : "";
        const diff = unifiedDiff(action.relativePath, before, desired);
        changes.push({ surface: entry.surface, relativePath: action.relativePath, kind: action.kind, diff });
      }
    }
    const failed = entries.some(({ plan }) => planHasFailure(plan));
    const report = { action: "diff", status: failed ? "fail" : "pass", profile: options.profile, surfaces: options.surfaces, plans: entries.map(({ plan }) => plan), changes };
    if (options.format === "json") output.write(serializeReport(report));
    else output.write(formatDiffText(changes));
    return failed ? 1 : 0;
  }
  const hasFailure = entries.some(({ plan }) => planHasFailure(plan));
  if (options.mode === "dry-run") {
    const report = { action: "install", mode: "dry-run", status: hasFailure ? "fail" : "dry-run", profile: options.profile, surfaces: options.surfaces, plans: entries.map(({ plan }) => plan), results: [], ...(hasFailure ? { error: "dry-run preflight rejected one or more selected surfaces" } : {}) };
    return emitActionReport(report, options.format, output, errorOutput, hasFailure ? 1 : 0);
  }
  const preflightFailure = await preflightEntries(entries);
  if (preflightFailure) {
    const report = { action: "install", mode: "apply", status: "failed", profile: options.profile, surfaces: options.surfaces, plans: entries.map(({ plan }) => plan), results: [], error: preflightFailure.reason, failed: preflightFailure.action };
    return emitActionReport(report, options.format, output, errorOutput, 1);
  }
  const results = [];
  let aggregateStatus = "complete";
  for (const entry of entries) {
    const result = await applyPlan({ plan: entry.plan, fileSystem: { contents: entry.contents, repositoryVersion: repositoryVersion(cwd), profile: options.profile, surfaces: options.surfaces } });
    results.push(result);
    if (result.status !== "complete") {
      aggregateStatus = results.some((candidate) => candidate.completed.length > 0) ? "partial" : "failed";
      break;
    }
  }
  const report = { action: "install", mode: "apply", status: aggregateStatus, profile: options.profile, surfaces: options.surfaces, plans: entries.map(({ plan }) => plan), results };
  return emitActionReport(report, options.format, output, errorOutput, aggregateStatus === "complete" ? 0 : 1);
}

function safeDiffText(bytes) {
  if (!(bytes instanceof Uint8Array)) return "";
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return `<binary sha256=${hashBytes(bytes)}>`; }
  return text
    .replace(/(Bearer\s+)[^\s"']+/giu, "$1[REDACTED]")
    .replace(/((?:["']?(?:api[_ -]?key|password|secret|token)["']?\s*[:=]\s*))(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,}\]]+)/giu, "$1[REDACTED]");
}

function unifiedDiff(relativePath, before, after) {
  const oldLines = before === "" ? [] : before.replace(/\r\n?/gu, "\n").split("\n");
  const newLines = after === "" ? [] : after.replace(/\r\n?/gu, "\n").split("\n");
  if (oldLines.length > 0 && oldLines.at(-1) === "") oldLines.pop();
  if (newLines.length > 0 && newLines.at(-1) === "") newLines.pop();
  if (oldLines.join("\n") === newLines.join("\n")) return "";
  return [`--- a/${relativePath}`, `+++ b/${relativePath}`, `@@ -1,${oldLines.length} +1,${newLines.length} @@`, ...oldLines.map((line) => `-${line}`), ...newLines.map((line) => `+${line}`)].join("\n");
}

async function validate(args, output, errorOutput, cwd) {
  let options;
  try { options = parseValidateArgs(args); } catch (error) { return emitError(error, wantsJson(args) ? "json" : "text", output, errorOutput, 2); }
  if (!hasValidFoundation(cwd)) {
    return emitError(new Error("Foundation validation failed: package metadata is missing or invalid"), options.format, output, errorOutput, 1);
  }
  try {
    const core = await loadCore(cwd);
    if (options.scope === "skill") {
      const inventorySkills = readCanonicalSkills(cwd);
      const skill = core.skills.find((entry) => entry.id === options.skill);
      const errors = [];
      if (!inventorySkills.includes(options.skill)) errors.push({ sourcePath: "core/inventory.json", jsonPointer: "/skills", keyword: "reference", message: `skill ${options.skill} is not listed in inventory.skills` });
      if (!skill) errors.push({ sourcePath: "core/skills", jsonPointer: "", keyword: "reference", message: `canonical skill ${options.skill} was not found` });
      if (!core.evals.some((entry) => entry.skill === options.skill || entry.skillId === options.skill)) errors.push({ sourcePath: "core/evals", jsonPointer: "", keyword: "reference", message: `evaluation cases for ${options.skill} were not found` });
      const report = { action: "validate", status: errors.length === 0 ? "pass" : "fail", scope: "skill", skill: options.skill, errors };
      return emitValidationResult({ valid: errors.length === 0, scope: "skill", skill: options.skill, errors, format: options.format, report }, output, errorOutput);
    }
    await Promise.all(DOCTOR_SURFACES.map((surface) => renderForSurface({ repositoryRoot: cwd, core, surface, profile: "portable", statuslineName: "", platform: process.platform })));
    const report = { action: "validate", status: "pass", scope: options.scope, errors: [] };
    return emitValidationResult({ valid: true, scope: options.scope, format: options.format, report }, output, errorOutput);
  } catch (error) {
    const errors = Array.isArray(error.errors) ? error.errors : [{ sourcePath: "core", jsonPointer: "", keyword: "load", message: error.message }];
    const report = { action: "validate", status: "fail", scope: options.scope, ...(options.skill ? { skill: options.skill } : {}), errors };
    return emitValidationResult({ valid: false, scope: options.scope, ...(options.skill ? { skill: options.skill } : {}), errors, format: options.format, report }, output, errorOutput);
  }
}

function doctorFailureChecks(surface, error, runtimes) {
  const productVersion = typeof runtimes[surface] === "string" && runtimes[surface].trim() ? runtimes[surface].trim() : null;
  return [
    { id: "runtime:node", surface: null, status: typeof runtimes.node === "string" ? "pass" : "not run", evidence: typeof runtimes.node === "string" ? `Node runtime reported as ${runtimes.node}` : "Node runtime availability was not supplied" },
    { id: `runtime:${surface}`, surface, status: productVersion ? "pass" : "not run", evidence: productVersion ? `${surface} runtime reported as ${productVersion}` : `${surface} runtime availability is unknown; no product probe was attempted` },
    { id: `root:${surface}`, surface, status: error?.code === "manual-discovery-required" ? "not run" : "fail", evidence: `destination root unavailable: ${error.message}` },
    { id: `writable:${surface}`, surface, status: "not run", evidence: "writable check was not attempted because the destination root is unavailable" },
    { id: `capability:${surface}`, surface, status: "not run", evidence: `${surface} capability version is not verified; no native capability probe was attempted` },
    { id: `manual:${surface}`, surface, status: "not run", evidence: `${surface} manual acceptance steps remain outstanding; no product session was opened` }
  ];
}

function doctorStatus(checks) {
  if (checks.some((entry) => entry.status === "fail")) return "fail";
  if (checks.some((entry) => entry.status === "not run")) return "not run";
  return "pass";
}

async function doctor(args, output, errorOutput, cwd, invocationCwd = cwd) {
  let options;
  try { options = normalizeParsedOptions(parseArgs(["doctor", ...args]), invocationCwd); } catch (error) { return emitError(error, wantsJson(args) ? "json" : "text", output, errorOutput, 2); }
  if (!hasValidFoundation(cwd)) return emitError(new Error("Foundation validation failed: package metadata is missing or invalid"), options.format, output, errorOutput, 1);
  const runtimes = { node: process.versions.node };
  const checks = [];
  const seen = new Set();
  if (options.destinationRoot) {
    const result = await diagnose({ surfaces: options.surfaces, profile: options.profile, destinationRoot: resolve(options.destinationRoot), runtimes });
    checks.push(...result.checks);
  } else {
    for (const surface of options.surfaces) {
      try {
        const root = resolveDestinationRoot({ surface, override: null, env: process.env, platform: process.platform, homeDir: homedir() });
        const result = await diagnose({ surfaces: [surface], profile: options.profile, destinationRoot: root, runtimes });
        for (const item of result.checks) if (!seen.has(item.id)) { seen.add(item.id); checks.push(item); }
      } catch (error) {
        for (const item of doctorFailureChecks(surface, error, runtimes)) if (!seen.has(item.id)) { seen.add(item.id); checks.push(item); }
      }
    }
  }
  const report = { action: "doctor", status: doctorStatus(checks), profile: options.profile, surfaces: options.surfaces, checks };
  if (options.format === "json") output.write(serializeReport(report));
  else output.write(`${report.status}\n${checks.map((item) => `${item.status}\t${item.id}\t${item.evidence}`).join("\n")}\n`);
  return report.status === "pass" ? 0 : 1;
}

async function evaluate(args, output, errorOutput, cwd) {
  let options;
  try { options = parseEvalArgs(args); } catch (error) { return emitError(error, wantsJson(args) ? "json" : "text", output, errorOutput, 2); }
  try {
    if (!readCanonicalSkills(cwd).includes(options.skill)) return emitError(new Error(`Unknown canonical skill: ${options.skill}`), options.format, output, errorOutput, 1);
  } catch (error) {
    return emitError(new Error(`Unable to load canonical inventory: ${error.message}`), options.format, output, errorOutput, 1);
  }
  if (options.samples !== 5) return emitError(new Error("--samples must be exactly 5 for the fresh-session evaluation contract"), options.format, output, errorOutput, 1);
  try {
    const text = await readContainedUtf8Jsonl(options.inputPath);
    const lines = text.split(/\r?\n/u);
    if (lines.at(-1) === "") lines.pop();
    if (lines.some((line) => line.trim().length === 0)) throw new Error("input JSONL contains a blank record");
    if (lines.length !== options.samples) throw new Error(`input JSONL must contain exactly ${options.samples} records`);
    const cases = lines.map((line, index) => { try { return JSON.parse(line); } catch (error) { throw new Error(`malformed JSONL at line ${index + 1}: ${error.message}`); } });
    const batch = await runEvaluationBatch({ cases, variant: options.variant, samples: options.samples, executeSample: async (caseRecord) => caseRecord, outputDir: options.outputDir });
    const report = { ...batch, action: "eval", skill: options.skill, ...(options.surface ? { surface: options.surface } : {}), ingestion: { status: "not run", mode: "manual/fresh-session", message: "Fresh-session ingestion remains an explicit manual step; no vendor or credential transport was invoked." } };
    if (options.format === "json") output.write(serializeReport(report));
    else output.write(`variant=${batch.variant} samples=${batch.requestedSamples}\ningestion=not run (manual/fresh-session)\n`);
    return 0;
  } catch (error) {
    return emitError(error, options.format, output, errorOutput, 1);
  }
}

export { renderPlans };

export async function main(args, output = process.stdout, errorOutput = process.stderr, runtime = {}) {
  const invocationCwd = process.cwd();
  const argv = Array.isArray(args) ? args : [];
  const runtimeOptions = runtime && typeof runtime === "object" ? runtime : {};
  const cwd = typeof runtimeOptions.repositoryRoot === "string" ? resolve(runtimeOptions.repositoryRoot) : REPOSITORY_ROOT;
  const interactive = runtimeOptions.interactive === undefined
    ? output === process.stdout && process.stdin.isTTY === true && process.stdout.isTTY === true
    : runtimeOptions.interactive === true;
  const prompt = runtimeOptions.prompt || terminalPrompt;
  const first = argv[0];
  if (argv.length === 0 || first === "-h" || first === "--help") {
    if (argv.length > 1) return emitError(new Error("Help does not accept additional arguments."), "text", output, errorOutput, 2);
    output.write(HELP_TEXT);
    return 0;
  }
  const action = first.startsWith("-") ? "install" : first;
  if (!ACTIONS.has(action)) {
    if (wantsJson(argv)) return emitError(new Error(`Unknown action: ${action}`), "json", output, errorOutput, 2);
    errorOutput.write(`Unknown action: ${action}\n`);
    return 2;
  }
  const rest = first === action ? argv.slice(1) : argv;
  if (rest.includes("-h") || rest.includes("--help")) {
    if (rest.length !== 1) return emitError(new Error("Help does not accept additional arguments."), "text", output, errorOutput, 2);
    output.write(HELP_TEXT);
    return 0;
  }
  if (action === "eval") return evaluate(rest, output, errorOutput, cwd);
  if (action === "validate") return validate(rest, output, errorOutput, cwd);
  let options;
  try {
    options = normalizeParsedOptions(parseArgs([action, ...rest]), invocationCwd);
    if (action === "install" && interactive && options.surfaces.includes("claude") && !hasOption(rest, "--statusline-name")) {
      const statuslineName = await prompt("Statusline display name");
      options = normalizeParsedOptions(parseArgs([action, ...rest, "--statusline-name", statuslineName]), invocationCwd);
    }
  } catch (error) { return emitError(error, wantsJson(rest) ? "json" : "text", output, errorOutput, 2); }
  if (action === "doctor") return doctor(rest, output, errorOutput, cwd, invocationCwd);
  if (!hasValidFoundation(cwd)) return emitError(new Error("Foundation validation failed: package metadata is missing or invalid"), options.format, output, errorOutput, 1);
  if (action === "install" || action === "diff") return installOrDiff(options, output, errorOutput, cwd);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
