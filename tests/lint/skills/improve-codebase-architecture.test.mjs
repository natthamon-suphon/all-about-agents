import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const skillId = "improve-codebase-architecture";
const requiredCases = ["IA-TRIGGER-explicit-architecture-survey", "IA-NONTRIGGER-fix-one-bug", "IA-PRESSURE-require-HTML"];

async function readSkill(relativePath = "SKILL.md") {
  return readFile(new URL(`../../../core/skills/${skillId}/${relativePath}`, import.meta.url), "utf8");
}

test("T038 exposes its routing evidence", async () => {
  const skill = await readSkill();
  const evaluation = JSON.parse(await readFile(new URL(`../../../core/evals/skill-routing/${skillId}.json`, import.meta.url), "utf8"));
  const serialized = JSON.stringify(evaluation);
  assert.match(skill, /^---\n/);
  for (const caseId of requiredCases) assert.match(serialized, new RegExp(caseId));
});

test("architecture improvement is an evidence-first survey with a design boundary", async () => {
  const skill = await readSkill();
  assert.match(skill, /Skill Gate Protocol/iu);
  assert.match(skill, /explicit(?:ly)? (?:ask|request|invoke)|user-invoked/iu);
  assert.match(skill, /scope/iu);
  assert.match(skill, /recent|hot spot|change history/iu);
  assert.match(skill, /deletion test/iu);
  assert.match(skill, /caller/iu);
  assert.match(skill, /evidence/iu);
  assert.match(skill, /do not implement|not implementation authority|separate approval/iu);
  assert.match(skill, /codebase-design/iu);
});

test("plain Markdown is complete and HTML is optional without blocking analysis", async () => {
  const skill = await readSkill();
  const html = await readSkill("HTML-REPORT.md");
  assert.match(skill, /plain Markdown/iu);
  assert.match(skill, /HTML.{0,80}optional|optional.{0,80}HTML/isu);
  assert.match(skill, /must not block|do not block|never block/iu);
  assert.match(skill, /Files/iu);
  assert.match(skill, /Problem/iu);
  assert.match(skill, /Evidence/iu);
  assert.match(skill, /Recommendation strength/iu);
  assert.match(skill, /Top recommendation/iu);
  assert.match(skill, /\[HTML-REPORT\.md\]\(HTML-REPORT\.md\)/u);
  assert.match(html, /optional/iu);
  assert.match(html, /escape|untrusted/iu);
  assert.match(html, /offline|CDN/iu);
  assert.match(html, /Markdown/iu);
});

test("architecture improvement evaluation covers survey, bug-fix nontrigger, and required-HTML pressure", async () => {
  const evaluation = JSON.parse(await readFile(new URL(`../../../core/evals/skill-routing/${skillId}.json`, import.meta.url), "utf8"));
  assert.equal(evaluation.schemaVersion, 1);
  assert.equal(evaluation.id, `${skillId}-routing`);
  assert.equal(evaluation.skill, skillId);
  assert.deepEqual(evaluation.cases.map((entry) => entry.id), requiredCases);
  for (const entry of evaluation.cases) {
    assert.equal(entry.critical, true, `${entry.id} must be critical`);
    assert.ok(Array.isArray(entry.observables) && entry.observables.length > 0);
  }
  assert.equal(evaluation.cases[0].expected.skillCheck, "required");
  assert.equal(evaluation.cases[0].expected.architectureSurvey, true);
  assert.equal(evaluation.cases[1].expected.skillCheck, "not-required");
  assert.equal(evaluation.cases[1].expected.fixOnly, true);
  assert.equal(evaluation.cases[2].expected.markdownFallback, true);
  assert.equal(evaluation.cases[2].expected.htmlOptional, true);
  assert.equal(evaluation.cases[2].expected.analysisNotBlocked, true);
});

test("core loader exposes architecture-improvement metadata and its HTML companion", async () => {
  const { loadCore } = await import("../../../installers/lib/load-core.mjs");
  const core = await loadCore(process.cwd());
  const skill = core.skills.find((entry) => entry.id === skillId);
  assert.ok(skill);
  assert.deepEqual(skill.evaluationCases, requiredCases);
  const inventory = core.inventory.skillSources.find((entry) => entry.name === skillId);
  assert.deepEqual(inventory.assets, ["skills/improve-codebase-architecture/HTML-REPORT.md"]);
});
