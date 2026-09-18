import assert from "node:assert/strict";
import { access, chmod, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

import { withTempRoot } from "../helpers/temp-root.mjs";
import { main, renderPlans } from "../../scripts/aaa.mjs";
import { preflightOperation } from "../../installers/lib/apply.mjs";

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

test("register CLI fails closed without managed state and rejects all surfaces", async () => {
  await withTempRoot(async (root) => {
    await mkdir(resolve(root, ".codex-plugin"), { recursive: true });
    await mkdir(resolve(root, ".agents", "plugins"), { recursive: true });
    await writeFile(resolve(root, ".codex-plugin", "plugin.json"), "{}\n", "utf8");
    await writeFile(resolve(root, ".agents", "plugins", "marketplace.json"), "{}\n", "utf8");
    const productRoot = resolve(root, "codex-home");
    await mkdir(productRoot, { recursive: true });
    const dry = await capture(["register", "--surface", "codex", "--package-root", root, "--format", "json"], { productRoot });
    assert.equal(dry.code, 1);
    const report = jsonOutput(dry);
    assert.equal(report.error.code, "package-state-missing");
    const all = await capture(["register", "--surface", "all", "--package-root", root, "--format", "json"]);
    assert.equal(all.code, 2);
    assert.equal(jsonOutput(all).error.code, "invalid-registration-surface");
  });
});

test("register binds real single-surface and namespaced multi-surface packages to managed state", async () => {
  await withTempRoot(async (root) => {
    const singlePackage = resolve(root, "single-claude");
    const singleInstall = await capture(["install", "--surface", "claude", "--profile", "template", "--statusline-name", "State binding", "--destination-root", singlePackage, "--apply", "--format", "json"]);
    assert.equal(singleInstall.code, 0, singleInstall.stderr);
    const productRoot = resolve(root, "product");
    await mkdir(productRoot, { recursive: true });
    const singleRegister = await capture(["register", "--surface", "claude", "--profile", "template", "--package-root", singlePackage, "--format", "json"], { productRoot });
    assert.equal(singleRegister.code, 0, singleRegister.stderr);
    assert.equal(jsonOutput(singleRegister).mode, "dry-run");
    assert.equal(jsonOutput(singleRegister).status, "dry-run");

    const aggregateRoot = resolve(root, "aggregate");
    const aggregateInstall = await capture(["install", "--surface", "all", "--profile", "template", "--statusline-name", "State binding", "--destination-root", aggregateRoot, "--apply", "--format", "json"]);
    assert.equal(aggregateInstall.code, 0, aggregateInstall.stderr);
    for (const surface of ["claude", "codex"]) {
      const result = await capture(["register", "--surface", surface, "--profile", "template", "--package-root", resolve(aggregateRoot, surface), "--format", "json"], { productRoot });
      assert.equal(result.code, 0, `${surface}: ${result.stderr}`);
      const report = jsonOutput(result);
      assert.equal(report.status, "dry-run");
    }
  });
});

async function capture(args, runtime) {
  let stdout = "";
  let stderr = "";
  const code = await main(args, { write: (value) => { stdout += value; } }, { write: (value) => { stderr += value; } }, runtime);
  return { code, stdout, stderr };
}

function jsonOutput(result) {
  assert.equal(result.stderr, "", result.stderr);
  return JSON.parse(result.stdout);
}

test("interactive install prompts once for the omitted Claude statusline name", async () => {
  await withTempRoot(async (root) => {
    let promptCount = 0;
    const labels = [];
    const result = await capture(["install", "--surface", "claude", "--destination-root", root, "--apply", "--format", "json"], {
      interactive: true,
      prompt: async (label) => {
        promptCount += 1;
        labels.push(label);
        return "T048 interactive";
      }
    });
    assert.equal(result.code, 0);
    assert.equal(promptCount, 1);
    assert.deepEqual(labels, ["Statusline display name"]);
    const statusline = JSON.parse(await readFile(resolve(root, "all-about-agents", "statusline.json"), "utf8"));
    assert.equal(statusline.displayName, "T048 interactive");
  });
});

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

test("relative destination roots resolve from the repository working directory", async () => {
  const relativePath = `tests/.tmp/t048-relative-${randomUUID()}`;
  const expectedRoot = resolve(process.cwd(), relativePath);
  try {
    const result = await capture(["install", "--surface", "claude", "--destination-root", relativePath, "--format", "json"]);
    assert.equal(result.code, 0);
    const report = jsonOutput(result);
    assert.equal(report.plans[0].root, expectedRoot);
  } finally {
    await rm(expectedRoot, { recursive: true, force: true });
  }
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

test("validate all reports both profiles and all public adapter surfaces", async () => {
  const result = await capture(["validate", "--scope", "all", "--format", "json"]);
  assert.equal(result.code, 0, result.stderr);
  const report = jsonOutput(result);
  assert.deepEqual(report.profiles, ["portable", "template"]);
  assert.deepEqual(report.surfaces, ["claude", "codex"]);
  assert.equal(report.status, "pass");
});

test("two-surface production plans preflight completely before any write", async () => {
  await withTempRoot(async (root) => {
    const previousClaude = process.env.CLAUDE_CONFIG_DIR;
    const previousCodex = process.env.CODEX_HOME;
    process.env.CLAUDE_CONFIG_DIR = resolve(root, "claude");
    process.env.CODEX_HOME = resolve(root, "codex");
    try {
      const entries = await renderPlans({
        action: "install",
        mode: "apply",
        profile: "portable",
        surfaces: ["claude", "codex"],
        destinationRoot: null,
        statuslineName: "",
        format: "json"
      }, process.cwd());
      assert.equal(entries.length, 2);
      const invalid = entries[1].plan.actions.find((action) => ["create", "replace", "unchanged"].includes(action.kind));
      assert.ok(invalid);
      entries[1].contents.delete(invalid.relativePath);
      let writes = 0;
      const fileSystemByRoot = new Map(entries.map((entry) => [entry.root, {
        contents: entry.contents,
        repositoryVersion: "integration-test",
        profile: "portable",
        surfaces: entry.selectedSurfaces,
        previousState: entry.previousState,
        writeFile: async (...args) => { writes += 1; return writeFile(...args); }
      }]));
      const result = await preflightOperation({ entries, fileSystemByRoot });
      assert.equal(result.valid, false);
      assert.deepEqual(result.prepared, []);
      assert.equal(result.errors[0].surface, "codex");
      assert.equal(writes, 0);
      assert.equal(await access(resolve(root, "claude")).then(() => true, () => false), false);
      assert.equal(await access(resolve(root, "codex")).then(() => true, () => false), false);
    } finally {
      if (previousClaude === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = previousClaude;
      if (previousCodex === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodex;
    }
  });
});

test("all-surface atomic preflight attributes a late namespaced failure without writing", async () => {
  await withTempRoot(async (root) => {
    const entries = await renderPlans({
      action: "install",
      mode: "apply",
      profile: "portable",
      surfaces: ["claude", "codex"],
      destinationRoot: root,
      statuslineName: "preflight",
      format: "json"
    }, process.cwd());
    assert.equal(entries.length, 1, "an explicit shared root must use one atomic namespaced plan");
    const [entry] = entries;
    const invalid = [...entry.plan.actions].reverse().find((action) => action.relativePath.startsWith("codex/") && ["create", "replace", "unchanged"].includes(action.kind));
    assert.ok(invalid);
    entry.contents.delete(invalid.relativePath);
    let writes = 0;
    const fileSystemByRoot = new Map([[entry.root, {
      contents: entry.contents,
      repositoryVersion: "integration-test",
      profile: "portable",
      surfaces: entry.selectedSurfaces,
      previousState: entry.previousState,
      writeFile: async (...args) => { writes += 1; return writeFile(...args); }
    }]]);
    const result = await preflightOperation({ entries, fileSystemByRoot });
    assert.equal(result.valid, false);
    assert.deepEqual(result.prepared, []);
    assert.equal(result.errors[0].surface, "codex");
    assert.equal(result.errors[0].relativePath, invalid.relativePath);
    assert.equal(writes, 0);
    for (const surface of entry.selectedSurfaces) {
      assert.equal(await access(resolve(root, surface)).then(() => true, () => false), false, `${surface} must remain unwritten`);
    }
  });
});

test("diff redacts quoted JSON secret fields from disposable managed files", async () => {
  await withTempRoot(async (root) => {
    const applied = await capture(["install", "--surface", "claude", "--destination-root", root, "--apply", "--format", "json"]);
    assert.equal(applied.code, 0);
    await writeFile(resolve(root, "settings.json"), '{"token":"should-not-appear"}\n', "utf8");
    const result = await capture(["diff", "--surface", "claude", "--destination-root", root, "--format", "json"]);
    assert.equal(result.code, 0);
    assert.doesNotMatch(result.stdout, /should-not-appear/u);
    assert.match(result.stdout, /\[REDACTED\]/u);
  });
});

test("diff never exposes bytes from a replaced existing file", async () => {
  await withTempRoot(async (root) => {
    const applied = await capture(["install", "--surface", "claude", "--destination-root", root, "--apply", "--format", "json"]);
    assert.equal(applied.code, 0);
    const cases = [
      "Authorization: Basic dXNlcjpzZWNyZXQ=\n",
      "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\nAWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY\n",
      "Set-Cookie: aaa-session=do-not-print; HttpOnly\n",
      "session=opaque-session-value\n",
      "password=first-line-secret\nsecond-line-secret\n",
      "utf8-secret=пароль-秘密-🔒\n",
      "-----BEGIN PRIVATE KEY-----\nprivate-key-body\n-----END PRIVATE KEY-----\n"
    ];
    for (const body of cases) {
      await writeFile(resolve(root, "settings.json"), body, "utf8");
      const result = await capture(["diff", "--surface", "claude", "--destination-root", root, "--format", "json"]);
      assert.equal(result.code, 0);
      assert.doesNotMatch(result.stdout, new RegExp(body.trim().replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
      assert.match(result.stdout, /sha256=[0-9a-f]{64}|bytes=\d+/u);
    }
    await writeFile(resolve(root, "settings.json"), Uint8Array.from([0, 255, 10, 13, 65, 66, 67]), "binary");
    const binary = await capture(["diff", "--surface", "claude", "--destination-root", root, "--format", "json"]);
    assert.equal(binary.code, 0);
    assert.doesNotMatch(binary.stdout, /private-key|opaque-session|AWS_SECRET|Basic/iu);
    assert.match(binary.stdout, /sha256=[0-9a-f]{64}|bytes=\d+/u);
  });
});

test("diff reports a mode-only executable repair without exposing file content", async (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX executable bits are not meaningful on Windows");
    return;
  }
  await withTempRoot(async (root) => {
    const applied = await capture(["install", "--surface", "claude", "--destination-root", root, "--apply", "--format", "json"]);
    assert.equal(applied.code, 0);
    const target = resolve(root, "hooks", "bootstrap.mjs");
    await chmod(target, 0o644);
    const json = await capture(["diff", "--surface", "claude", "--destination-root", root, "--format", "json"]);
    assert.equal(json.code, 0);
    const report = jsonOutput(json);
    const change = report.changes.find((entry) => entry.relativePath === "hooks/bootstrap.mjs");
    assert.deepEqual({ oldMode: change.oldMode, newMode: change.newMode }, { oldMode: 0o644, newMode: 0o755 });
    assert.equal(change.diff, "");
    assert.doesNotMatch(JSON.stringify(change), /export function|readBoundedStdin|secret|token/iu);

    const text = await capture(["diff", "--surface", "claude", "--destination-root", root]);
    assert.equal(text.code, 0);
    assert.match(text.stdout, /old mode 100644\nnew mode 100755/u);
    assert.doesNotMatch(text.stdout, /export function|readBoundedStdin|secret|token/iu);
  });
});

test("PowerShell launcher preserves normalized output and exit-code parity", async () => {
  const result = spawnSync("pwsh", ["-NoProfile", "-File", resolve(process.cwd(), "installers", "install.ps1"), "doctor", "--surface", "claude", "--destination-root", resolve(process.cwd(), "tests", ".tmp", "launcher-doctor"), "--format", "json"], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.action, "doctor");
  assert.equal(report.status, "not run");
});
