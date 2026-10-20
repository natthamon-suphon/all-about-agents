import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadCore } from "../../../installers/lib/load-core.mjs";
import { validateSkillArtifacts } from "../../../installers/lib/validate-skill.mjs";

const skillId = "diagnosing-agent-workflows";
const requiredCases = ["DAW-TRIGGER-repeated-work","DAW-NONTRIGGER-app-bug","DAW-PRESSURE-private-sweep","DAW-PRESSURE-record-injection","DAW-PRESSURE-made-up-cost"];
const assets = ["references/context-safety.md","references/report.md"];

async function readSkill(path = "SKILL.md") {
  try {
    return await readFile(new URL(`../../../core/skills/${skillId}/${path}`, import.meta.url), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") assert.fail(`${skillId} canonical source contract is missing: ${path}`);
    throw error;
  }
}

test("diagnosing-agent-workflows declares its scope and authority contract", async () => {
  const skill = await readSkill();
  assert.match(skill, /application\s+bug/iu, "nontrigger");
  assert.match(skill, /verified[\s\S]*(?:path|source)/iu, "verified");
  assert.match(skill, /path:line/u, "citation");
  assert.match(skill, /bounded/iu, "bounded");
  assert.match(skill, /read-only/iu, "readonly");
  assert.match(skill, /parent.*hook.*tool/isu, "origins");
  assert.match(skill, /do not guess/iu, "no guesses");
  assert.match(skill, /home/iu, "home");
  assert.match(skill, /no.*(?:archive|export|upload)/iu, "external");
  assert.match(skill, /context-safety\.md/u, "safety");
  assert.match(skill, /report\.md/u, "report");
  assert.doesNotMatch(skill, /disable-model-invocation|allowed-tools|openai\.yaml/u);
});

test("diagnosing-agent-workflows preserves observable trigger, nontrigger and pressure cases", async () => {
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

test("diagnosing-agent-workflows loader delivers its complete owned package", async () => {
  const core = await loadCore(process.cwd());
  const skill = core.skills.find((entry) => entry.id === skillId);
  assert.ok(skill, `${skillId} must be discoverable`);
  assert.deepEqual(skill.evaluationCases, requiredCases);
  assert.deepEqual(skill.companions.map((entry) => entry.relativePath), assets);
  const validation = await validateSkillArtifacts({ repositoryRoot: process.cwd(), core, skillId });
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
});

test("diagnosing-agent-workflows bounds untrusted records and evidence output", async () => {
  const safety = await readSkill("references/context-safety.md");
  const report = await readSkill("references/report.md");
  assert.match(safety, /measure.*before/isu);
  assert.match(safety, /500 characters/iu);
  assert.match(safety, /200 characters/iu);
  assert.match(safety, /instructions.*data|data.*instructions/isu);
  assert.match(safety, /secret/iu);
  assert.match(safety, /stream/iu);
  assert.match(safety, /unknown/iu);
  assert.match(report, /historical/iu);
  assert.match(report, /counter semantics/iu);
  assert.match(report, /coverage/iu);
  assert.match(safety, /bb92a77741419a4ab5f06e711a283343f1ada0c3/u);
});
