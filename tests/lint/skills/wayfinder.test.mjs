import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const skillId = "wayfinder";
const requiredCases = ["WF-TRIGGER-unclear-multi-session-route", "WF-NONTRIGGER-approved-plan", "WF-PRESSURE-no-issue-tracker"];

test("T022 exposes its routing evidence", async () => {
  const skill = await readFile(new URL(`../../../core/skills/${skillId}/SKILL.md`, import.meta.url), "utf8");
  const evaluation = JSON.parse(
    await readFile(new URL(`../../../core/evals/skill-routing/${skillId}.json`, import.meta.url), "utf8"),
  );
  const serialized = JSON.stringify(evaluation);
  assert.match(skill, /^---\n/);
  for (const caseId of requiredCases) assert.match(serialized, new RegExp(caseId));
});

const skillPath = new URL("../../../core/skills/wayfinder/SKILL.md", import.meta.url);
const evaluationPath = new URL("../../../core/evals/skill-routing/wayfinder.json", import.meta.url);

test("wayfinder routes only unclear multi-session efforts", async () => {
  const skill = await readFile(skillPath, "utf8");
  const closing = skill.indexOf("\n---\n", 4);
  assert.ok(closing > 0, "frontmatter must close");
  const frontmatter = skill.slice(4, closing);
  assert.match(frontmatter, /^name:\s*wayfinder\s*$/mu);
  assert.match(frontmatter, /^description:\s*Use when\b/mu);
  assert.match(frontmatter, /^evaluationCases:\s*$/mu);
  assert.match(skill, /multi-session/iu);
  assert.match(skill, /route is still unclear|route is unclear/iu);
  assert.match(skill, /material decisions|unresolved/iu);
  assert.match(skill, /approved,? bounded.*plan|approved.*executable.*plan/iu);
  assert.match(skill, /non-trigger|do not route.*plan|do not invoke.*wayfinder/iu);
  assert.match(skill, /Skill Gate Protocol/iu);
  assert.doesNotMatch(skill, /(?:\.codex|\.gemini|mcp__|WebSearch|WebFetch|spawn_agent|invoke_subagent)/iu);
});

test("wayfinder provides a durable local-markdown fallback under tracker pressure", async () => {
  const skill = await readFile(skillPath, "utf8");
  assert.match(skill, /issue tracker/iu);
  assert.match(skill, /local-markdown tracker/iu);
  assert.match(skill, /no setup or dependency|no dependency/iu);
  assert.match(skill, /\.claude\/all-about-agents\/<topic>\/MAP\.md/iu);
  assert.match(skill, /tickets\/.*\.md/iu);
  assert.match(skill, /Blocked by:/u);
  assert.match(skill, /Claimed:/u);
  assert.match(skill, /never assume|do not assume|never invent/iu);
  assert.match(skill, /pressure|urgency/iu);
});

test("wayfinder gate protocol claims and resolves one named frontier ticket", async () => {
  const skill = await readFile(skillPath, "utf8");
  assert.match(skill, /destination/iu);
  assert.match(skill, /frontier/iu);
  assert.match(skill, /breadth-first/iu);
  assert.match(skill, /claim.*before work|before work.*claim/iu);
  assert.match(skill, /at most one ticket per session|one ticket per session/iu);
  assert.match(skill, /record the answer|ticket resolution/iu);
  assert.match(skill, /close the ticket/iu);
  assert.match(skill, /writing-plans/iu);
});

test("wayfinder routing evaluation defines three complete critical cases", async () => {
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
  assert.equal(evaluation.cases[0].expected.multiSession, true);
  assert.equal(evaluation.cases[0].expected.routeUnclear, true);
  assert.equal(evaluation.cases[0].expected.decisionMap, true);
  assert.equal(evaluation.cases[1].expected.skillCheck, "not-required");
  assert.equal(evaluation.cases[1].expected.approvedPlan, true);
  assert.equal(evaluation.cases[1].expected.avoidWayfinder, true);
  assert.equal(evaluation.cases[2].expected.skillCheck, "required");
  assert.equal(evaluation.cases[2].expected.noIssueTracker, true);
  assert.equal(evaluation.cases[2].expected.durableLocalMap, true);
  assert.equal(evaluation.cases[2].expected.noExternalAssumption, true);
  assert.equal(evaluation.cases[2].expected.pressureResistance, true);
});

test("core loader exposes wayfinder metadata and routing links", async () => {
  const { loadCore } = await import("../../../installers/lib/load-core.mjs");
  const core = await loadCore(process.cwd());
  const skill = core.skills.find((entry) => entry.id === skillId);
  assert.ok(skill);
  assert.equal(skill.name, skillId);
  assert.deepEqual(skill.evaluationCases, requiredCases);
  assert.deepEqual(core.evals.find((entry) => entry.id === "wayfinder-routing")?.cases.map((entry) => entry.id), requiredCases);
});
