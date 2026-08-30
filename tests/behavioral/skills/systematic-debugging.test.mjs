import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const skillId = "systematic-debugging";
const requiredCases = ["DB-TRIGGER-failure-or-regression", "DB-NONTRIGGER-known-requested-change", "DB-PRESSURE-print-env-guess-fix"];

test("T032 exposes its routing evidence", async () => {
  const skill = await readFile(new URL(`../../../core/skills/${skillId}/SKILL.md`, import.meta.url), "utf8");
  const evaluation = JSON.parse(
    await readFile(new URL(`../../../core/evals/skill-routing/${skillId}.json`, import.meta.url), "utf8"),
  );
  const serialized = JSON.stringify(evaluation);
  assert.match(skill, /^---\n/);
  for (const caseId of requiredCases) assert.match(serialized, new RegExp(caseId));
});

test("systematic-debugging gates fixes on safe, minimal evidence", async () => {
  const skill = await readFile(new URL(`../../../core/skills/${skillId}/SKILL.md`, import.meta.url), "utf8");
  assert.match(skill, /Skill Gate Protocol/iu);
  assert.match(skill, /NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST/iu);
  assert.match(skill, /smallest reproducible evidence/iu);
  assert.match(skill, /nondeterministic/iu);
  assert.match(skill, /disposable root/iu);
  assert.match(skill, /pre-existing pollution/iu);
  assert.match(skill, /not run/iu);
  assert.doesNotMatch(skill, /95%/u);
  assert.doesNotMatch(skill, /(?:printenv|env)\s*\|/iu);
  assert.doesNotMatch(skill, /echo\s+[^\n]*(?:TOKEN|SECRET|IDENTITY)/iu);
});

test("systematic-debugging references are resolvable and examples do not disclose configuration", async () => {
  const rootCause = await readFile(new URL("../../../core/skills/systematic-debugging/root-cause-tracing.md", import.meta.url), "utf8");
  const feedbackLoops = await readFile(new URL("../../../core/skills/systematic-debugging/feedback-loops.md", import.meta.url), "utf8");
  const waiting = await readFile(new URL("../../../core/skills/systematic-debugging/condition-based-waiting.md", import.meta.url), "utf8");
  const skill = await readFile(new URL("../../../core/skills/systematic-debugging/SKILL.md", import.meta.url), "utf8");

  assert.doesNotMatch(rootCause, /\w+\s*:\s*process\.env(?:\.|\[)/u);
  assert.match(rootCause, /never dump the\s+environment/iu);
  assert.doesNotMatch(`${feedbackLoops}\n${waiting}`, /\b\d{1,3}%/u);
  assert.doesNotMatch(`${skill}\n${feedbackLoops}`, /scripts\/hitl-loop\.template\.sh/u);
  assert.doesNotMatch(waiting, /condition-based-waiting-example\.ts/u);
  await access(new URL("../../../core/skills/systematic-debugging/hitl-loop.template.sh", import.meta.url));
});

test("find-polluter preserves filenames, selects a runner, and reports failures", async () => {
  const script = await readFile(new URL("../../../core/skills/systematic-debugging/find-polluter.sh", import.meta.url), "utf8");
  assert.match(script, /-print0/iu);
  assert.match(script, /read\s+-r\s+-d/iu);
  assert.ok(script.includes('for TEST_FILE in "${TEST_FILES[@]}"'));
  assert.match(script, /TEST_RUNNER/iu);
  assert.match(script, /pre-existing pollution/iu);
  assert.match(script, /no test files matched/iu);
  assert.match(script, /test failed/iu);
  assert.doesNotMatch(script, /for TEST_FILE in \$TEST_FILES/u);
  assert.doesNotMatch(script, /\|\|\s*true/u);
});

test("systematic-debugging owns disposable shell fixtures", async () => {
  const fixture = await readFile(new URL("../../../tests/fixtures/systematic-debugging/README.md", import.meta.url), "utf8");
  assert.match(fixture, /disposable/iu);
  assert.match(fixture, /space/iu);
  for (const path of [
    "../../../tests/fixtures/systematic-debugging/runner/fixture-runner.sh",
    "../../../tests/fixtures/systematic-debugging/runner/clean test.sh",
    "../../../tests/fixtures/systematic-debugging/runner/create pollution.sh",
  ]) await readFile(new URL(path, import.meta.url));
});

test("systematic-debugging evaluation has exact trigger, non-trigger, and pressure contracts", async () => {
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
  assert.equal(evaluation.cases[0].expected.rootCauseBeforeFix, true);
  assert.equal(evaluation.cases[0].expected.smallestReproducibleEvidence, true);
  assert.equal(evaluation.cases[1].expected.skillCheck, "not-required");
  assert.equal(evaluation.cases[1].expected.knownRequestedChange, true);
  assert.equal(evaluation.cases[2].expected.skillCheck, "required");
  assert.equal(evaluation.cases[2].expected.noSecretOrEnvironmentDump, true);
  assert.equal(evaluation.cases[2].expected.noGuessFix, true);
  assert.equal(evaluation.cases[2].expected.honestNondeterminism, true);
});

test("core loader exposes systematic-debugging metadata", async () => {
  const { loadCore } = await import("../../../installers/lib/load-core.mjs");
  const core = await loadCore(process.cwd());
  const skill = core.skills.find((entry) => entry.id === skillId);
  assert.ok(skill);
  assert.equal(skill.name, skillId);
  assert.deepEqual(skill.evaluationCases, requiredCases);
  assert.deepEqual(core.evals.find((entry) => entry.id === `${skillId}-routing`)?.cases.map((entry) => entry.id), requiredCases);
});
