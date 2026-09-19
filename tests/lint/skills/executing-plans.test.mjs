import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const skillId = "executing-plans";
const requiredCases = [
  "EP-TRIGGER-approved-plan-inline",
  "EP-NONTRIGGER-no-plan",
  "EP-PRESSURE-skip-review-gate"
];

test("T024 exposes its routing evidence", async () => {
  const skill = await readFile(new URL(`../../../core/skills/${skillId}/SKILL.md`, import.meta.url), "utf8");
  const evaluation = JSON.parse(
    await readFile(new URL(`../../../core/evals/skill-routing/${skillId}.json`, import.meta.url), "utf8"),
  );
  const serialized = JSON.stringify(evaluation);
  assert.match(skill, /^---\n/);
  for (const caseId of requiredCases) assert.match(serialized, new RegExp(caseId));
});

const skillPath = new URL("../../../core/skills/executing-plans/SKILL.md", import.meta.url);
const evaluationPath = new URL("../../../core/evals/skill-routing/executing-plans.json", import.meta.url);

test("executing-plans requires an explicitly approved executable plan", async () => {
  const skill = await readFile(skillPath, "utf8");
  assert.match(skill, /^---\n/u);
  const closing = skill.indexOf("\n---\n", 4);
  assert.ok(closing > 0, "frontmatter must close");
  const frontmatter = skill.slice(4, closing);
  assert.match(frontmatter, /^name:\s*executing-plans\s*$/mu);
  assert.match(frontmatter, /^description:\s*Use when\b/mu);
  assert.match(frontmatter, /^evaluationCases:\s*$/mu);
  assert.match(skill, /approved (?:implementation )?plan/iu);
  assert.match(skill, /before (?:starting|executing|beginning)/iu);
  assert.match(skill, /do not (?:execute|start|begin) .*plan/iu);
  assert.match(skill, /return to|hand back|writing-plans/iu);
  assert.match(skill, /Skill Gate Protocol/iu);
  assert.doesNotMatch(skill, /(?:\.claude|\.codex|\.gemini|mcp__|WebSearch|WebFetch|spawn_agent|invoke_subagent)/iu);
});

test("executing-plans uses evidence-based resume-safe checkpoints and review gates", async () => {
  const skill = await readFile(skillPath, "utf8");
  assert.match(skill, /checkpoint/iu);
  assert.match(skill, /resume|resumable/iu);
  assert.match(skill, /evidence|verification/iu);
  assert.match(skill, /review gate|review checkpoint/iu);
  assert.match(skill, /in.progress|in progress/iu);
  assert.match(skill, /completed/iu);
  assert.match(skill, /do not .*skip.*review|never skip.*review|preserve.*review/isu);
});

test("executing-plans preserves Git and dependency authority", async () => {
  const skill = await readFile(skillPath, "utf8");
  assert.match(skill, /commit/iu);
  assert.match(skill, /dependency/iu);
  assert.match(skill, /explicit(?:ly)? user|user(?:'s)? explicit/iu);
  assert.match(skill, /only when|unless.*authori[sz]|authority/iu);
  assert.match(skill, /preserve.*(?:uncommitted|working tree)|uncommitted.*(?:preserve|untouched)/isu);
  assert.doesNotMatch(skill, /(?:mandatory|required|must)[^\n]{0,80}commit/iu);
  assert.doesNotMatch(skill, /commit[^\n]{0,80}(?:mandatory|required|must)/iu);
  assert.match(skill, /(?:automatically|automatic)[^\n]{0,80}(?:commit|install)/iu);
});

test("executing-plans routing evaluation defines three complete critical cases", async () => {
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
  assert.equal(evaluation.cases[0].expected.approvedPlan, true);
  assert.equal(evaluation.cases[0].expected.inlineExecution, true);
  assert.equal(evaluation.cases[0].expected.resumeSafeCheckpoints, true);
  assert.equal(evaluation.cases[0].expected.reviewGates, true);
  assert.equal(evaluation.cases[1].expected.skillCheck, "not-required");
  assert.equal(evaluation.cases[1].expected.approvedPlan, false);
  assert.equal(evaluation.cases[1].expected.noExecution, true);
  assert.equal(evaluation.cases[1].expected.returnToPlanning, true);
  assert.equal(evaluation.cases[2].expected.skillCheck, "required");
  assert.equal(evaluation.cases[2].expected.preserveReviewGates, true);
  assert.equal(evaluation.cases[2].expected.noAutomaticCommit, true);
  assert.equal(evaluation.cases[2].expected.noDependencyInstallAssumption, true);
});

test("core loader exposes executing-plans metadata and routing links", async () => {
  const { loadCore } = await import("../../../installers/lib/load-core.mjs");
  const core = await loadCore(process.cwd());
  const skill = core.skills.find((entry) => entry.id === skillId);
  assert.ok(skill);
  assert.equal(skill.name, skillId);
  assert.deepEqual(skill.evaluationCases, requiredCases);
  assert.deepEqual(core.evals.find((entry) => entry.id === "executing-plans-routing")?.cases.map((entry) => entry.id), requiredCases);
});
