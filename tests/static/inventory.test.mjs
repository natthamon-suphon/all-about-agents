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
  ["skills/zero-downtime-migrations/postgres-expand-contract-examples.md", { kind: "asset", status: "stable" }],
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

const expectedBaselinePaths = `
.claude-plugin/marketplace.json
.claude-plugin/plugin.json
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
agents/README.md
agents/codebase-architect.json
agents/codebase-architect.md
agents/deep-investigator.json
agents/deep-investigator.md
agents/generalist.json
agents/generalist.md
agents/implementer.json
agents/implementer.md
agents/security-auditor.json
agents/security-auditor.md
agents/task-reviewer.json
agents/task-reviewer.md
configs/CLAUDE.local.md
configs/GEMINI.local.md
configs/settings.local.json
docs/antigravity.md
hooks/antigravity-hooks.json
hooks/antigravity-session-start.js
hooks/antigravity-track-tool.js
hooks/hooks.json
hooks/run-hook.cmd
hooks/session-start
package.json
scripts/aaa.mjs
scripts/lint-shell.sh
setup/setup-antigravity.ps1
setup/setup-antigravity.sh
setup/setup-guide-antigravity.md
skills/brainstorming/SKILL.md
skills/brainstorming/scripts/frame-template.html
skills/brainstorming/scripts/helper.js
skills/brainstorming/scripts/server.cjs
skills/brainstorming/scripts/start-server.sh
skills/brainstorming/scripts/stop-server.sh
skills/brainstorming/spec-document-reviewer-prompt.md
skills/brainstorming/visual-companion.md
skills/codebase-design/DEEPENING.md
skills/codebase-design/DESIGN-IT-TWICE.md
skills/codebase-design/SKILL.md
skills/dispatching-parallel-agents/SKILL.md
skills/executing-plans/SKILL.md
skills/finishing-a-development-branch/SKILL.md
skills/handoff/SKILL.md
skills/improve-codebase-architecture/HTML-REPORT.md
skills/improve-codebase-architecture/SKILL.md
skills/interviewing/SKILL.md
skills/loop-me/SKILL.md
skills/nano-image-generator/SKILL.md
skills/nano-image-generator/scripts/generate_image.py
skills/performance-profiling-and-benchmarking/SKILL.md
skills/performance-profiling-and-benchmarking/profiling-recipes.md
skills/receiving-code-review/SKILL.md
skills/requesting-code-review/SKILL.md
skills/requesting-code-review/code-reviewer.md
skills/research/SKILL.md
skills/resolving-merge-conflicts/SKILL.md
skills/session-compaction-resilience/SKILL.md
skills/session-compaction-resilience/snapshot-template.md
skills/subagent-driven-development/SKILL.md
skills/subagent-driven-development/implementer-prompt.md
skills/subagent-driven-development/re-review-prompt.md
skills/subagent-driven-development/scripts/review-package
skills/subagent-driven-development/scripts/review-package.js
skills/subagent-driven-development/scripts/sdd-workspace
skills/subagent-driven-development/scripts/sdd-workspace.js
skills/subagent-driven-development/scripts/task-brief
skills/subagent-driven-development/scripts/task-brief.js
skills/subagent-driven-development/task-reviewer-prompt.md
skills/systematic-debugging/CREATION-LOG.md
skills/systematic-debugging/SKILL.md
skills/systematic-debugging/condition-based-waiting-example.ts
skills/systematic-debugging/condition-based-waiting.md
skills/systematic-debugging/defense-in-depth.md
skills/systematic-debugging/feedback-loops.md
skills/systematic-debugging/find-polluter.sh
skills/systematic-debugging/root-cause-tracing.md
skills/systematic-debugging/scripts/hitl-loop.template.sh
skills/systematic-debugging/test-academic.md
skills/systematic-debugging/test-pressure-1.md
skills/systematic-debugging/test-pressure-2.md
skills/systematic-debugging/test-pressure-3.md
skills/test-driven-development/SKILL.md
skills/test-driven-development/writing-good-tests.md
skills/threat-modeling-and-security/SKILL.md
skills/threat-modeling-and-security/stride-checklist.md
skills/using-all-about-agents/SKILL.md
skills/using-all-about-agents/references/antigravity-tools.md
skills/using-all-about-agents/references/codex-tools.md
skills/using-all-about-agents/references/gemini-tools.md
skills/using-all-about-agents/references/pi-tools.md
skills/using-git-worktrees/SKILL.md
skills/verification-before-completion/SKILL.md
skills/wait-what/SKILL.md
skills/wayfinder/SKILL.md
skills/writing-plans/SKILL.md
skills/writing-plans/plan-document-reviewer-prompt.md
skills/writing-skills/SKILL.md
skills/writing-skills/anthropic-best-practices.md
skills/writing-skills/examples/CLAUDE_MD_TESTING.md
skills/writing-skills/graphviz-conventions.dot
skills/writing-skills/persuasion-principles.md
skills/writing-skills/render-graphs.js
skills/writing-skills/testing-skills-with-subagents.md
skills/zero-downtime-migrations/SKILL.md
skills/zero-downtime-migrations/postgres-expand-contract-examples.md
statusline/statusline.js
statusline/track-tool.js
tests/helpers/temp-root.mjs
tests/static/repository-layout.test.mjs
tests/static/runtime.test.mjs
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
    assert.ok(paths.has(entry.source), `skill source missing from inventory: ${entry.source}`);
    for (const asset of [...entry.assets, ...entry.scripts]) assert.ok(paths.has(asset), `skill asset missing from inventory: ${asset}`);
  }
});

test("inventory preserves the immutable baseline path and category contract", async () => {
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
