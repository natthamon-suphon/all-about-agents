import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const skillId = "research";
const requiredCases = ["RE-TRIGGER-volatile-vendor-contract", "RE-NONTRIGGER-local-code-fact", "RE-PRESSURE-no-subagent-available"];

test("T019 exposes its routing evidence", async () => {
  const skill = await readFile(new URL(`../../../core/skills/${skillId}/SKILL.md`, import.meta.url), "utf8");
  const evaluation = JSON.parse(
    await readFile(new URL(`../../../core/evals/skill-routing/${skillId}.json`, import.meta.url), "utf8"),
  );
  const serialized = JSON.stringify(evaluation);
  assert.match(skill, /^---\n/);
  for (const caseId of requiredCases) assert.match(serialized, new RegExp(caseId));
});

const skillPath = new URL("../../../core/skills/research/SKILL.md", import.meta.url);
const evaluationPath = new URL("../../../core/evals/skill-routing/research.json", import.meta.url);

test("research keeps external fact-finding primary-source and citation bounded", async () => {
  const skill = await readFile(skillPath, "utf8");
  assert.match(skill, /^---\n/u);
  const closing = skill.indexOf("\n---\n", 4);
  assert.ok(closing > 0, "frontmatter must close");
  const frontmatter = skill.slice(4, closing);
  assert.match(frontmatter, /^name:\s*research\s*$/mu);
  const description = frontmatter.match(/^description:\s*(.+)$/mu)?.[1] ?? "";
  assert.match(description, /^Use when\b/u);
  assert.match(frontmatter, /^evaluationCases:\s*$/mu);
  assert.match(skill, /external|current fact/iu);
  assert.match(skill, /primary sources/iu);
  assert.match(skill, /cite every claim/iu);
  assert.match(skill, /coordinator[\s\S]*researches?\s+directly|researches?\s+directly[\s\S]*coordinator/iu);
  assert.match(skill, /unavailable|disallowed/iu);
  assert.match(skill, /unconfirmed|could not confirm|explicit gap/iu);
  assert.match(skill, /Skill Gate Protocol/iu);
  assert.doesNotMatch(skill, /(?:\.claude|\.codex|\.gemini|mcp__|WebSearch|WebFetch|spawn_agent|invoke_subagent)/iu);
});

test("research routing evaluation defines three complete critical cases", async () => {
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
  assert.equal(evaluation.cases[0].expected.primarySources, true);
  assert.equal(evaluation.cases[0].expected.citations, true);
  assert.equal(evaluation.cases[1].expected.skillCheck, "not-required");
  assert.equal(evaluation.cases[1].expected.localDiscoveryFirst, true);
  assert.equal(evaluation.cases[1].expected.externalResearch, false);
  assert.equal(evaluation.cases[2].expected.skillCheck, "required");
  assert.equal(evaluation.cases[2].expected.coordinatorResearchFallback, true);
  assert.equal(evaluation.cases[2].expected.fabricatedDelegation, false);
  assert.equal(evaluation.cases[2].expected.explicitGaps, true);
});

test("research core metadata links its evaluation cases", async () => {
  const { loadCore } = await import("../../../installers/lib/load-core.mjs");
  const core = await loadCore(process.cwd());
  const skill = core.skills.find((entry) => entry.id === skillId);
  assert.ok(skill);
  assert.equal(skill.name, skillId);
  assert.deepEqual(skill.evaluationCases, requiredCases);
  assert.deepEqual(core.evals.find((entry) => entry.id === "research-routing")?.cases.map((entry) => entry.id), requiredCases);
});
