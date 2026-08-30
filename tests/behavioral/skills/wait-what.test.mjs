import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const skillId = "wait-what";
const requiredCases = [
  "WW-TRIGGER-user-says-did-not-land",
  "WW-NONTRIGGER-first-explanation",
  "WW-PRESSURE-language-switch"
];

test("T021 exposes its routing evidence", async () => {
  const skill = await readFile(new URL(`../../../core/skills/${skillId}/SKILL.md`, import.meta.url), "utf8");
  const evaluation = JSON.parse(
    await readFile(new URL(`../../../core/evals/skill-routing/${skillId}.json`, import.meta.url), "utf8"),
  );
  const serialized = JSON.stringify(evaluation);
  assert.match(skill, /^---\n/);
  for (const caseId of requiredCases) assert.match(serialized, new RegExp(caseId));
});

const skillPath = new URL("../../../core/skills/wait-what/SKILL.md", import.meta.url);
const evaluationPath = new URL("../../../core/evals/skill-routing/wait-what.json", import.meta.url);

test("wait-what requires an explicit non-landing signal before re-pitching", async () => {
  const skill = await readFile(skillPath, "utf8");
  assert.match(skill, /^---\n/u);
  const closing = skill.indexOf("\n---\n", 4);
  assert.ok(closing > 0, "frontmatter must close");
  const frontmatter = skill.slice(4, closing);
  assert.match(frontmatter, /^name:\s*wait-what\s*$/mu);
  assert.match(frontmatter, /^description:\s*Use when\b/mu);
  assert.match(frontmatter, /^evaluationCases:\s*$/mu);
  assert.match(skill, /explicit non-landing signal|explicitly says.*did not land/iu);
  assert.match(skill, /first explanation/iu);
  assert.match(skill, /do not re-pitch|does not re-pitch|must not re-pitch/iu);
  assert.match(skill, /Skill Gate Protocol/iu);
  assert.match(skill, /context.*missing|missing.*context/iu);
  assert.match(skill, /concrete example/iu);
  assert.match(skill, /do not defend|don't defend/iu);
  assert.match(skill, /do not apologize|don't apologize|without apologizing/iu);
  assert.doesNotMatch(skill, /(?:\.claude|\.codex|\.gemini|mcp__|WebSearch|WebFetch|spawn_agent|invoke_subagent)/iu);
});

test("wait-what preserves the session language under pressure", async () => {
  const skill = await readFile(skillPath, "utf8");
  assert.match(skill, /preserve|keep|same/iu);
  assert.match(skill, /session language|language of the conversation/iu);
  assert.match(skill, /do not (?:switch|force).*English|without forcing English/iu);
  assert.match(skill, /concrete example/iu);
  assert.match(skill, /pressure|insist|urgency/iu);
});

test("wait-what routing evaluation defines three complete critical cases", async () => {
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
  assert.equal(evaluation.cases[0].expected.explicitNonLandingSignal, true);
  assert.equal(evaluation.cases[0].expected.rePitch, true);
  assert.equal(evaluation.cases[0].expected.concreteExample, true);
  assert.equal(evaluation.cases[0].expected.defendOriginal, false);
  assert.equal(evaluation.cases[1].expected.skillCheck, "not-required");
  assert.equal(evaluation.cases[1].expected.firstExplanation, true);
  assert.equal(evaluation.cases[1].expected.autoRePitch, false);
  assert.equal(evaluation.cases[1].expected.normalResponse, true);
  assert.equal(evaluation.cases[2].expected.skillCheck, "required");
  assert.equal(evaluation.cases[2].expected.preserveSessionLanguage, true);
  assert.equal(evaluation.cases[2].expected.forceEnglish, false);
  assert.equal(evaluation.cases[2].expected.concreteExample, true);
  assert.equal(evaluation.cases[2].expected.pressureResistance, true);
});

test("core loader exposes wait-what metadata and routing links", async () => {
  const { loadCore } = await import("../../../installers/lib/load-core.mjs");
  const core = await loadCore(process.cwd());
  const skill = core.skills.find((entry) => entry.id === skillId);
  assert.ok(skill);
  assert.equal(skill.name, skillId);
  assert.deepEqual(skill.evaluationCases, requiredCases);
  assert.deepEqual(core.evals.find((entry) => entry.id === "wait-what-routing")?.cases.map((entry) => entry.id), requiredCases);
});
