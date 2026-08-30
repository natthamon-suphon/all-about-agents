import assert from "node:assert/strict";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { main } from "../../scripts/aaa.mjs";
import { withTempRoot } from "../helpers/temp-root.mjs";

const SURFACES = ["claude", "codex", "antigravity-2", "agy"];
const NAMESPACES = new Set(SURFACES.map((surface) => `${surface}/`));

async function runCli(args) {
  let stdout = "";
  let stderr = "";
  const output = { write(value) { stdout += String(value); } };
  const errorOutput = { write(value) { stderr += String(value); } };
  const code = await main(args, output, errorOutput);
  return { code, stderr, report: JSON.parse(stdout) };
}

async function snapshotTree(root) {
  const files = {};

  async function visit(directory, prefix = "") {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return;
      throw error;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const target = join(directory, entry.name);
      if (entry.isDirectory()) await visit(target, relativePath);
      else if (entry.isFile()) files[relativePath] = (await readFile(target)).toString("base64");
      else throw new Error(`unexpected non-regular entry in fixture root: ${relativePath}`);
    }
  }

  await visit(root);
  return files;
}

function generatedPaths(report) {
  return report.plans.flatMap((plan) => plan.actions
    .filter((action) => ["create", "replace", "unchanged"].includes(action.kind))
    .map((action) => action.relativePath));
}

function assertNamespaced(paths) {
  assert.ok(paths.length > 0, "all-surface render should produce files");
  assert.equal(new Set(paths).size, paths.length, "surface namespaces must not collide");
  for (const relativePath of paths) {
    assert.ok([...NAMESPACES].some((prefix) => relativePath.startsWith(prefix)), `path is not namespaced: ${relativePath}`);
    assert.ok(!relativePath.includes("\\"), `path uses a native separator: ${relativePath}`);
    assert.ok(!relativePath.split("/").includes(".."), `path contains traversal: ${relativePath}`);
  }
}

test("explicit all-surface dry-run is deterministic and collision-free", async () => {
  await withTempRoot(async (root) => {
    const args = ["install", "--surface", "all", "--destination-root", root, "--format", "json"];
    const first = await runCli(args);
    const second = await runCli(args);

    assert.equal(first.code, 0, first.stderr);
    assert.equal(second.code, 0, second.stderr);
    assert.equal(first.report.status, "dry-run");
    assert.deepEqual(second.report, first.report, "repeated dry-runs must serialize identically");
    assert.deepEqual(first.report.surfaces, SURFACES);
    assert.equal(first.report.plans.length, 1, "shared explicit roots use one aggregate plan");
    assert.equal(first.report.plans[0].root, root);
    assertNamespaced(generatedPaths(first.report));
    assert.deepEqual(await snapshotTree(root), {}, "dry-run must not mutate its disposable root");
  });
});

test("explicit all-surface apply is namespaced and idempotent", async () => {
  await withTempRoot(async (root) => {
    const args = ["install", "--surface", "all", "--destination-root", root, "--apply", "--format", "json"];
    const first = await runCli(args);
    assert.equal(first.code, 0, first.stderr);
    assert.equal(first.report.status, "complete");
    assert.deepEqual(first.report.surfaces, SURFACES);
    assertNamespaced(generatedPaths(first.report));

    const afterFirst = await snapshotTree(root);
    const installed = Object.keys(afterFirst).filter((relativePath) => relativePath !== ".all-about-agents/state.json");
    assertNamespaced(installed);
    assert.ok(afterFirst[".all-about-agents/state.json"], "aggregate ownership state must be written");
    const state = JSON.parse(Buffer.from(afterFirst[".all-about-agents/state.json"], "base64").toString("utf8"));
    assert.deepEqual(new Set(state.surfaces), new Set(SURFACES));
    assert.deepEqual(new Set(state.ownedPaths.map((entry) => entry.relativePath)), new Set(installed));

    const second = await runCli(args);
    assert.equal(second.code, 0, second.stderr);
    assert.equal(second.report.status, "complete");
    assert.ok(second.report.plans[0].actions.every((action) => action.kind === "unchanged"), "idempotent apply must not replace files");
    assert.deepEqual(await snapshotTree(root), afterFirst, "idempotent apply must preserve bytes and ownership metadata");
  });
});

test("single-surface refresh preserves every other surface in a shared managed root", async () => {
  await withTempRoot(async (root) => {
    const aggregate = await runCli(["install", "--surface", "all", "--destination-root", root, "--apply", "--format", "json"]);
    assert.equal(aggregate.code, 0, aggregate.stderr);
    const before = await snapshotTree(root);

    const refresh = await runCli(["install", "--surface", "claude", "--destination-root", root, "--apply", "--format", "json"]);
    assert.equal(refresh.code, 0, refresh.stderr);
    assert.equal(refresh.report.status, "complete");
    assert.ok(refresh.report.plans[0].actions.every((action) => !action.relativePath.startsWith("codex/") && !action.relativePath.startsWith("agy/") && !action.relativePath.startsWith("antigravity-2/")), "single-surface plan must not mutate another surface namespace");

    const after = await snapshotTree(root);
    for (const prefix of ["codex/", "agy/", "antigravity-2/"]) {
      for (const [relativePath, content] of Object.entries(before)) {
        if (relativePath.startsWith(prefix)) assert.equal(after[relativePath], content, `${relativePath} must be preserved byte-for-byte`);
      }
    }
    assert.ok(Object.keys(after).some((relativePath) => relativePath.startsWith("claude/")), "Claude must remain in its shared-root namespace");
    assert.equal(after["settings.json"], undefined, "shared-root refresh must not create an unnamespaced native collision");
    const state = JSON.parse(Buffer.from(after[".all-about-agents/state.json"], "base64").toString("utf8"));
    assert.deepEqual(new Set(state.surfaces), new Set(SURFACES));
    assert.deepEqual(new Set(state.ownedPaths.map((entry) => entry.relativePath)), new Set(Object.keys(after).filter((relativePath) => relativePath !== ".all-about-agents/state.json")));
  });
});

test("automatic all-surface apply fails before mutating discovered roots", async () => {
  await withTempRoot(async (root) => {
    const claudeRoot = join(root, "claude");
    const codexRoot = join(root, "codex");
    const previousClaude = process.env.CLAUDE_CONFIG_DIR;
    const previousCodex = process.env.CODEX_HOME;
    process.env.CLAUDE_CONFIG_DIR = claudeRoot;
    process.env.CODEX_HOME = codexRoot;
    try {
      const result = await runCli(["install", "--surface", "all", "--apply", "--format", "json"]);
      assert.equal(result.code, 1);
      assert.ok(["fail", "failed"].includes(result.report.status));
      assert.match(JSON.stringify(result.report.error), /manual\/discovery|explicit destination|root/i);
      assert.deepEqual(await snapshotTree(claudeRoot), {});
      assert.deepEqual(await snapshotTree(codexRoot), {});
      assert.equal((await snapshotTree(root))[".all-about-agents/state.json"], undefined);
    } finally {
      if (previousClaude === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = previousClaude;
      if (previousCodex === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodex;
    }
  });
});
