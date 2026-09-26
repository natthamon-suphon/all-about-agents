import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import reportSchema from "../../installers/schemas/quality-report.schema.json" with { type: "json" };
import { validateSchema } from "../../installers/lib/validate-schema.mjs";
import { makeTempRoot } from "../helpers/temp-root.mjs";

let qualityModule;
try {
  qualityModule = await import("../../scripts/quality-gate.mjs");
} catch (error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
}

const SHA = "c".repeat(40);

function processResult({ exitCode = 0, stdout = "", stderr = "", unavailable = false, timedOut = false, outputTooLarge = false } = {}) {
  return { exitCode, stdout, stderr, signal: null, unavailable, timedOut, outputTooLarge };
}

function runner({ failCheck = null, unavailableCheck = null, oversizedCheck = null } = {}) {
  const calls = [];
  const run = async ({ executable, args, cwd, timeoutMs }) => {
    calls.push({ executable, args: [...args], cwd, timeoutMs });
    if (executable === "git") {
      const key = args.join(" ");
      if (key === "rev-parse --is-inside-work-tree") return processResult({ stdout: "true\n" });
      if (key === "status --porcelain=v1 -z --untracked-files=all") return processResult({ stdout: " M changed file.md\0" });
      if (key === "symbolic-ref --quiet --short HEAD") return processResult({ stdout: "main\n" });
      if (key === "rev-parse HEAD") return processResult({ stdout: `${SHA}\n` });
      if (key === "rev-parse --abbrev-ref --symbolic-full-name @{upstream}") return processResult({ stdout: "origin/main\n" });
      if (key === "rev-list --left-right --count HEAD...@{upstream}") return processResult({ stdout: "0 0\n" });
      assert.fail(`unexpected Git command: ${key}`);
    }
    const check = qualityModule.selectChecks({ mode: "full" }).find((entry) => entry.executable === executable && JSON.stringify(entry.args) === JSON.stringify(args));
    const id = check?.id ?? qualityModule.selectChecks({ mode: "skill", skill: "alpha" }).find((entry) => entry.executable === executable && JSON.stringify(entry.args) === JSON.stringify(args))?.id;
    if (id === unavailableCheck) return processResult({ exitCode: null, stderr: "not found TOKEN=hidden", unavailable: true });
    if (id === oversizedCheck) return processResult({ exitCode: 0, stdout: "truncated", outputTooLarge: true });
    if (id === failCheck) return processResult({ exitCode: 7, stderr: "failed Bearer hidden-value" });
    return processResult({ stdout: `PASS ${id ?? "check"}\n` });
  };
  return { run, calls };
}

const fixedClock = () => new Date("2026-08-31T07:00:00.000Z");

test("quality gate exposes its public interface", () => {
  assert.equal(typeof qualityModule?.selectChecks, "function");
  assert.equal(typeof qualityModule?.runQualityGate, "function");
  assert.equal(typeof qualityModule?.main, "function");
});

test("quality gate selects a stable quick subset, full superset, and focused skill checks", () => {
  const quick = qualityModule.selectChecks({ mode: "quick" });
  const full = qualityModule.selectChecks({ mode: "full" });
  const skill = qualityModule.selectChecks({ mode: "skill", skill: "alpha" });

  assert.deepEqual(quick.map((entry) => entry.id), [
    "repository-contracts",
    "focused-contracts",
    "static-contracts",
    "documentation-contracts",
    "safety-contracts",
    "installer-contracts",
    "release-contracts"
  ]);
  assert.deepEqual(full.slice(0, quick.length), quick);
  assert.ok(full.some((entry) => entry.id === "full-test-suite"));
  assert.ok(full.some((entry) => entry.id === "native-codex-version" && entry.required === false));
  const antigravity = full.find((entry) => entry.id === "native-antigravity-version");
  assert.ok(antigravity, "the full gate must probe every supported surface binary");
  assert.equal(antigravity.required, false);
  assert.equal(antigravity.executable, "agy", "the Antigravity binary is agy, not the surface name");
  assert.deepEqual(skill.map((entry) => entry.id), ["skill-artifacts", "skill-lint"]);
  assert.ok(skill[0].args.includes("alpha"));
  assert.ok(skill[1].args.includes("tests/lint/skills/alpha.test.mjs"));
  for (const check of [...quick, ...full, ...skill]) {
    assert.equal(typeof check.executable, "string");
    assert.ok(Array.isArray(check.args));
    assert.ok(check.args.every((value) => typeof value === "string"));
  }
});

test("quick gate wires every approved mutation to a failing contract", () => {
  const quick = qualityModule.selectChecks({ mode: "quick" });
  const filesByCheck = new Map(quick.map((entry) => [entry.id, new Set(entry.args.filter((value) => value.endsWith(".test.mjs")))]));
  const mutations = new Map([
    ["remove a required skill artifact", ["focused-contracts", "tests/contracts/skill-validation.test.mjs"]],
    ["switch production rendering to a raw adapter", ["focused-contracts", "tests/contracts/adapter-contract.test.mjs"]],
    ["restore a broad destination root", ["safety-contracts", "tests/contracts/roots.test.mjs"]],
    ["overwrite an unowned neighbor during apply", ["safety-contracts", "tests/contracts/apply.test.mjs"]],
    ["break a documented maintenance command", ["documentation-contracts", "tests/static/maintenance-docs.test.mjs"]],
    ["change AGENTS.md back to symlink mode", ["documentation-contracts", "tests/static/contributor-entrypoints.test.mjs"]],
    ["break all-surface preflight", ["installer-contracts", "tests/integration/cli.test.mjs"]],
    ["weaken release evidence", ["release-contracts", "tests/lint/release-gates.test.mjs"]],
    ["break the claude.ai pack limits", ["focused-contracts", "tests/contracts/claude-ai-pack.test.mjs"]]
  ]);

  for (const [mutation, [checkId, testFile]] of mutations) {
    assert.ok(filesByCheck.get(checkId)?.has(testFile), `${mutation} is not caught by ${checkId}`);
  }
});

test("full mode has no duplicate command and names its broader second-purpose suite", () => {
  const full = qualityModule.selectChecks({ mode: "full" });
  const commands = full.map((entry) => JSON.stringify([entry.executable, ...entry.args]));
  assert.equal(new Set(commands).size, commands.length);
  const broad = full.find((entry) => entry.id === "full-test-suite");
  assert.ok(broad);
  assert.deepEqual(broad.args, ["--test"]);
});

test("quality gate creates a schema-valid deterministic report from structured commands", async () => {
  const fixture = runner();
  const report = await qualityModule.runQualityGate({
    mode: "quick",
    repositoryRoot: process.cwd(),
    run: fixture.run,
    clock: fixedClock
  });

  assert.equal(report.status, "PASS");
  assert.equal(report.repository.branch, "main");
  assert.equal(report.repository.commit, SHA);
  assert.equal(report.mode, "quick");
  assert.equal(report.checks.length, 2 + qualityModule.selectChecks({ mode: "quick" }).length);
  assert.equal(validateSchema({ schema: reportSchema, value: report, sourcePath: "quality-report.json" }).valid, true);
  assert.ok(report.checks.every((entry) => Array.isArray(entry.command)));
  assert.equal(fixture.calls.some((entry) => entry.executable === "git" && ["fetch", "pull", "merge", "rebase", "reset", "push"].some((word) => entry.args.includes(word))), false);

  const again = await qualityModule.runQualityGate({ mode: "quick", repositoryRoot: process.cwd(), run: runner().run, clock: fixedClock });
  assert.deepEqual(again, report);
});

test("quality gate continues after a failed independent required check and redacts evidence", async () => {
  const fixture = runner({ failCheck: "focused-contracts" });
  const report = await qualityModule.runQualityGate({ mode: "quick", repositoryRoot: process.cwd(), run: fixture.run, clock: fixedClock });

  assert.equal(report.status, "FAIL");
  assert.equal(report.checks.find((entry) => entry.id === "focused-contracts").status, "FAIL");
  assert.ok(fixture.calls.some((entry) => entry.args.includes("tests/static/runtime.test.mjs")), "later check must still run");
  assert.doesNotMatch(JSON.stringify(report), /hidden-value/u);
  assert.match(JSON.stringify(report), /\[REDACTED\]/u);
});

test("every quick mutation gate can fail the report without hiding later results", async () => {
  for (const definition of qualityModule.selectChecks({ mode: "quick" })) {
    const fixture = runner({ failCheck: definition.id });
    const report = await qualityModule.runQualityGate({ mode: "quick", repositoryRoot: process.cwd(), run: fixture.run, clock: fixedClock });
    assert.equal(report.status, "FAIL", definition.id);
    assert.equal(report.checks.find((entry) => entry.id === definition.id)?.status, "FAIL", definition.id);
    assert.equal(report.checks.find((entry) => entry.id === "release-contracts")?.status, definition.id === "release-contracts" ? "FAIL" : "PASS", `${definition.id} hid later results`);
  }
});

test("quality gate marks an unavailable optional native check without failing full mode", async () => {
  const fixture = runner({ unavailableCheck: "native-codex-version" });
  const report = await qualityModule.runQualityGate({ mode: "full", repositoryRoot: process.cwd(), run: fixture.run, clock: fixedClock });

  assert.equal(report.status, "PASS");
  const check = report.checks.find((entry) => entry.id === "native-codex-version");
  assert.equal(check.required, false);
  assert.equal(check.status, "NOT_RUN_UNAVAILABLE");
  assert.doesNotMatch(JSON.stringify(check), /TOKEN=hidden/u);
});

test("quality gate fails closed when a process exceeds bounded output capture", async () => {
  const report = await qualityModule.runQualityGate({
    mode: "quick",
    repositoryRoot: process.cwd(),
    run: runner({ oversizedCheck: "focused-contracts" }).run,
    clock: fixedClock
  });
  const check = report.checks.find((entry) => entry.id === "focused-contracts");
  assert.equal(check.status, "FAIL");
  assert.match(check.evidence, /output exceeded|truncated/iu);
  assert.equal(report.status, "FAIL");
});

test("quality gate skill mode validates its argument and fails on a missing artifact check", async () => {
  assert.throws(() => qualityModule.selectChecks({ mode: "skill" }), /skill/iu);
  assert.throws(() => qualityModule.selectChecks({ mode: "other" }), /mode/iu);

  const report = await qualityModule.runQualityGate({
    mode: "skill",
    skill: "alpha",
    repositoryRoot: process.cwd(),
    run: runner({ failCheck: "skill-artifacts" }).run,
    clock: fixedClock
  });
  assert.equal(report.status, "FAIL");
  assert.equal(report.skill, "alpha");
  assert.equal(report.checks.find((entry) => entry.id === "skill-artifacts").status, "FAIL");
});

test("quality gate writes no file by default and writes only an explicit contained report", async (t) => {
  const root = await makeTempRoot("aaa-quality-gate-");
  t.after(() => rm(root, { recursive: true, force: true }));
  const report = await qualityModule.runQualityGate({
    mode: "quick",
    repositoryRoot: root,
    outputPath: "reports/quick.json",
    format: "json",
    run: runner().run,
    clock: fixedClock
  });
  assert.deepEqual(JSON.parse(await readFile(join(root, "reports", "quick.json"), "utf8")), report);
});

test("quality gate CLI returns stable success, failure, and invalid-argument exit codes", async () => {
  const output = [];
  const errors = [];
  const io = { stdout: { write: (value) => output.push(value) }, stderr: { write: (value) => errors.push(value) } };
  assert.equal(await qualityModule.main(["quick", "--format", "json"], io, { repositoryRoot: process.cwd(), run: runner().run, clock: fixedClock }), 0);
  assert.equal(JSON.parse(output.join("")).status, "PASS");
  assert.equal(await qualityModule.main(["skill"], io, { repositoryRoot: process.cwd(), run: runner().run, clock: fixedClock }), 2);
  assert.match(errors.join(""), /skill/iu);
});

test("quality gate keeps the tail of oversized failing output so the failing test name survives", async () => {
  const base = runner({ failCheck: "focused-contracts" });
  const run = async (request) => {
    const result = await base.run(request);
    if (result.exitCode === 7) return processResult({ exitCode: 1, stdout: `${"✔ passing test\n".repeat(700)}✖ the one failing test (12ms)\nℹ fail 1\n` });
    return result;
  };
  const report = await qualityModule.runQualityGate({ mode: "quick", repositoryRoot: process.cwd(), run, clock: fixedClock });
  const check = report.checks.find((entry) => entry.id === "focused-contracts");
  assert.equal(check.status, "FAIL");
  assert.match(check.evidence, /✖ the one failing test/u, "the failure line at the end of the output must survive truncation");
  assert.match(check.evidence, /ℹ fail 1/u);
  assert.match(check.evidence, /evidence truncated/u);
  assert.ok(check.evidence.length <= 8_100, `evidence stays bounded, got ${check.evidence.length}`);
});
