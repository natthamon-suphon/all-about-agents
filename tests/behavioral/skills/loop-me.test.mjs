import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const skillId = "loop-me";
const requiredCases = ["LM-TRIGGER-explicit-workflow-grill", "LM-NONTRIGGER-normal-feature", "LM-PRESSURE-endless-questioning"];

test("T020 exposes its routing evidence", async () => {
  const skill = await readFile(new URL(`../../../core/skills/${skillId}/SKILL.md`, import.meta.url), "utf8");
  const evaluation = JSON.parse(
    await readFile(new URL(`../../../core/evals/skill-routing/${skillId}.json`, import.meta.url), "utf8"),
  );
  const serialized = JSON.stringify(evaluation);
  assert.match(skill, /^---\n/);
  for (const caseId of requiredCases) assert.match(serialized, new RegExp(caseId));
});

const skillPath = new URL("../../../core/skills/loop-me/SKILL.md", import.meta.url);
const evaluationPath = new URL("../../../core/evals/skill-routing/loop-me.json", import.meta.url);

test("loop-me is explicit-invocation-first and keeps ordinary brainstorming separate", async () => {
  const skill = await readFile(skillPath, "utf8");
  assert.match(skill, /^---\n/u);
  const closing = skill.indexOf("\n---\n", 4);
  assert.ok(closing > 0, "frontmatter must close");
  const frontmatter = skill.slice(4, closing);
  assert.match(frontmatter, /^name:\s*loop-me\s*$/mu);
  assert.match(frontmatter, /^description:\s*Use when\b/mu);
  assert.match(frontmatter, /^requiredSkills:\s*$/mu);
  assert.match(frontmatter, /^\s+-\s+interviewing\s*$/mu);
  assert.match(frontmatter, /^evaluationCases:\s*$/mu);
  assert.match(skill, /explicit invocation|explicitly invokes?/iu);
  assert.match(skill, /opt-in/iu);
  assert.match(skill, /normal feature[\s\S]*brainstorming/iu);
  assert.match(skill, /must not route here automatically|do not invoke.*automatically/iu);
  assert.match(skill, /Skill Gate Protocol/iu);
  assert.match(skill, /wrapper owns the workflow specification artifact/iu);
  assert.match(skill, /exactly one material question per message/iu);
  assert.match(skill, /recommendation/iu);
  assert.doesNotMatch(skill, /(?:\.claude|\.codex|\.gemini|mcp__|WebSearch|WebFetch|spawn_agent|invoke_subagent)/iu);
});

test("loop-me has a measurable ready stop and resists endless questioning", async () => {
  const skill = await readFile(skillPath, "utf8");
  assert.match(skill, /Specification-ready stop condition/iu);
  assert.match(skill, /every applicable item[\s\S]*decided/iu);
  assert.match(skill, /unresolved material questions[^\n]*zero|unresolved questions equal zero/iu);
  assert.match(skill, /outcome and non-goals/iu);
  assert.match(skill, /trigger \(event, schedule, or explicitly `none`\)/iu);
  assert.match(skill, /inputs and source of truth/iu);
  assert.match(skill, /ordered actions, owner, and authority boundaries/iu);
  assert.match(skill, /output, destination, and format/iu);
  assert.match(skill, /checkpoints or approvals/iu);
  assert.match(skill, /failure, retry, escalation, and stop behavior/iu);
  assert.match(skill, /verification evidence and acceptance criteria/iu);
  assert.match(skill, /Stop immediately when[\s\S]*specification-ready/iu);
  assert.match(skill, /endless questioning/iu);
  assert.match(skill, /do not reopen|does not reopen/iu);
});

test("loop-me routing evaluation defines three complete critical cases", async () => {
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
  assert.equal(evaluation.cases[0].expected.explicitInvocation, true);
  assert.equal(evaluation.cases[0].expected.oneQuestionAtATime, true);
  assert.equal(evaluation.cases[0].expected.specificationReadyStop, true);
  assert.equal(evaluation.cases[1].expected.skillCheck, "not-required");
  assert.equal(evaluation.cases[1].expected.explicitInvocation, false);
  assert.equal(evaluation.cases[1].expected.autoInvokeLoopMe, false);
  assert.equal(evaluation.cases[1].expected.normalBrainstormingRouting, true);
  assert.equal(evaluation.cases[2].expected.skillCheck, "required");
  assert.equal(evaluation.cases[2].expected.specificationReady, true);
  assert.equal(evaluation.cases[2].expected.unresolvedMaterialQuestions, 0);
  assert.equal(evaluation.cases[2].expected.stopWhenReady, true);
  assert.equal(evaluation.cases[2].expected.endlessQuestioning, false);
  assert.equal(evaluation.cases[2].expected.pressureResistance, true);
});

test("core loader exposes loop-me metadata and routing links", async () => {
  const { loadCore } = await import("../../../installers/lib/load-core.mjs");
  const core = await loadCore(process.cwd());
  const skill = core.skills.find((entry) => entry.id === skillId);
  assert.ok(skill);
  assert.equal(skill.name, skillId);
  assert.deepEqual(skill.evaluationCases, requiredCases);
  assert.deepEqual(core.evals.find((entry) => entry.id === "loop-me-routing")?.cases.map((entry) => entry.id), requiredCases);
});
