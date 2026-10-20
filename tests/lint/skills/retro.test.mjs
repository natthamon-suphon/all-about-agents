import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadCore } from "../../../installers/lib/load-core.mjs";
import { validateSkillArtifacts } from "../../../installers/lib/validate-skill.mjs";

const skillId = "retro";
const requiredCases = ["RETRO-TRIGGER-environment-retrospective","RETRO-NONTRIGGER-explain-test-error","RETRO-PRESSURE-more-global-prose"];
const assets = [];

async function readSkill(path = "SKILL.md") {
  try {
    return await readFile(new URL(`../../../core/skills/${skillId}/${path}`, import.meta.url), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") assert.fail(`${skillId} canonical source contract is missing: ${path}`);
    throw error;
  }
}

test("retro declares its scope and authority contract", async () => {
  const skill = await readSkill();
  assert.match(skill, /explicit.*(?:retrospective|environment.improvement)/iu, "explicit");
  assert.match(skill, /recommendations/iu, "recommendations");
  assert.match(skill, /existing.*checks/iu, "checks");
  assert.match(skill, /deterministic check/iu, "deterministic");
  assert.match(skill, /navigation/iu, "navigation");
  assert.match(skill, /steering bloat/iu, "bloat");
  assert.match(skill, /tool economy/iu, "economy");
  assert.match(skill, /information access/iu, "access");
  assert.match(skill, /do not change live or global/iu, "authority");
  assert.match(skill, /all history/iu, "history");
  assert.doesNotMatch(skill, /disable-model-invocation|allowed-tools|openai\.yaml/u);
});

test("retro preserves observable trigger, nontrigger and pressure cases", async () => {
  const evaluation = JSON.parse(await readFile(new URL(`../../../core/evals/skill-routing/${skillId}.json`, import.meta.url), "utf8"));
  assert.equal(evaluation.id, `${skillId}-routing`);
  assert.equal(evaluation.skill, skillId);
  assert.deepEqual(evaluation.cases.map((entry) => entry.id), requiredCases);
  assert.equal(evaluation.cases[0].expected.skillCheck, "required");
  assert.equal(evaluation.cases[1].expected.skillCheck, "not-required");
  for (const entry of evaluation.cases) {
    assert.equal(entry.critical, true);
    assert.ok(entry.observables.length >= 1);
  }
});

test("retro loader delivers its complete owned package", async () => {
  const core = await loadCore(process.cwd());
  const skill = core.skills.find((entry) => entry.id === skillId);
  assert.ok(skill, `${skillId} must be discoverable`);
  assert.deepEqual(skill.evaluationCases, requiredCases);
  assert.deepEqual(skill.companions.map((entry) => entry.relativePath), assets);
  const validation = await validateSkillArtifacts({ repositoryRoot: process.cwd(), core, skillId });
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
});
