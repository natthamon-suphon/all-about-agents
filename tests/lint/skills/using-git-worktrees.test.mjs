import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const skillId = "using-git-worktrees";
const requiredCases = ["GW-TRIGGER-requested-isolation", "GW-NONTRIGGER-current-isolated-worktree", "GW-PRESSURE-auto-install-commit"];
const skillPath = resolve(process.cwd(), "core/skills/using-git-worktrees/SKILL.md");
const evaluationPath = resolve(process.cwd(), "core/evals/skill-routing/using-git-worktrees.json");
const fixtureRoot = resolve(process.cwd(), "tests/fixtures/using-git-worktrees");

test("T027 exposes its routing evidence", async () => {
  const skill = await readFile(new URL(`../../../core/skills/${skillId}/SKILL.md`, import.meta.url), "utf8");
  const evaluation = JSON.parse(
    await readFile(new URL(`../../../core/evals/skill-routing/${skillId}.json`, import.meta.url), "utf8"),
  );
  const serialized = JSON.stringify(evaluation);
  assert.match(skill, /^---\n/);
  for (const caseId of requiredCases) assert.match(serialized, new RegExp(caseId));
});

test("using-git-worktrees routes only requested isolation and protects authority boundaries", async () => {
  const skill = await readFile(skillPath, "utf8");
  assert.match(skill, /^---\n/u);
  const closing = skill.indexOf("\n---\n", 4);
  assert.ok(closing > 0, "frontmatter must close");
  const frontmatter = skill.slice(4, closing);
  assert.match(frontmatter, /^name:\s*using-git-worktrees\s*$/mu);
  assert.match(frontmatter, /^description:\s*Use when\b/mu);
  assert.match(frontmatter, /^evaluationCases:\s*$/mu);
  assert.match(skill, /requested.*(?:isolation|separate checkout)|separate checkout.*requested/isu);
  assert.match(skill, /normal repository|linked worktree|detached HEAD/iu);
  assert.match(skill, /native Git|native environment|git rev-parse/iu);
  assert.match(skill, /explicit(?:ly)? human (?:authority|approval)|recorded, explicit human/iu);
  assert.match(skill, /Skill Gate Protocol/iu);
  assert.match(skill, /target.*(?:contained|inside).*workspace|symlink.*junction/isu);
  assert.match(skill, /preserve.*(?:uncommitted|source checkout)|uncommitted.*(?:preserve|untouched)/isu);
  assert.match(skill, /argument vector|structured native Git|shell command.*interpolat/isu);
  assert.match(skill, /do not automatically install|never automatically install|dependency.*(?:missing|install)/isu);
  assert.match(skill, /\.gitignore.*(?:commit|changes)|commit.*\.gitignore/isu);
  assert.match(skill, /do not.*(?:automatically )?commit|no automatic.*commit/isu);
  assert.match(skill, /already.*isolated|already-linked worktree/iu);
  assert.match(skill, /nested|duplicate.*checkout/iu);
  assert.match(skill, /detached HEAD.*(?:require|authority)|require.*branch.*authority/isu);
  assert.doesNotMatch(skill, /(?:\.claude|\.codex|\.gemini|mcp__|WebSearch|WebFetch|spawn_agent|invoke_subagent)/iu);
});

test("T027 fixtures cover normal, linked-worktree, and detached-HEAD gate states", async () => {
  const gate = JSON.parse(await readFile(resolve(fixtureRoot, "skill-gate.json"), "utf8"));
  assert.equal(gate.protocol, "Skill Gate Protocol");
  assert.deepEqual(gate.fixtures, ["normal-repo.json", "linked-worktree.json", "detached-head.json"]);
  assert.ok(gate.requiredChecks.includes("explicit-human-authority"));
  assert.ok(gate.requiredChecks.includes("native-git-detection"));
  for (const [file, expectedCase] of [["normal-repo.json", "normal-repository"], ["linked-worktree.json", "linked-worktree"], ["detached-head.json", "detached-HEAD"]]) {
    const fixture = JSON.parse(await readFile(resolve(fixtureRoot, file), "utf8"));
    assert.equal(fixture.case, expectedCase);
    assert.equal(fixture.state.gitIsInsideWorkTree, true);
    assert.ok(typeof fixture.expected.skillCheck === "string");
  }
});

test("using-git-worktrees routing evaluation defines the three critical cases", async () => {
  const evaluation = JSON.parse(await readFile(evaluationPath, "utf8"));
  assert.equal(evaluation.schemaVersion, 1);
  assert.equal(evaluation.skill, skillId);
  assert.deepEqual(evaluation.cases.map((entry) => entry.id), requiredCases);
  for (const entry of evaluation.cases) {
    assert.equal(entry.critical, true, `${entry.id} must be critical`);
    assert.equal(typeof entry.prompt, "string");
    assert.equal(typeof entry.expected, "object");
    assert.ok(Array.isArray(entry.observables) && entry.observables.length > 0);
  }
  assert.equal(evaluation.cases[0].expected.skillCheck, "required");
  assert.equal(evaluation.cases[0].expected.explicitAuthority, true);
  assert.equal(evaluation.cases[0].expected.detectNativeEnvironment, true);
  assert.equal(evaluation.cases[0].expected.verifyAfterCreation, true);
  assert.equal(evaluation.cases[1].expected.skillCheck, "not-required");
  assert.equal(evaluation.cases[1].expected.alreadyIsolated, true);
  assert.equal(evaluation.cases[1].expected.noNestedWorktree, true);
  assert.equal(evaluation.cases[2].expected.skillCheck, "required");
  assert.equal(evaluation.cases[2].expected.noAutomaticDependencyInstall, true);
  assert.equal(evaluation.cases[2].expected.noAutomaticGitignoreCommit, true);
  assert.equal(evaluation.cases[2].expected.noAutomaticCommit, true);
});

test("core loader exposes using-git-worktrees metadata and routing links", async () => {
  const { loadCore } = await import("../../../installers/lib/load-core.mjs");
  const core = await loadCore(process.cwd());
  const skill = core.skills.find((entry) => entry.id === skillId);
  assert.ok(skill);
  assert.equal(skill.name, skillId);
  assert.deepEqual(skill.evaluationCases, requiredCases);
  assert.deepEqual(core.evals.find((entry) => entry.id === "using-git-worktrees-routing")?.cases.map((entry) => entry.id), requiredCases);
});
