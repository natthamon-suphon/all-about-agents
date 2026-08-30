import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const skillId = "receiving-code-review";
const requiredCases = ["RC-TRIGGER-review-feedback-arrives", "RC-NONTRIGGER-general-advice", "RC-PRESSURE-blind-agreement"];

test("T035 exposes its routing evidence", async () => {
  const skill = await readFile(new URL(`../../../core/skills/${skillId}/SKILL.md`, import.meta.url), "utf8");
  const evaluation = JSON.parse(await readFile(new URL(`../../../core/evals/skill-routing/${skillId}.json`, import.meta.url), "utf8"));
  const serialized = JSON.stringify(evaluation);
  assert.match(skill, /^---\n/);
  for (const caseId of requiredCases) assert.match(serialized, new RegExp(caseId));
});

test("receiving-code-review verifies feedback before accepting or rejecting it", async () => {
  const skill = await readFile(new URL(`../../../core/skills/${skillId}/SKILL.md`, import.meta.url), "utf8");
  assert.match(skill, /Skill Gate Protocol/iu);
  assert.match(skill, /verify.*technical claim|technical claim.*verify/iu);
  assert.match(skill, /user intent|requested scope/iu);
  assert.match(skill, /inspect.*(?:code|file|evidence)|(?:code|file|evidence).*inspect/iu);
  assert.match(skill, /blind(?:ly)? agree|automatic agreement/iu);
  assert.match(skill, /incorrect|unsupported|not applicable/iu);
});

test("receiving-code-review removes non-correctness style policing", async () => {
  const skill = await readFile(new URL(`../../../core/skills/${skillId}/SKILL.md`, import.meta.url), "utf8");
  assert.match(skill, /style preference|style-only/iu);
  assert.match(skill, /does not improve correctness|no correctness impact/iu);
  assert.match(skill, /do not implement|decline|omit/iu);
  assert.match(skill, /general advice/iu);
  assert.doesNotMatch(skill, /accept every review comment/iu);
});

test("receiving-code-review evaluation has exact feedback, advice, and pressure contracts", async () => {
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
  assert.equal(evaluation.cases[0].expected.verifyTechnicalClaims, true);
  assert.equal(evaluation.cases[1].expected.skillCheck, "not-required");
  assert.equal(evaluation.cases[1].expected.generalAdvice, true);
  assert.equal(evaluation.cases[2].expected.skillCheck, "required");
  assert.equal(evaluation.cases[2].expected.noBlindAgreement, true);
  assert.equal(evaluation.cases[2].expected.removeStylePolicing, true);
});

test("core loader exposes receiving-code-review metadata", async () => {
  const { loadCore } = await import("../../../installers/lib/load-core.mjs");
  const core = await loadCore(process.cwd());
  const skill = core.skills.find((entry) => entry.id === skillId);
  assert.ok(skill);
  assert.equal(skill.name, skillId);
  assert.deepEqual(skill.evaluationCases, requiredCases);
  assert.deepEqual(core.evals.find((entry) => entry.id === `${skillId}-routing`)?.cases.map((entry) => entry.id), requiredCases);
});
