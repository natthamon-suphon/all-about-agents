import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const skillId = "interviewing";
const requiredCases = ["IN-TRIGGER-open-design-decisions", "IN-NONTRIGGER-discoverable-answer", "IN-PRESSURE-ask-many-at-once"];

test("T018 exposes its routing evidence", async () => {
  const skill = await readFile(new URL(`../../../core/skills/${skillId}/SKILL.md`, import.meta.url), "utf8");
  const evaluation = JSON.parse(
    await readFile(new URL(`../../../core/evals/skill-routing/${skillId}.json`, import.meta.url), "utf8"),
  );
  const serialized = JSON.stringify(evaluation);
  assert.match(skill, /^---\n/);
  for (const caseId of requiredCases) assert.match(serialized, new RegExp(caseId));
});

const skillPath = new URL("../../../core/skills/interviewing/SKILL.md", import.meta.url);
const evaluationPath = new URL("../../../core/evals/skill-routing/interviewing.json", import.meta.url);

test("interviewing keeps a concise portable wrapper-owned contract", async () => {
  const skill = await readFile(skillPath, "utf8");
  assert.match(skill, /^---\n/u);
  const closing = skill.indexOf("\n---\n", 4);
  assert.ok(closing > 0, "frontmatter must close");
  const frontmatter = skill.slice(4, closing);
  assert.match(frontmatter, /^name:\s*interviewing\s*$/mu);
  const description = frontmatter.match(/^description:\s*(.+)$/mu)?.[1] ?? "";
  assert.match(description, /^Use when\b/u);
  assert.match(frontmatter, /^evaluationCases:\s*$/mu);
  assert.match(skill, /wrapping skill owns the output/iu);
  assert.match(skill, /brainstorming/iu);
  assert.match(skill, /loop-me/iu);
  assert.match(skill, /Do not make this skill the entry point/iu);
  assert.doesNotMatch(skill, /(?:\.claude|\.codex|\.gemini|spawn_agent|invoke_subagent|mcp__)/iu);
});

test("Skill Gate Protocol discovers facts and filters material decisions", async () => {
  const skill = await readFile(skillPath, "utf8");
  assert.match(skill, /Inspect the request, existing brief, repository evidence/iu);
  assert.match(skill, /Resolve facts that are answerable from those sources[\s\S]*before asking/iu);
  assert.match(skill, /could change scope, behavior, structure,[\s\S]*authorization, destination, or acceptance criteria/iu);
  assert.match(skill, /Skip preferences and[\s\S]*decisions already settled/iu);
  assert.match(skill, /Ask exactly one question in one message/iu);
  assert.match(skill, /attach the answer you recommend/iu);
  assert.match(skill, /Record the decision in the wrapper's artifact immediately/iu);
  assert.match(skill, /Stop when an[\s\S]*implementer can proceed without guessing/iu);
});

test("interviewing evaluation defines three complete critical routing cases", async () => {
  const evaluation = JSON.parse(await readFile(evaluationPath, "utf8"));
  assert.equal(evaluation.schemaVersion, 1);
  assert.equal(evaluation.skill, skillId);
  assert.deepEqual(evaluation.cases.map((entry) => entry.id), requiredCases);
  for (const entry of evaluation.cases) {
    assert.equal(entry.critical, true, `${entry.id} must be critical`);
    assert.equal(typeof entry.prompt, "string");
    assert.equal(typeof entry.expected, "object");
    assert.ok(Array.isArray(entry.observables) && entry.observables.length > 0);
    assert.ok(entry.observables.every((observable) => typeof observable === "string" && observable.trim().length > 0));
  }
  assert.equal(evaluation.cases[0].expected.skillCheck, "required");
  assert.equal(evaluation.cases[0].expected.askOnlyMaterialDecisions, true);
  assert.equal(evaluation.cases[0].expected.stopWhenImplementable, true);
  assert.equal(evaluation.cases[1].expected.skillCheck, "not-required");
  assert.equal(evaluation.cases[1].expected.discoverAnswerableFactsFirst, true);
  assert.equal(evaluation.cases[1].expected.askHuman, false);
  assert.equal(evaluation.cases[2].expected.oneQuestionAtATime, true);
  assert.equal(evaluation.cases[2].expected.batchQuestions, false);
  assert.equal(evaluation.cases[2].expected.inferHumanAnswer, false);
  assert.equal(evaluation.cases[2].expected.pressureResistance, true);
});

test("core loader exposes interviewing metadata and routing links", async () => {
  const { loadCore } = await import("../../../installers/lib/load-core.mjs");
  const core = await loadCore(process.cwd());
  const skill = core.skills.find((entry) => entry.id === skillId);
  assert.ok(skill);
  assert.equal(skill.name, skillId);
  assert.deepEqual(skill.evaluationCases, requiredCases);
  assert.deepEqual(core.evals.find((entry) => entry.id === "interviewing-routing")?.cases.map((entry) => entry.id), requiredCases);
});
