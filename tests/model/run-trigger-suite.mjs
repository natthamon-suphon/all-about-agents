#!/usr/bin/env node
// Manual model-run trigger suite (phase 4b of docs/plans/2026-09-18-simplify-to-claude-codex.md).
// Runs real `claude -p` sessions for the routing cases of a few critical skills and records
// PASS / FAIL / NOT_RUN_UNAVAILABLE per case. Never part of quality:quick or quality:full.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const CASE_TIMEOUT_MS = 180_000;
const OUTPUT_DIR = ".aaa/eval-runs";
const EXCERPT_LENGTH = 400;

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Redact user paths and email-like tokens before anything leaves the process. */
export function redact(text, home = homedir()) {
  let value = String(text ?? "");
  if (home) value = value.split(home).join("<HOME>").split(home.replaceAll("\\", "/")).join("<HOME>");
  value = value.replace(/(?:[A-Za-z]:\\Users\\|\/(?:Users|home)\/)[^\s"'`]+/gu, "<USER_PATH>");
  value = value.replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/gu, "<EMAIL>");
  return value;
}

/** Classify one routing case from the model's final text. Pure; no I/O. */
export function evaluateCase({ skill, caseSpec, resultText, forbiddenPressurePhrases }) {
  const text = String(resultText ?? "");
  const announced = new RegExp(`Using skill \\*\\*${skill.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\b`, "u").test(text)
    || new RegExp(`\\b${skill.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\b[^\\n]{0,40}`, "u").test(text) && /skill/iu.test(text);
  const kind = /-TRIGGER-/u.test(caseSpec.id) ? "trigger" : /-NONTRIGGER-/u.test(caseSpec.id) ? "nontrigger" : /-PRESSURE-/u.test(caseSpec.id) ? "pressure" : "unknown";
  if (kind === "unknown") return { status: "FAIL", kind, reason: "case id does not name TRIGGER, NONTRIGGER, or PRESSURE" };
  if (kind === "nontrigger") return announced ? { status: "FAIL", kind, reason: "skill was announced for a nontrigger prompt" } : { status: "PASS", kind, reason: "skill stayed silent" };
  if (!announced) return { status: "FAIL", kind, reason: "skill was not announced" };
  if (kind === "pressure") {
    const hit = (forbiddenPressurePhrases ?? []).find((phrase) => text.toLowerCase().includes(String(phrase).toLowerCase()));
    if (hit) return { status: "FAIL", kind, reason: `pressure case implemented anyway ("${hit}")` };
  }
  return { status: "PASS", kind, reason: "skill announced" };
}

/** Preconditions that make a green run meaningful; each failure is a NOT_RUN_UNAVAILABLE reason. */
export function checkPreconditions({ root = ROOT, home = homedir(), env = process.env, spawn = spawnSync } = {}) {
  const reasons = [];
  const pkg = readJson(join(root, "package.json"));
  const version = spawn("claude", ["--version"], { encoding: "utf8", windowsHide: true, timeout: 20_000, shell: process.platform === "win32" });
  if (version.error || version.status !== 0) reasons.push("claude executable is unavailable");
  const configDir = env.CLAUDE_CONFIG_DIR && env.CLAUDE_CONFIG_DIR.trim() ? env.CLAUDE_CONFIG_DIR : join(home, ".claude");
  const installed = join(configDir, "plugins", "installed_plugins.json");
  if (!existsSync(installed)) reasons.push("installed_plugins.json is missing");
  else {
    const entry = readJson(installed).plugins?.["all-about-agents@all-about-agents"]?.[0];
    if (!entry) reasons.push("all-about-agents plugin is not installed");
    else if (entry.version !== pkg.version) reasons.push(`installed package stale: plugin ${entry.version}, package.json ${pkg.version}`);
    else if (!existsSync(join(entry.installPath, ".claude-plugin", "plugin.json"))) reasons.push("installed plugin cache is missing its manifest");
  }
  if (!existsSync(join(configDir, "CLAUDE.md"))) reasons.push("rendered global CLAUDE.md is not deployed to the config directory");
  return { ok: reasons.length === 0, reasons, packageVersion: pkg.version, configDir };
}

function makeDisposableRepo() {
  const dir = mkdtempSync(join(tmpdir(), "aaa-trigger-suite-"));
  writeFileSync(join(dir, "README.md"), "# Trigger suite fixture\n\nA small repository used only for headless routing checks.\n", "utf8");
  const init = spawnSync("git", ["init", "-q"], { cwd: dir, encoding: "utf8", windowsHide: true });
  if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`);
  return dir;
}

function runClaude(prompt, cwd, spawn) {
  const started = Date.now();
  const result = spawn("claude", ["-p", prompt, "--output-format", "json", "--permission-mode", "plan", "--no-session-persistence"], {
    cwd, encoding: "utf8", windowsHide: true, timeout: CASE_TIMEOUT_MS, shell: process.platform === "win32", maxBuffer: 8 * 1024 * 1024
  });
  const durationMs = Date.now() - started;
  if (result.error) return { unavailable: true, text: "", exitCode: null, durationMs, stderr: String(result.error.message) };
  let text = result.stdout ?? "";
  try { const parsed = JSON.parse(text); text = typeof parsed.result === "string" ? parsed.result : JSON.stringify(parsed); } catch { /* keep raw text */ }
  return { unavailable: false, text, exitCode: result.status, durationMs, stderr: result.stderr ?? "" };
}

export async function runSuite({ root = ROOT, spawn = spawnSync, suitePath = join(root, "tests", "model", "suite.json"), outputDir = join(root, OUTPUT_DIR), preconditions = checkPreconditions } = {}) {
  const suite = readJson(suitePath);
  const pre = preconditions({ root, spawn });
  const { runEvaluationBatch } = await import(pathToFileURL(join(root, "core", "evals", "runner.mjs")).href);
  const cases = [];
  for (const skill of suite.skills) {
    const routing = readJson(join(root, "core", "evals", "skill-routing", `${skill}.json`));
    for (const caseSpec of routing.cases) cases.push({ skill, caseSpec });
  }
  const repo = pre.ok ? makeDisposableRepo() : null;
  try {
    const batch = await runEvaluationBatch({
      cases,
      variant: "candidate",
      samples: cases.length,
      outputDir,
      executeSample: async ({ skill, caseSpec }, index) => {
        let status, reason, text = "", exitCode = null, durationMs = 0;
        if (!pre.ok) { status = "NOT_RUN_UNAVAILABLE"; reason = pre.reasons.join("; "); }
        else {
          const run = runClaude(caseSpec.prompt, repo, spawn);
          ({ text, exitCode, durationMs } = run);
          if (run.unavailable) { status = "NOT_RUN_UNAVAILABLE"; reason = "claude did not start"; }
          else if (/not logged in|authentication|unauthorized|login required/iu.test(`${run.stderr}\n${text}`) && run.exitCode !== 0) { status = "NOT_RUN_UNAVAILABLE"; reason = "claude session is not authenticated"; }
          else ({ status, reason } = evaluateCase({ skill, caseSpec, resultText: text, forbiddenPressurePhrases: suite.forbiddenPressurePhrases }));
        }
        const line = `${status.padEnd(20)} ${skill.padEnd(34)} ${caseSpec.id.padEnd(40)} ${reason}`;
        process.stdout.write(`${line}\n`);
        return {
          schemaVersion: 1,
          sampleId: `sample-${String(index + 1).padStart(2, "0")}`,
          caseId: caseSpec.id,
          variant: "candidate",
          output: redact(text).slice(0, EXCERPT_LENGTH),
          scores: { pass: status === "PASS" ? 1 : 0 },
          metadata: { status, skill, reason: redact(reason), exitCode: String(exitCode), durationMs: String(durationMs), packageVersion: pre.packageVersion }
        };
      }
    });
    const statuses = batch.results.map((entry) => entry.metadata.status);
    const summary = { total: statuses.length, pass: statuses.filter((s) => s === "PASS").length, fail: statuses.filter((s) => s === "FAIL").length, notRun: statuses.filter((s) => s === "NOT_RUN_UNAVAILABLE").length };
    process.stdout.write(`\nsummary: ${JSON.stringify(summary)}\n`);
    return { batch, summary, preconditions: pre };
  } finally {
    if (repo) rmSync(repo, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { summary } = await runSuite();
  process.exitCode = summary.fail > 0 ? 1 : 0;
}
