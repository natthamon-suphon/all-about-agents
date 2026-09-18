import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

// Guard for docs/plans/2026-09-18-simplify-to-claude-codex.md invariant I4:
// after phase 1 nothing tracked may reference the removed surfaces, commands,
// workflows, or quarantine, except historical records.
const CUT_PATTERN = /antigravity|(^|[^a-z])agy([^a-z]|$)|aaa:(build|fix|review|audit|design|verify|resume|improve-skill)|workflowId|\.aaa\/state\/workflows|implement-change|quarantine\/legacy/iu;
const HISTORICAL_PREFIXES = ["WhatsNew.md", "docs/evaluations/", "docs/plans/"];
const REMOVED_PATHS = [
  "adapters/antigravity-2",
  "adapters/agy",
  "core/commands",
  "core/workflows",
  "core/roles/router.mjs",
  "core/schemas/command.schema.json",
  "core/schemas/workflow.schema.json",
  "quarantine",
  "installers/manifests/antigravity-2.json",
  "installers/manifests/agy.json",
  "tests/snapshots/antigravity-2",
  "tests/snapshots/agy"
];

const root = process.cwd();

function trackedFiles() {
  const result = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.split("\0").filter((entry) => entry.length > 0);
}

test("removed surfaces, commands, workflows, and quarantine no longer exist", () => {
  const present = REMOVED_PATHS.filter((path) => existsSync(resolve(root, path)));
  assert.deepEqual(present, []);
});

test("the shared adapter contract knows exactly two surfaces", async () => {
  const { SURFACES } = await import("../../adapters/shared/adapter-contract.mjs");
  assert.deepEqual([...SURFACES], ["claude", "codex"]);
});

test("no tracked file references a removed surface, action, workflow, or quarantine path", async () => {
  const offenders = [];
  for (const file of trackedFiles()) {
    if (HISTORICAL_PREFIXES.some((prefix) => file.startsWith(prefix))) continue;
    if (file === "tests/static/surface-scope.test.mjs") continue;
    const content = await readFile(resolve(root, file), "utf8").catch(() => null);
    if (content === null) continue;
    const lines = content.split("\n");
    lines.forEach((line, index) => {
      if (CUT_PATTERN.test(line)) offenders.push(`${file}:${index + 1}`);
    });
  }
  assert.deepEqual(offenders, [], `${offenders.length} references remain:\n${offenders.slice(0, 40).join("\n")}`);
});
