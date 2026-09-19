import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { checkPreconditions, evaluateCase, redact, runSuite } from "../model/run-trigger-suite.mjs";

const root = process.cwd();

test("trigger suite exists, is manual, and stays out of the quality gates", async () => {
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  assert.equal(pkg.scripts["test:model"], "node tests/model/run-trigger-suite.mjs");
  const gate = readFileSync(resolve(root, "scripts/quality-gate.mjs"), "utf8");
  assert.doesNotMatch(gate, /run-trigger-suite/u, "the model suite must never run inside quality:quick or quality:full");
  const suite = JSON.parse(readFileSync(resolve(root, "tests/model/suite.json"), "utf8"));
  assert.ok(suite.skills.length >= 4);
  for (const skill of suite.skills) JSON.parse(readFileSync(resolve(root, "core/evals/skill-routing", `${skill}.json`), "utf8"));
});

test("case evaluation reads the announce format and the case kind", () => {
  const announce = "Using skill **brainstorming 🧠** — the request changes behavior.\n\nWhat problem should the feature solve?";
  assert.equal(evaluateCase({ skill: "brainstorming", caseSpec: { id: "BR-TRIGGER-feature-design" }, resultText: announce }).status, "PASS");
  assert.equal(evaluateCase({ skill: "brainstorming", caseSpec: { id: "BR-TRIGGER-feature-design" }, resultText: "Sure, here is the code." }).status, "FAIL");
  assert.equal(evaluateCase({ skill: "brainstorming", caseSpec: { id: "BR-NONTRIGGER-trivial-readonly" }, resultText: "The file has 12 lines." }).status, "PASS");
  assert.equal(evaluateCase({ skill: "brainstorming", caseSpec: { id: "BR-NONTRIGGER-trivial-readonly" }, resultText: announce }).status, "FAIL");
  const pressure = { skill: "brainstorming", caseSpec: { id: "BR-PRESSURE-code-immediately" }, forbiddenPressurePhrases: ["I have implemented"] };
  assert.equal(evaluateCase({ ...pressure, resultText: `${announce}\nI have implemented it anyway.` }).status, "FAIL");
  assert.equal(evaluateCase({ ...pressure, resultText: announce }).status, "PASS");
  assert.equal(evaluateCase({ skill: "brainstorming", caseSpec: { id: "BR-OTHER" }, resultText: announce }).status, "FAIL");
});

test("redaction removes home paths and email addresses from stored excerpts", () => {
  const home = process.platform === "win32" ? "C:\\Users\\tester" : "/Users/tester";
  const out = redact(`see ${home}\\notes.md and /home/alice/x.txt, mail alice@example.com`, home);
  assert.doesNotMatch(out, /tester|alice@example\.com|\/home\/alice/u);
  assert.match(out, /<HOME>|<USER_PATH>/u);
  assert.match(out, /<EMAIL>/u);
});

test("stale or missing installations make every case NOT_RUN_UNAVAILABLE without spawning claude", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "aaa-model-suite-"));
  try {
    const outputDir = join(sandbox, "eval-runs");
    mkdirSync(outputDir, { recursive: true });
    let spawnCalls = 0;
    const spawn = () => { spawnCalls += 1; return { status: 0, stdout: "", stderr: "" }; };
    const preconditions = () => ({ ok: false, reasons: ["installed package stale: plugin 1.0.0, package.json 2.0.0"], packageVersion: "2.0.0", configDir: sandbox });
    const { summary, batch } = await runSuite({ spawn, preconditions, outputDir });
    assert.equal(spawnCalls, 0, "no claude session may start when preconditions fail");
    assert.equal(summary.notRun, summary.total);
    assert.equal(summary.fail, 0);
    assert.ok(batch.results.every((entry) => entry.metadata.status === "NOT_RUN_UNAVAILABLE" && /stale/u.test(entry.metadata.reason)));
    assert.ok(readdirSync(outputDir).length > 0, "the run must still leave a result file");
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("a fake claude executable drives PASS and FAIL classification per case", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "aaa-model-suite-"));
  try {
    const outputDir = join(sandbox, "eval-runs");
    mkdirSync(outputDir, { recursive: true });
    const suitePath = join(sandbox, "suite.json");
    writeFileSync(suitePath, JSON.stringify({ schemaVersion: 1, skills: ["brainstorming"], forbiddenPressurePhrases: ["I have implemented"] }), "utf8");
    const spawn = (executable, args) => {
      if (executable === "git") return { status: 0, stdout: "", stderr: "" };
      const prompt = args[1];
      const announced = /trivial|read-only|bounded read-only|status or file listing/iu.test(prompt) ? "The listing is short." : "Using skill **brainstorming 🧠** — a behavior change needs a design first.";
      return { status: 0, stdout: JSON.stringify({ result: announced }), stderr: "" };
    };
    const preconditions = () => ({ ok: true, reasons: [], packageVersion: "2.0.0", configDir: sandbox });
    const { summary } = await runSuite({ spawn, preconditions, suitePath, outputDir });
    assert.equal(summary.notRun, 0);
    assert.equal(summary.fail, 0, "every brainstorming routing case should pass against the fake announcer");
    assert.equal(summary.pass, summary.total);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("preconditions report a missing claude executable as a reason", () => {
  const spawn = () => ({ error: new Error("ENOENT"), status: null, stdout: "", stderr: "" });
  const result = checkPreconditions({ spawn, home: mkdtempSync(join(tmpdir(), "aaa-no-claude-")), env: {} });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((reason) => /claude executable is unavailable/u.test(reason)));
});
