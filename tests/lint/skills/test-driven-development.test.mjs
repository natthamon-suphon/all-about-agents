import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const skillId = "test-driven-development";
const requiredCases = ["TD-TRIGGER-feature-or-bugfix", "TD-NONTRIGGER-doc-only-change", "TD-PRESSURE-keep-prewritten-code"];

test("test-driven-development keeps the RED/GREEN contract at a usable seam", async () => {
  const skill = await readFile(new URL(`../../../core/skills/${skillId}/SKILL.md`, import.meta.url), "utf8");
  assert.match(skill, /Skill Gate Protocol/iu);
  assert.match(skill, /NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST/iu);
  assert.match(skill, /write [^\n]*test[\s\S]*(?:watch|confirm)[\s\S]*fail[\s\S]*(?:minimal|smallest)[\s\S]*(?:implementation|change|code)[\s\S]*(?:pass|green)/iu);
  assert.match(skill, /public seam|outermost seam|agreed seam/iu);
  assert.match(skill, /trivial|bounded/iu);
  assert.match(skill, /no (?:mandatory )?(?:seam )?(?:confirmation|ceremony)|do not (?:pause|ask).*(?:seam|confirm)/iu);
});

test("test-driven-development limits safe exceptions and preserves prewritten code", async () => {
  const skill = await readFile(new URL(`../../../core/skills/${skillId}/SKILL.md`, import.meta.url), "utf8");
  assert.match(skill, /documentation[- ]only|docs?[- ]only/iu);
  assert.match(skill, /configuration[- ]only|config[- ]only/iu);
  assert.match(skill, /no (?:runtime )?behavior change|does not change behavior/iu);
  assert.match(skill, /prewritten|existing (?:implementation|code)|already[- ]written/iu);
  assert.match(skill, /preserve|keep/iu);
  assert.match(skill, /do not delete|never delete|without destructive deletion/iu);
  assert.match(skill, /RED[\s\S]*(?:evidence|result)[\s\S]*GREEN[\s\S]*(?:evidence|result)/iu);
});

test("test-driven-development evaluation covers trigger, non-trigger, and pressure cases", async () => {
  const evaluation = JSON.parse(await readFile(new URL(`../../../core/evals/skill-routing/${skillId}.json`, import.meta.url), "utf8"));
  assert.equal(evaluation.schemaVersion, 1);
  assert.equal(evaluation.id, `${skillId}-routing`);
  assert.equal(evaluation.skill, skillId);
  assert.deepEqual(evaluation.cases.map((entry) => entry.id), requiredCases);
  for (const entry of evaluation.cases) {
    assert.equal(entry.critical, true, `${entry.id} must be critical`);
    assert.equal(typeof entry.prompt, "string");
    assert.doesNotMatch(entry.prompt, /test-driven|\bTDD\b|\bskill\b/iu, `${entry.id} prompt must not name the skill`);
    assert.equal(typeof entry.expected, "object");
    assert.ok(Array.isArray(entry.observables) && entry.observables.length > 0);
  }
  assert.equal(evaluation.cases[0].expected.skillCheck, "required");
  assert.equal(evaluation.cases[0].expected.redBeforeImplementation, true);
  assert.equal(evaluation.cases[0].expected.greenAfterImplementation, true);
  assert.equal(evaluation.cases[0].expected.publicSeam, true);
  assert.equal(evaluation.cases[1].expected.skillCheck, "not-required");
  assert.equal(evaluation.cases[1].expected.documentationOnly, true);
  assert.equal(evaluation.cases[1].expected.noBehaviorChange, true);
  assert.equal(evaluation.cases[2].expected.skillCheck, "required");
  assert.equal(evaluation.cases[2].expected.preservePrewrittenCode, true);
  assert.equal(evaluation.cases[2].expected.noDestructiveDeletion, true);
  assert.equal(evaluation.cases[2].expected.retainRedGreenEvidence, true);
  assert.equal(evaluation.cases[2].expected.noMandatorySeamCeremony, true);
});

test("writing-good-tests companion starts with its title, not captured shell noise", async () => {
  const companion = await readFile(new URL("../../../core/skills/test-driven-development/writing-good-tests.md", import.meta.url), "utf8");
  assert.match(companion, /^# Writing Good Tests\n/u);
  assert.doesNotMatch(companion, /PowerShell_profile|Cannot dot-source/u);
});

test("writing-good-tests keeps its good/bad labels and arrows, and SKILL.md links it", async () => {
  const companion = await readFile(new URL("../../../core/skills/test-driven-development/writing-good-tests.md", import.meta.url), "utf8");
  const skill = await readFile(new URL(`../../../core/skills/${skillId}/SKILL.md`, import.meta.url), "utf8");
  assert.doesNotMatch(companion, /^\/\/ \?/mu);
  assert.doesNotMatch(companion, /[�\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u);
  assert.equal(companion.match(/^\/\/ Bad: /gmu)?.length, 3);
  assert.equal(companion.match(/^\/\/ Good: /gmu)?.length, 3);
  for (const line of ["Cannot name one", "\"The source text changed\"", "Only intentional decisions"]) {
    assert.match(companion, new RegExp(`${line} +-> \\S`, "u"));
  }
  assert.match(companion, /Wrong answers -> test utility\./u);
  assert.doesNotMatch(companion, /all-about-agents:/u);
  assert.match(skill, /\[writing-good-tests\.md\]\(writing-good-tests\.md\)/u);
});
