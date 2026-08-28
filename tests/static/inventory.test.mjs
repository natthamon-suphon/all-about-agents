import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { validateSchema } from "../../installers/lib/validate-schema.mjs";

const execFileAsync = promisify(execFile);

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

const expectedBaselineFiles = new Map([
  ["skills/test-driven-development/writing-good-tests.md", { kind: "asset", status: "stable" }],
  ["skills/zero-downtime-migrations/postgres-contracts-examples.md", { kind: "asset", status: "stable" }],
  ["agents/codebase-architect.json", { kind: "config", status: "manual" }],
  ["agents/codebase-architect.md", { kind: "source", status: "manual" }],
  ["agents/deep-investigator.json", { kind: "config", status: "manual" }],
  ["agents/deep-investigator.md", { kind: "source", status: "manual" }],
  ["agents/generalist.json", { kind: "config", status: "manual" }],
  ["agents/generalist.md", { kind: "source", status: "manual" }],
  ["agents/implementer.json", { kind: "config", status: "manual" }],
  ["agents/implementer.md", { kind: "source", status: "manual" }],
  ["agents/security-auditor.json", { kind: "config", status: "manual" }],
  ["agents/security-auditor.md", { kind: "source", status: "manual" }],
  ["agents/task-reviewer.json", { kind: "config", status: "manual" }],
  ["agents/task-reviewer.md", { kind: "source", status: "manual" }],
  ["hooks/hooks.json", { kind: "config", status: "stable" }],
  ["hooks/antigravity-hooks.json", { kind: "config", status: "stable" }],
  ["hooks/antigravity-session-start.js", { kind: "script", status: "stable" }],
  ["hooks/antigravity-track-tool.js", { kind: "script", status: "stable" }],
  ["hooks/session-start", { kind: "metadata", status: "stable" }],
  ["hooks/run-hook.cmd", { kind: "script", status: "stable" }],
  ["configs/CLAUDE.local.md", { kind: "source", status: "manual" }],
  ["configs/GEMINI.local.md", { kind: "source", status: "manual" }],
  ["configs/settings.local.json", { kind: "config", status: "manual" }],
  [".claude-plugin/plugin.json", { kind: "config", status: "stable" }],
  [".claude-plugin/marketplace.json", { kind: "config", status: "stable" }],
  ["statusline/statusline.js", { kind: "script", status: "manual" }],
  ["statusline/track-tool.js", { kind: "script", status: "manual" }],
  ["setup/setup-antigravity.ps1", { kind: "script", status: "manual" }],
  ["setup/setup-antigravity.sh", { kind: "script", status: "manual" }],
  ["setup/setup-guide-antigravity.md", { kind: "source", status: "manual" }]
]);

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

test("inventory preserves the immutable baseline path and category contract", async () => {
  const inventory = JSON.parse(await readFile(resolve(process.cwd(), "core/inventory.json"), "utf8"));
  assert.equal(inventory.sourceFiles.length, 124);
  const sourceFiles = new Map(inventory.sourceFiles.map((entry) => [entry.path, entry]));
  for (const [path, expected] of expectedBaselineFiles) {
    const entry = sourceFiles.get(path);
    assert.ok(entry, `baseline source missing: ${path}`);
    assert.equal(entry.kind, expected.kind, `baseline category changed: ${path}`);
    assert.equal(entry.auditDisposition.status, expected.status, `baseline disposition changed: ${path}`);
  }
  assert.deepEqual(inventory.legacyRoles.map((role) => role.name), [
    "codebase-architect",
    "deep-investigator",
    "generalist",
    "implementer",
    "security-auditor",
    "task-reviewer"
  ]);
  assert.deepEqual(inventory.hooks.map((hook) => hook.path), [
    "hooks/hooks.json",
    "hooks/antigravity-hooks.json",
    "hooks/antigravity-session-start.js",
    "hooks/antigravity-track-tool.js",
    "hooks/session-start",
    "hooks/run-hook.cmd"
  ]);
  assert.deepEqual(inventory.configs.map((config) => config.path), [
    ".claude-plugin/plugin.json",
    ".claude-plugin/marketplace.json",
    "configs/CLAUDE.local.md",
    "configs/GEMINI.local.md",
    "configs/settings.local.json"
  ]);
  assert.deepEqual(inventory.statusline.map((entry) => entry.path), ["statusline/statusline.js", "statusline/track-tool.js"]);
  assert.deepEqual(inventory.setupScripts.map((entry) => entry.path), [
    "setup/setup-antigravity.ps1",
    "setup/setup-antigravity.sh",
    "setup/setup-guide-antigravity.md"
  ]);
});

test("gitignore keeps the root eval harness ignored without hiding core eval artifacts", async () => {
  async function isIgnored(relativePath) {
    try {
      await execFileAsync("git", ["check-ignore", "--no-index", "--quiet", "--", relativePath], { cwd: process.cwd() });
      return true;
    } catch (error) {
      if (error?.code === 1) return false;
      throw error;
    }
  }

  assert.equal(await isIgnored("evals/future-record.jsonl"), true);
  assert.equal(await isIgnored("core/evals/future-record.jsonl"), false);
});
