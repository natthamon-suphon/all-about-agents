import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const skillId = "writing-plans";
const requiredCases = ["WP-TRIGGER-approved-multistep-spec", "WP-NONTRIGGER-unapproved-design", "WP-PRESSURE-auto-commit"];

test("T023 exposes its routing evidence", async () => {
  const skill = await readFile(new URL(`../../../core/skills/${skillId}/SKILL.md`, import.meta.url), "utf8");
  const evaluation = JSON.parse(
    await readFile(new URL(`../../../core/evals/skill-routing/${skillId}.json`, import.meta.url), "utf8"),
  );
  const serialized = JSON.stringify(evaluation);
  assert.match(skill, /^---\n/);
  for (const caseId of requiredCases) assert.match(serialized, new RegExp(caseId));
});

const skillPath = new URL("../../../core/skills/writing-plans/SKILL.md", import.meta.url);
const evaluationPath = new URL("../../../core/evals/skill-routing/writing-plans.json", import.meta.url);

test("writing-plans requires an explicitly approved design or specification", async () => {
  const skill = await readFile(skillPath, "utf8");
  assert.match(skill, /^---\n/u);
  const closing = skill.indexOf("\n---\n", 4);
  assert.ok(closing > 0, "frontmatter must close");
  const frontmatter = skill.slice(4, closing);
  assert.match(frontmatter, /^name:\s*writing-plans\s*$/mu);
  assert.match(frontmatter, /^description:\s*Use when\b/mu);
  assert.match(frontmatter, /^evaluationCases:\s*$/mu);
  assert.match(skill, /approved (?:design|specification)|approved design or specification/iu);
  assert.match(skill, /before (?:writing|creating) (?:the )?(?:implementation )?plan/iu);
  assert.match(skill, /do not (?:write|create|start) (?:the )?(?:implementation )?plan/iu);
  assert.match(skill, /return to|hand back|brainstorming/iu);
  assert.match(skill, /Skill Gate Protocol/iu);
  assert.doesNotMatch(skill, /(?:\.claude|\.codex|\.gemini|mcp__|WebSearch|WebFetch|spawn_agent|invoke_subagent)/iu);
});

test("writing-plans makes interfaces and test evidence exact", async () => {
  const skill = await readFile(skillPath, "utf8");
  assert.match(skill, /exact (?:file )?paths?/iu);
  assert.match(skill, /exact (?:interface|signature)/iu);
  assert.match(skill, /consumes/iu);
  assert.match(skill, /produces/iu);
  assert.match(skill, /parameter(?:s)?[\s,]*(?:and|&)\s*return types?/iu);
  assert.match(skill, /failing test|RED/iu);
  assert.match(skill, /run (?:the )?(?:focused )?test|test command/iu);
  assert.match(skill, /expected:.*(?:fail|pass)|expected.*(?:fail|pass)/isu);
  assert.match(skill, /verification evidence/iu);
  assert.match(skill, /no placeholders|placeholder/iu);
});

test("writing-plans preserves Git authority and does not mandate commits", async () => {
  const skill = await readFile(skillPath, "utf8");
  assert.match(skill, /commit/iu);
  assert.match(skill, /explicit(?:ly)? user|user(?:'s)? explicit/iu);
  assert.match(skill, /only when|unless.*authori[sz]|authority/iu);
  assert.match(skill, /preserve.*(?:uncommitted|working tree)|uncommitted.*(?:preserve|untouched)/isu);
  assert.doesNotMatch(skill, /(?:mandatory|required|must)[^\n]{0,80}commit/iu);
  assert.doesNotMatch(skill, /commit[^\n]{0,80}(?:mandatory|required|must)/iu);
  assert.doesNotMatch(skill, /git\s+commit/iu);
});

test("writing-plans routing evaluation defines three complete critical cases", async () => {
  const evaluation = JSON.parse(await readFile(evaluationPath, "utf8"));
  assert.equal(evaluation.schemaVersion, 1);
  assert.equal(evaluation.skill, skillId);
  assert.deepEqual(evaluation.cases.map((entry) => entry.id), requiredCases);
  for (const entry of evaluation.cases) {
    assert.equal(entry.critical, true, `${entry.id} must be critical`);
    assert.equal(typeof entry.prompt, "string");
    assert.doesNotMatch(entry.prompt, /writing-plans|\bskill\b/iu, `${entry.id} prompt must not name the skill`);
    assert.equal(typeof entry.expected, "object");
    assert.ok(Array.isArray(entry.observables) && entry.observables.length > 0);
    assert.ok(entry.observables.every((observable) => typeof observable === "string" && observable.trim().length > 0));
  }
  assert.equal(evaluation.cases[0].expected.skillCheck, "required");
  assert.equal(evaluation.cases[0].expected.approvedDesign, true);
  assert.equal(evaluation.cases[0].expected.executablePlan, true);
  assert.equal(evaluation.cases[0].expected.exactInterfaces, true);
  assert.equal(evaluation.cases[0].expected.testEvidence, true);
  assert.equal(evaluation.cases[1].expected.skillCheck, "not-required");
  assert.equal(evaluation.cases[1].expected.approvedDesign, false);
  assert.equal(evaluation.cases[1].expected.returnToDesign, true);
  assert.equal(evaluation.cases[2].expected.skillCheck, "required");
  assert.equal(evaluation.cases[2].expected.noAutomaticCommit, true);
  assert.equal(evaluation.cases[2].expected.explicitGitAuthority, true);
  assert.equal(evaluation.cases[2].expected.preserveUncommittedWork, true);
});

test("core loader exposes writing-plans metadata and routing links", async () => {
  const { loadCore } = await import("../../../installers/lib/load-core.mjs");
  const core = await loadCore(process.cwd());
  const skill = core.skills.find((entry) => entry.id === skillId);
  assert.ok(skill);
  assert.equal(skill.name, skillId);
  assert.deepEqual(skill.evaluationCases, requiredCases);
  assert.deepEqual(core.evals.find((entry) => entry.id === "writing-plans-routing")?.cases.map((entry) => entry.id), requiredCases);
});

test("writing-plans names test commands without running them and links its reviewer prompt", async () => {
  const skill = await readFile(skillPath, "utf8");
  const flat = skill.replace(/\s+/gu, " ");
  const reviewer = (await readFile(new URL("../../../core/skills/writing-plans/plan-document-reviewer-prompt.md", import.meta.url), "utf8")).replace(/\s+/gu, " ");
  assert.doesNotMatch(flat, /Run the focused test command and record/iu);
  assert.match(flat, /names the focused test command and the expected RED\/GREEN result that the executor records as verification evidence/u);
  assert.match(flat, /Planning runs no tests/u);
  assert.match(flat, /\[plan-document-reviewer-prompt\.md\]\(plan-document-reviewer-prompt\.md\)/u);
  assert.match(flat, /`Approved` is not human plan approval/u);
  assert.match(reviewer, /`Approved` is not human plan approval/u);
  assert.doesNotMatch(flat, /exact file paths and exact portable paths/iu);
  assert.doesNotMatch(flat, /Record parameters and return types for every interface/iu);
});
