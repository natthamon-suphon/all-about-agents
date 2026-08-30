import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const skillId = "requesting-code-review";
const requiredCases = ["RQ-TRIGGER-major-change-before-finish", "RQ-NONTRIGGER-no-diff", "RQ-PRESSURE-no-commit-sha"];

test("T034 exposes its routing evidence", async () => {
  const skill = await readFile(new URL(`../../../core/skills/${skillId}/SKILL.md`, import.meta.url), "utf8");
  const evaluation = JSON.parse(
    await readFile(new URL(`../../../core/evals/skill-routing/${skillId}.json`, import.meta.url), "utf8"),
  );
  const serialized = JSON.stringify(evaluation);
  assert.match(skill, /^---\n/);
  for (const caseId of requiredCases) assert.match(serialized, new RegExp(caseId));
});

test("requesting-code-review defines the review-package Skill Gate Protocol", async () => {
  const skill = await readFile(new URL(`../../../core/skills/${skillId}/SKILL.md`, import.meta.url), "utf8");
  assert.match(skill, /Skill Gate Protocol/iu);
  assert.match(skill, /unstaged diff/iu);
  assert.match(skill, /staged diff/iu);
  assert.match(skill, /commit\/range|commit or commit range/iu);
  assert.match(skill, /artifact\/file list|artifact.*file list/iu);
  assert.match(skill, /commit SHA is optional|SHA is optional/iu);
  assert.match(skill, /clean.*no[- ]diff|no[- ]diff.*clean/iu);
  assert.match(skill, /not run/iu);
});

test("requesting-code-review forbids history changes made only to enable review", async () => {
  const skill = await readFile(new URL(`../../../core/skills/${skillId}/SKILL.md`, import.meta.url), "utf8");
  assert.match(skill, /never commit, push, create a pull request/iu);
  assert.match(skill, /Do not\s+create.*throwaway commit/iu);
  assert.match(skill, /no diff/iu);
  assert.doesNotMatch(skill, /commit SHA is required/iu);
});

test("requesting-code-review evaluation has exact trigger, no-diff, and no-SHA contracts", async () => {
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
  assert.equal(evaluation.cases[0].expected.exactScope, true);
  assert.equal(evaluation.cases[0].expected.independentReview, true);
  assert.equal(evaluation.cases[1].expected.skillCheck, "not-required");
  assert.equal(evaluation.cases[1].expected.cleanNoDiff, true);
  assert.equal(evaluation.cases[2].expected.skillCheck, "required");
  assert.equal(evaluation.cases[2].expected.commitShaOptional, true);
  assert.equal(evaluation.cases[2].expected.noThrowawayCommit, true);
});

test("core loader exposes requesting-code-review metadata", async () => {
  const { loadCore } = await import("../../../installers/lib/load-core.mjs");
  const core = await loadCore(process.cwd());
  const skill = core.skills.find((entry) => entry.id === skillId);
  assert.ok(skill);
  assert.equal(skill.name, skillId);
  assert.deepEqual(skill.evaluationCases, requiredCases);
  assert.deepEqual(core.evals.find((entry) => entry.id === `${skillId}-routing`)?.cases.map((entry) => entry.id), requiredCases);
});
