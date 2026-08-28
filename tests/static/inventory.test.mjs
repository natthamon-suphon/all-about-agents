import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { validateSchema } from "../../installers/lib/validate-schema.mjs";

const requiredOutputs = [
  "core/inventory.json",
  "core/schemas/inventory.schema.json",
  "adapters/claude/capabilities.json",
  "adapters/codex/capabilities.json",
  "adapters/antigravity-2/capabilities.json",
  "adapters/agy/capabilities.json",
  "core/schemas/capability.schema.json",
  "tests/static/inventory.test.mjs",
  "tests/static/capabilities.test.mjs",
  "scripts/aaa.mjs",
  "installers/lib/validate-schema.mjs",
  "core/evals/runner.mjs",
  "core/evals/result-envelope.schema.json",
  "tests/static/eval-runner.test.mjs"
];

test("T002 creates every owned artifact", async () => {
  assert.ok(requiredOutputs.length > 0);
  for (const relativePath of requiredOutputs) {
    await access(resolve(process.cwd(), relativePath));
  }
});

test("inventory records exactly the current public skill names", async () => {
  const inventory = JSON.parse(await readFile(resolve(process.cwd(), "core/inventory.json"), "utf8"));
  assert.equal(inventory.skills.length, 28);
  assert.deepEqual(inventory.skills, [
    "brainstorming",
    "codebase-design",
    "dispatching-parallel-agents",
    "executing-plans",
    "finishing-a-development-branch",
    "handoff",
    "improve-codebase-architecture",
    "interviewing",
    "loop-me",
    "nano-image-generator",
    "performance-profiling-and-benchmarking",
    "receiving-code-review",
    "requesting-code-review",
    "research",
    "resolving-merge-conflicts",
    "session-compaction-resilience",
    "subagent-driven-development",
    "systematic-debugging",
    "test-driven-development",
    "threat-modeling-and-security",
    "using-all-about-agents",
    "using-git-worktrees",
    "verification-before-completion",
    "wait-what",
    "wayfinder",
    "writing-plans",
    "writing-skills",
    "zero-downtime-migrations"
  ]);
});

test("inventory validates against its strict schema and accounts for existing sources", async () => {
  const inventoryPath = resolve(process.cwd(), "core/inventory.json");
  const schema = JSON.parse(await readFile(resolve(process.cwd(), "core/schemas/inventory.schema.json"), "utf8"));
  const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
  const result = validateSchema({ schema, value: inventory, sourcePath: "core/inventory.json" });
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  const paths = new Set(inventory.sourceFiles.map((entry) => entry.path));
  for (const entry of inventory.skillSources) {
    assert.ok(paths.has(entry.source), `skill source missing from inventory: ${entry.source}`);
    for (const asset of [...entry.assets, ...entry.scripts]) assert.ok(paths.has(asset), `skill asset missing from inventory: ${asset}`);
  }
});
