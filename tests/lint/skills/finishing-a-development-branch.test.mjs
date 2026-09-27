import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const skillId = "finishing-a-development-branch";
const requiredCases = ["FB-TRIGGER-tests-pass-user-asks-finish", "FB-NONTRIGGER-failing-or-unfinished", "FB-PRESSURE-auto-push-merge", "FB-TRIGGER-unknown-test-status"];

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
  assert.equal(evaluation.cases[3].expected.skillCheck, "required");
  assert.equal(evaluation.cases[3].expected.runsFullSuiteFirst, true);
  assert.equal(evaluation.cases[3].expected.noIntegrationBeforeGreen, true);
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

test("finishing-a-development-branch runs tests for unknown status and names the verification boundary", async () => {
  const skill = await readFile(new URL(`../../../core/skills/${skillId}/SKILL.md`, import.meta.url), "utf8");
  assert.match(skill, /`verification-before-completion` gates any success claim with fresh evidence; `finishing-a-development-branch` handles integration, runs the full suite, and uses the verification gate\./u);
  assert.doesNotMatch(skill, /incomplete, failing,\s+or unknown/iu);
  assert.match(skill, /status is unknown[^.]*step 3/isu);
  assert.doesNotMatch(skill, /unknown, record it as `not run`/iu);
  assert.match(skill, /record it as unknown/iu);
});

test("finishing-a-development-branch routes on a complete implementation, not on a passed test run", async () => {
  const skill = await readFile(new URL(`../../../core/skills/${skillId}/SKILL.md`, import.meta.url), "utf8");
  const description = /^description: (.+)$/mu.exec(skill)?.[1] ?? "";
  assert.doesNotMatch(description, /verification has passed/iu, "an unknown test status still triggers; step 3 runs the suite");
  assert.match(description, /implementation is complete[^.]*unknown/iu);
  const whenToUse = skill.split("## When to use")[1].split("\n## ")[0];
  assert.doesNotMatch(whenToUse, /have passed/iu);
  assert.match(whenToUse, /failing tests[^.]*unfinished work|unfinished work[^.]*failing tests/iu);
  const evaluation = JSON.parse(await readFile(new URL(`../../../core/evals/skill-routing/${skillId}.json`, import.meta.url), "utf8"));
  assert.doesNotMatch(JSON.stringify(evaluation.cases[0].observables), /only after fresh tests/iu);
  const nontrigger = evaluation.cases[1];
  assert.doesNotMatch(nontrigger.prompt, /not run|unknown|incomplete/iu, "an unknown test status is a trigger, not a nontrigger");
  assert.match(nontrigger.prompt, /fail/iu);
  assert.match(nontrigger.prompt, /not (?:yet )?implemented|unfinished/iu);
});
