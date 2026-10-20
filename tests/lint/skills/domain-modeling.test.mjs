import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadCore } from "../../../installers/lib/load-core.mjs";
import { validateSkillArtifacts } from "../../../installers/lib/validate-skill.mjs";

const skillId = "domain-modeling";
const requiredCases = ["DM-TRIGGER-resolve-domain-term","DM-NONTRIGGER-read-vocabulary","DM-PRESSURE-empty-docs-and-trivial-adr","DM-PRESSURE-legacy-context"];
const assets = ["ADR-FORMAT.md","GLOSSARY-FORMAT.md"];

async function readSkill(path = "SKILL.md") {
  try {
    return await readFile(new URL(`../../../core/skills/${skillId}/${path}`, import.meta.url), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") assert.fail(`${skillId} canonical source contract is missing: ${path}`);
    throw error;
  }
}

test("domain-modeling declares its scope and authority contract", async () => {
  const skill = await readSkill();
  assert.match(skill, /GLOSSARY-MAP\.md/u, "map");
  assert.match(skill, /relevant ADR/iu, "ADR");
  assert.match(skill, /passive|merely reading/iu, "nontrigger");
  assert.match(skill, /lazily/iu, "lazy");
  assert.match(skill, /domain vocabulary/iu, "domain");
  assert.match(skill, /implementation details/iu, "implementation");
  assert.match(skill, /hard to reverse/iu, "reverse");
  assert.match(skill, /surprising/iu, "surprise");
  assert.match(skill, /real trade-off/iu, "tradeoff");
  assert.match(skill, /CONTEXT\.md/u, "legacy");
  assert.match(skill, /never silently delete or rename/iu, "legacy safety");
  assert.doesNotMatch(skill, /disable-model-invocation|allowed-tools|openai\.yaml/u);
});

test("domain-modeling preserves observable trigger, nontrigger and pressure cases", async () => {
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

test("domain-modeling loader delivers its complete owned package", async () => {
  const core = await loadCore(process.cwd());
  const skill = core.skills.find((entry) => entry.id === skillId);
  assert.ok(skill, `${skillId} must be discoverable`);
  assert.deepEqual(skill.evaluationCases, requiredCases);
  assert.deepEqual(skill.companions.map((entry) => entry.relativePath), assets);
  const validation = await validateSkillArtifacts({ repositoryRoot: process.cwd(), core, skillId });
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
});

test("domain-modeling formats keep vocabulary and consequential decisions separate", async () => {
  const glossary = await readSkill("GLOSSARY-FORMAT.md");
  const adr = await readSkill("ADR-FORMAT.md");
  assert.match(glossary, /_Avoid_/u);
  assert.match(glossary, /domain-specific/iu);
  assert.match(glossary, /one or two sentences/iu);
  assert.match(adr, /highest.*number/iu);
  assert.match(adr, /real trade-off/iu);
  for (const source of [glossary, adr]) assert.match(source, /5beb35b040e3de97e54fa9e386d7e42d15c295c2/u);
});
