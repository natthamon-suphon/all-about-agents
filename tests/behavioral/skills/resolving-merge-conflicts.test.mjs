import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const skillId = "resolving-merge-conflicts";
const requiredCases = ["MC-TRIGGER-active-conflict", "MC-NONTRIGGER-clean-tree", "MC-PRESSURE-stage-all-never-abort"];

test("T036 exposes its routing evidence", async () => {
  const skill = await readFile(new URL(`../../../core/skills/${skillId}/SKILL.md`, import.meta.url), "utf8");
  const evaluation = JSON.parse(await readFile(new URL(`../../../core/evals/skill-routing/${skillId}.json`, import.meta.url), "utf8"));
  const serialized = JSON.stringify(evaluation);
  assert.match(skill, /^---\n/);
  for (const caseId of requiredCases) assert.match(serialized, new RegExp(caseId));
});

test("resolving-merge-conflicts stages exact files and retains safe abort", async () => {
  const skill = await readFile(new URL(`../../../core/skills/${skillId}/SKILL.md`, import.meta.url), "utf8");
  assert.match(skill, /Skill Gate Protocol/iu);
  assert.match(skill, /git diff --name-only --diff-filter=U/u);
  assert.match(skill, /git ls-files -u/u);
  assert.match(skill, /git add -- <resolved-path/iu);
  assert.match(skill, /git merge --abort/u);
  assert.match(skill, /git rebase --abort/u);
  assert.match(skill, /git cherry-pick --abort/u);
  assert.match(skill, /user-selected abort|user chooses to abort/iu);
  assert.doesNotMatch(skill, /git add (?:\.|-A|--all)(?:\s|`|$)/u);
});

test("resolving-merge-conflicts verifies markers and clean-tree nontrigger", async () => {
  const skill = await readFile(new URL(`../../../core/skills/${skillId}/SKILL.md`, import.meta.url), "utf8");
  assert.match(skill, /<<<<<<<|conflict marker/iu);
  assert.match(skill, /no unresolved|zero unresolved/iu);
  assert.match(skill, /clean tree|clean working tree|working tree is clean/iu);
  assert.match(skill, /untrusted/iu);
  assert.match(skill, /do not commit|never commit/iu);
  const active = await readFile(new URL("../../../tests/fixtures/resolving-merge-conflicts/active-conflict.txt", import.meta.url), "utf8");
  const clean = await readFile(new URL("../../../tests/fixtures/resolving-merge-conflicts/clean-tree.txt", import.meta.url), "utf8");
  assert.match(active, /<<<<<<< ours[\s\S]*=======[\s\S]*>>>>>>> theirs/u);
  assert.doesNotMatch(clean, /<<<<<<<|=======|>>>>>>>/u);
});

test("resolving-merge-conflicts evaluation has exact active, clean, and pressure contracts", async () => {
  const evaluation = JSON.parse(await readFile(new URL(`../../../core/evals/skill-routing/${skillId}.json`, import.meta.url), "utf8"));
  assert.equal(evaluation.schemaVersion, 1);
  assert.equal(evaluation.id, `${skillId}-routing`);
  assert.equal(evaluation.skill, skillId);
  assert.deepEqual(evaluation.cases.map((entry) => entry.id), requiredCases);
  for (const entry of evaluation.cases) {
    assert.equal(entry.critical, true, `${entry.id} must be critical`);
    assert.ok(Array.isArray(entry.observables) && entry.observables.length > 0);
  }
  assert.equal(evaluation.cases[0].expected.skillCheck, "required");
  assert.equal(evaluation.cases[0].expected.exactFileStaging, true);
  assert.equal(evaluation.cases[1].expected.skillCheck, "not-required");
  assert.equal(evaluation.cases[1].expected.cleanTree, true);
  assert.equal(evaluation.cases[2].expected.noStageAll, true);
  assert.equal(evaluation.cases[2].expected.safeAbortAvailable, true);
});

test("core loader exposes resolving-merge-conflicts metadata", async () => {
  const { loadCore } = await import("../../../installers/lib/load-core.mjs");
  const core = await loadCore(process.cwd());
  const skill = core.skills.find((entry) => entry.id === skillId);
  assert.ok(skill);
  assert.equal(skill.name, skillId);
  assert.deepEqual(skill.evaluationCases, requiredCases);
});
