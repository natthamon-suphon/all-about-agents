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
  "core/instructions/global-operating-rules.md",
  "core/presentation/emoji-registry.json",
  "core/presentation/progress-contract.json",
  "core/schemas/presentation.schema.json",
  "core/schemas/inventory.schema.json",
  "adapters/claude/capabilities.json",
  "adapters/codex/capabilities.json",
  "core/schemas/capability.schema.json",
  "tests/static/inventory.test.mjs",
  "tests/static/capabilities.test.mjs",
  "tests/static/presentation-safety.test.mjs",
  "scripts/aaa.mjs",
  "installers/lib/validate-schema.mjs",
  "core/evals/runner.mjs",
  "core/evals/result-envelope.schema.json",
  "core/evals/presentation-trace.mjs",
  "core/evals/presentation-trace.schema.json",
  "core/evals/scenarios/presentation-contract.json",
  "tests/behavioral/presentation-contract.test.mjs",
  "tests/static/eval-runner.test.mjs"
];

const expectedBaselineFiles = new Map([
  ["core/instructions/global-operating-rules.md", { kind: "source", status: "stable" }],
  ["core/presentation/emoji-registry.json", { kind: "metadata", status: "stable" }],
  ["core/presentation/progress-contract.json", { kind: "metadata", status: "stable" }],
  ["core/schemas/presentation.schema.json", { kind: "metadata", status: "stable" }],
  ["core/evals/presentation-trace.mjs", { kind: "source", status: "stable" }],
  ["core/evals/presentation-trace.schema.json", { kind: "metadata", status: "stable" }],
  ["core/evals/scenarios/presentation-contract.json", { kind: "metadata", status: "stable" }],
  ["tests/behavioral/presentation-contract.test.mjs", { kind: "test", status: "stable" }],
  ["tests/static/presentation-safety.test.mjs", { kind: "test", status: "stable" }],
  ["core/skills/test-driven-development/writing-good-tests.md", { kind: "asset", status: "stable" }],
  ["core/skills/zero-downtime-migrations/postgres-expand-contract-examples.md", { kind: "asset", status: "stable" }],
]);

const expectedBaselinePaths = `
.gitattributes
.gitignore
.idea/.gitignore
.idea/all-about-agents.iml
.idea/misc.xml
.idea/modules.xml
.idea/vcs.xml
.pre-commit-config.yaml
AGENTS.md
CLAUDE.md
LICENSE
package.json
scripts/aaa.mjs
scripts/lint-shell.sh
core/instructions/global-operating-rules.md
core/presentation/emoji-registry.json
core/presentation/progress-contract.json
core/schemas/presentation.schema.json
core/skills/brainstorming/SKILL.md
core/skills/brainstorming/scripts/frame-template.html
core/skills/brainstorming/scripts/helper.js
core/skills/brainstorming/scripts/server.cjs
core/skills/brainstorming/scripts/start-server.sh
core/skills/brainstorming/scripts/stop-server.sh
core/skills/brainstorming/spec-document-reviewer-prompt.md
core/skills/brainstorming/visual-companion.md
core/skills/codebase-design/DEEPENING.md
core/skills/codebase-design/DESIGN-IT-TWICE.md
core/skills/codebase-design/SKILL.md
core/skills/dispatching-parallel-agents/SKILL.md
core/skills/executing-plans/SKILL.md
core/skills/finishing-a-development-branch/SKILL.md
core/skills/handoff/SKILL.md
core/skills/improve-codebase-architecture/HTML-REPORT.md
core/skills/improve-codebase-architecture/SKILL.md
core/skills/interviewing/SKILL.md
core/skills/loop-me/SKILL.md
core/skills/nano-image-generator/SKILL.md
core/skills/nano-image-generator/scripts/generate_image.py
core/skills/performance-profiling-and-benchmarking/SKILL.md
core/skills/performance-profiling-and-benchmarking/profiling-recipes.md
core/skills/receiving-code-review/SKILL.md
core/skills/requesting-code-review/SKILL.md
core/skills/requesting-code-review/code-reviewer.md
core/skills/research/SKILL.md
core/skills/resolving-merge-conflicts/SKILL.md
core/skills/session-compaction-resilience/SKILL.md
core/skills/session-compaction-resilience/snapshot-template.md
core/skills/subagent-driven-development/SKILL.md
core/skills/subagent-driven-development/implementer-prompt.md
core/skills/subagent-driven-development/re-review-prompt.md
core/skills/subagent-driven-development/scripts/review-package
core/skills/subagent-driven-development/scripts/review-package.js
core/skills/subagent-driven-development/scripts/sdd-workspace
core/skills/subagent-driven-development/scripts/sdd-workspace.js
core/skills/subagent-driven-development/scripts/task-brief
core/skills/subagent-driven-development/scripts/task-brief.js
core/skills/subagent-driven-development/task-reviewer-prompt.md
core/skills/systematic-debugging/SKILL.md
core/skills/systematic-debugging/condition-based-waiting-example.ts
core/skills/systematic-debugging/condition-based-waiting.md
core/skills/systematic-debugging/defense-in-depth.md
core/skills/systematic-debugging/feedback-loops.md
core/skills/systematic-debugging/find-polluter.sh
core/skills/systematic-debugging/root-cause-tracing.md
core/skills/systematic-debugging/hitl-loop.template.sh
core/skills/test-driven-development/SKILL.md
core/skills/test-driven-development/writing-good-tests.md
core/skills/threat-modeling-and-security/SKILL.md
core/skills/threat-modeling-and-security/stride-checklist.md
core/skills/using-all-about-agents/SKILL.md
core/skills/using-all-about-agents/references/codex-tools.md
core/skills/using-git-worktrees/SKILL.md
core/skills/verification-before-completion/SKILL.md
core/skills/wait-what/SKILL.md
core/skills/wayfinder/SKILL.md
core/skills/writing-plans/SKILL.md
core/skills/writing-plans/plan-document-reviewer-prompt.md
core/skills/writing-skills/SKILL.md
core/skills/writing-skills/anthropic-best-practices.md
core/skills/writing-skills/examples/CLAUDE_MD_TESTING.md
core/skills/writing-skills/graphviz-conventions.dot
core/skills/writing-skills/persuasion-principles.md
core/skills/writing-skills/render-graphs.js
core/skills/writing-skills/testing-skills-with-subagents.md
core/skills/zero-downtime-migrations/SKILL.md
core/skills/zero-downtime-migrations/postgres-expand-contract-examples.md
tests/helpers/temp-root.mjs
tests/static/repository-layout.test.mjs
tests/static/runtime.test.mjs
tests/static/presentation-safety.test.mjs
core/evals/presentation-trace.mjs
core/evals/presentation-trace.schema.json
core/evals/scenarios/presentation-contract.json
tests/behavioral/presentation-contract.test.mjs
`.trim().split(/\r?\n/u);

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
    assert.ok(paths.has(`core/${entry.source}`), `canonical skill source missing from inventory: ${entry.source}`);
    for (const asset of [...entry.assets, ...entry.scripts]) assert.ok(paths.has(`core/${asset}`), `canonical skill companion missing from inventory: ${asset}`);
  }
});

test("inventory preserves the reconciled canonical and quarantine path contract", async () => {
  const inventory = JSON.parse(await readFile(resolve(process.cwd(), "core/inventory.json"), "utf8"));
  function assertBaselinePaths(value) {
    assert.deepEqual(value.sourceFiles.map((entry) => entry.path), expectedBaselinePaths);
  }

  assertBaselinePaths(inventory);
  const substituted = JSON.parse(JSON.stringify(inventory));
  substituted.sourceFiles[0].path = "baseline/substituted-unlisted-path";
  assert.throws(() => assertBaselinePaths(substituted));
  for (const path of expectedBaselinePaths) await access(resolve(process.cwd(), path));
  const sourceFiles = new Map(inventory.sourceFiles.map((entry) => [entry.path, entry]));
  for (const [path, expected] of expectedBaselineFiles) {
    const entry = sourceFiles.get(path);
    assert.ok(entry, `baseline source missing: ${path}`);
    assert.equal(entry.kind, expected.kind, `baseline category changed: ${path}`);
    assert.equal(entry.auditDisposition.status, expected.status, `baseline disposition changed: ${path}`);
  }
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
