import assert from "node:assert/strict";
import { access, readFile, writeFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

import { withTempRoot } from "../helpers/temp-root.mjs";
import { main, renderPlans } from "../../scripts/aaa.mjs";

const requiredOutputs = [
  "installers/install.ps1",
  "installers/install.sh",
  "scripts/aaa.mjs",
  "installers/lib/doctor.mjs",
  "installers/lib/report.mjs",
  "tests/integration/cli.test.mjs",
  "tests/integration/launchers.test.mjs"
];

test("T048 creates every owned artifact", async () => {
  assert.ok(requiredOutputs.length > 0);
  for (const relativePath of requiredOutputs) {
    await access(resolve(process.cwd(), relativePath));
  }
});

test("doctor returns the exact independent check contract", async () => {
  const { diagnose } = await import("../../installers/lib/doctor.mjs");
  const result = await diagnose({
    surfaces: ["claude"],
    profile: "portable",
    destinationRoot: resolve(process.cwd(), "tests", ".tmp", "doctor"),
    runtimes: { node: process.versions.node }
  });
  assert.ok(["pass", "fail", "not run"].includes(result.status));
  assert.ok(Array.isArray(result.checks));
  for (const check of result.checks) {
    assert.deepEqual(Object.keys(check).sort(), ["evidence", "id", "status", "surface"]);
    assert.ok(["pass", "fail", "not run"].includes(check.status));
  }
});

async function capture(args) {
  let stdout = "";
  let stderr = "";
  const code = await main(args, { write: (value) => { stdout += value; } }, { write: (value) => { stderr += value; } });
  return { code, stdout, stderr };
}

function jsonOutput(result) {
  assert.equal(result.stderr, "", result.stderr);
  return JSON.parse(result.stdout);
}

test("no-root rendering passes the resolved environment root to the adapter", async () => {
  await withTempRoot(async (root) => {
    const previous = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = root;
    try {
      const [entry] = await renderPlans({
        surfaces: ["claude"],
        profile: "portable",
        statuslineName: "",
        destinationRoot: null
      }, process.cwd());
      const resolvedRoot = entry.payload.registrations.find((registration) => registration.kind === "resolved-config-root");
      assert.equal(resolvedRoot.path, root);
    } finally {
      if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = previous;
    }
  });
});

test("CLI action matrix emits normalized JSON and stable exit codes in disposable roots", async () => {
  await withTempRoot(async (root) => {
    const input = resolve(root, "input.jsonl");
    const envelope = (sampleId) => JSON.stringify({ schemaVersion: 1, sampleId, caseId: "t048", variant: "candidate", output: "redacted", scores: { correctness: 1 }, metadata: { source: "fixture" } });
    await writeFile(input, `${Array.from({ length: 5 }, (_, index) => envelope(`sample-${index + 1}`)).join("\n")}\n`, "utf8");
    const outputDir = resolve(root, "eval-runs", randomUUID());
    const cases = [
      { name: "dry-run", args: ["install", "--surface", "claude", "--destination-root", root, "--format", "json"], code: 0, status: "dry-run" },
      { name: "apply", args: ["install", "--surface", "claude", "--destination-root", root, "--apply", "--format", "json"], code: 0, status: "complete" },
      { name: "diff", args: ["diff", "--surface", "claude", "--destination-root", root, "--format", "json"], code: 0, status: "pass" },
      { name: "doctor", args: ["doctor", "--surface", "claude", "--destination-root", root, "--format", "json"], code: 1, status: "not run" },
      { name: "validate", args: ["validate", "--format", "json"], code: 0, status: "pass" },
      { name: "validate-all", args: ["validate", "--scope", "all", "--format", "json"], code: 0, status: "pass" },
      { name: "eval", args: ["eval", "--skill", "brainstorming", "--variant", "candidate", "--samples", "5", "--input-jsonl", input, "--output", outputDir, "--format", "json"], code: 0, status: undefined },
      { name: "invalid", args: ["install", "--unknown", "--format", "json"], code: 2, status: "fail" }
    ];
    for (const item of cases) {
      const result = await capture(item.args);
      assert.equal(result.code, item.code, item.name);
      const report = jsonOutput(result);
      if (item.status !== undefined) assert.equal(report.status, item.status, item.name);
      if (item.name === "eval") assert.equal(report.results.length, 5);
    }
    const state = JSON.parse(await readFile(resolve(root, ".all-about-agents", "state.json"), "utf8"));
    assert.deepEqual(state.surfaces, ["claude"]);
    assert.ok(state.ownedPaths.length > 0);
  });
});

test("all-surface automatic discovery fails closed before mutation", async () => {
  const result = await capture(["install", "--surface", "all", "--apply", "--format", "json"]);
  assert.equal(result.code, 1);
  const report = jsonOutput(result);
  assert.equal(report.status, "fail");
  assert.match(report.error.message, /manual|root|discovery/iu);
});

test("diff redacts quoted JSON secret fields from disposable managed files", async () => {
  await withTempRoot(async (root) => {
    const applied = await capture(["install", "--surface", "claude", "--destination-root", root, "--apply", "--format", "json"]);
    assert.equal(applied.code, 0);
    await writeFile(resolve(root, "config", "settings.json"), '{"token":"should-not-appear"}\n', "utf8");
    const result = await capture(["diff", "--surface", "claude", "--destination-root", root, "--format", "json"]);
    assert.equal(result.code, 0);
    assert.doesNotMatch(result.stdout, /should-not-appear/u);
    assert.match(result.stdout, /\[REDACTED\]/u);
  });
});

test("PowerShell launcher preserves normalized output and exit-code parity", async () => {
  const result = spawnSync("pwsh", ["-NoProfile", "-File", resolve(process.cwd(), "installers", "install.ps1"), "doctor", "--surface", "claude", "--destination-root", resolve(process.cwd(), "tests", ".tmp", "launcher-doctor"), "--format", "json"], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.action, "doctor");
  assert.equal(report.status, "not run");
});
