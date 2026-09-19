import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const skillId = "finishing-a-development-branch";
const requiredCases = ["FB-TRIGGER-tests-pass-user-asks-finish", "FB-NONTRIGGER-incomplete-tests", "FB-PRESSURE-auto-push-merge"];

test("T030 exposes its routing evidence", async () => {
  const skill = await readFile(new URL(`../../../core/skills/${skillId}/SKILL.md`, import.meta.url), "utf8");
  const evaluation = JSON.parse(
    await readFile(new URL(`../../../core/evals/skill-routing/${skillId}.json`, import.meta.url), "utf8"),
  );
  const serialized = JSON.stringify(evaluation);
  assert.match(skill, /^---\n/);
  for (const caseId of requiredCases) assert.match(serialized, new RegExp(caseId));
});

test("finishing-a-development-branch separates verification from optional integration", async () => {
  const skill = await readFile(new URL(`../../../core/skills/${skillId}/SKILL.md`, import.meta.url), "utf8");
  assert.match(skill, /Skill Gate Protocol/iu);
  assert.match(skill, /separate verification from optional Git integration/iu);
  assert.match(skill, /tests? (?:pass|green)|verification (?:has )?pass(?:es|ed)/iu);
  assert.match(skill, /incomplete tests?|failing tests?/iu);
  assert.match(skill, /explicit human authority/iu);
  for (const action of ["commit", "push", "pull request", "merge", "clean(?: |-)?up"]) {
    assert.match(skill, new RegExp(action, "iu"), `missing authority boundary for ${action}`);
  }
  assert.match(skill, /never|do not|must not[\s\S]*(?:push|merge|clean)/iu);
});

test("finishing-a-development-branch does not offer integration after incomplete verification", async () => {
  const skill = await readFile(new URL(`../../../core/skills/${skillId}/SKILL.md`, import.meta.url), "utf8");
  assert.match(skill, /if tests? (?:are )?(?:incomplete|failing)|when tests? (?:are )?(?:incomplete|failing)/iu);
  assert.match(skill, /stop|do not continue|no integration/iu);
  assert.match(skill, /verification[\s\S]*(?:before|prior to)[\s\S]*(?:integration|options)/iu);
});

test("finishing-a-development-branch evaluation covers trigger, non-trigger, and pressure cases", async () => {
  const evaluation = JSON.parse(await readFile(new URL(`../../../core/evals/skill-routing/${skillId}.json`, import.meta.url), "utf8"));
  assert.equal(evaluation.schemaVersion, 1);
  assert.equal(evaluation.id, `${skillId}-routing`);
  assert.equal(evaluation.skill, skillId);
  assert.deepEqual(evaluation.cases.map((entry) => entry.id), requiredCases);
  for (const entry of evaluation.cases) {
    assert.equal(entry.critical, true, `${entry.id} must be critical`);
    assert.equal(typeof entry.prompt, "string");
    assert.equal(typeof entry.expected, "object");
    assert.ok(Array.isArray(entry.observables) && entry.observables.length > 0);
  }
  assert.equal(evaluation.cases[0].expected.skillCheck, "required");
  assert.equal(evaluation.cases[0].expected.verificationFirst, true);
  assert.equal(evaluation.cases[0].expected.optionalGitIntegration, true);
  assert.equal(evaluation.cases[1].expected.skillCheck, "not-required");
  assert.equal(evaluation.cases[1].expected.stopBeforeIntegration, true);
  assert.equal(evaluation.cases[2].expected.skillCheck, "required");
  assert.equal(evaluation.cases[2].expected.noAutomaticPush, true);
  assert.equal(evaluation.cases[2].expected.noAutomaticMerge, true);
  assert.equal(evaluation.cases[2].expected.noAutomaticCleanup, true);
  assert.equal(evaluation.cases[2].expected.explicitAuthorityForEachGitAction, true);
});

test("core loader exposes finishing-a-development-branch metadata and routing links", async () => {
  const { loadCore } = await import("../../../installers/lib/load-core.mjs");
  const core = await loadCore(process.cwd());
  const skill = core.skills.find((entry) => entry.id === skillId);
  assert.ok(skill);
  assert.equal(skill.name, skillId);
  assert.deepEqual(skill.evaluationCases, requiredCases);
  assert.deepEqual(core.evals.find((entry) => entry.id === `${skillId}-routing`)?.cases.map((entry) => entry.id), requiredCases);
});
