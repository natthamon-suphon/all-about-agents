import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const skillId = "verification-before-completion";
const requiredCases = ["VC-TRIGGER-before-success-claim", "VC-NONTRIGGER-progress-update", "VC-PRESSURE-old-test-output"];

test("T033 exposes its routing evidence", async () => {
  const skill = await readFile(new URL(`../../../core/skills/${skillId}/SKILL.md`, import.meta.url), "utf8");
  const evaluation = JSON.parse(
    await readFile(new URL(`../../../core/evals/skill-routing/${skillId}.json`, import.meta.url), "utf8"),
  );
  const serialized = JSON.stringify(evaluation);
  assert.match(skill, /^---\n/);
  for (const caseId of requiredCases) assert.match(serialized, new RegExp(caseId));
});

test("verification-before-completion enforces the fresh evidence gate", async () => {
  const skill = await readFile(new URL(`../../../core/skills/${skillId}/SKILL.md`, import.meta.url), "utf8");
  assert.match(skill, /Skill Gate Protocol/iu);
  assert.match(skill, /NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE/iu);
  assert.match(skill, /fresh[\s\S]*(?:scoped|exact command)/iu);
  assert.match(skill, /not run/iu);
  assert.match(skill, /progress update/iu);
  assert.match(skill, /old|stale/iu);
  assert.match(skill, /before.*(?:claim|success)/iu);
  assert.doesNotMatch(skill, /trust.*(?:old|cached).*output/iu);
});

test("verification-before-completion keeps progress distinct from completion", async () => {
  const skill = await readFile(new URL(`../../../core/skills/${skillId}/SKILL.md`, import.meta.url), "utf8");
  assert.match(skill, /Progress:[\s\S]*no fix[\s\S]*claim/iu);
  assert.match(skill, /does not require[\s\S]*completion gate/iu);
  assert.match(skill, /Do not use [“"](?:nearly done|looks good|should pass)/iu);
});

test("verification-before-completion evaluation has exact trigger, progress, and stale-output contracts", async () => {
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
  assert.equal(evaluation.cases[0].expected.freshEvidence, true);
  assert.equal(evaluation.cases[0].expected.exactCommandAndResult, true);
  assert.equal(evaluation.cases[1].expected.skillCheck, "not-required");
  assert.equal(evaluation.cases[1].expected.progressUpdate, true);
  assert.equal(evaluation.cases[2].expected.skillCheck, "required");
  assert.equal(evaluation.cases[2].expected.rejectStaleEvidence, true);
  assert.equal(evaluation.cases[2].expected.freshRerun, true);
});

test("core loader exposes verification-before-completion metadata", async () => {
  const { loadCore } = await import("../../../installers/lib/load-core.mjs");
  const core = await loadCore(process.cwd());
  const skill = core.skills.find((entry) => entry.id === skillId);
  assert.ok(skill);
  assert.equal(skill.name, skillId);
  assert.deepEqual(skill.evaluationCases, requiredCases);
  assert.deepEqual(core.evals.find((entry) => entry.id === `${skillId}-routing`)?.cases.map((entry) => entry.id), requiredCases);
});
