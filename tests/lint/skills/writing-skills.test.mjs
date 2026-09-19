import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const id = "writing-skills";
const cases = ["WS-TRIGGER-create-or-edit-skill", "WS-NONTRIGGER-use-existing-skill", "WS-PRESSURE-prose-only-confidence"];
const companions = [
  "anthropic-best-practices.md",
  "graphviz-conventions.dot",
  "persuasion-principles.md",
  "render-graphs.js",
  "testing-skills-with-subagents.md",
  "examples/CLAUDE_MD_TESTING.md"
];
const read = (name = "SKILL.md") => readFile(new URL(`../../../core/skills/${id}/${name}`, import.meta.url), "utf8");

test("T043 exposes routing evidence", async () => {
  const skill = await read();
  const evaluation = JSON.parse(await readFile(new URL(`../../../core/evals/skill-routing/${id}.json`, import.meta.url), "utf8"));
  assert.match(skill, /^---\n/u);
  for (const value of cases) assert.match(JSON.stringify(evaluation), new RegExp(value));
});

test("skill authoring enforces behavioral RED GREEN REFACTOR and progressive disclosure", async () => {
  const skill = await read();
  for (const term of ["Skill Gate Protocol", "RED", "GREEN", "REFACTOR", "behavior", "routing", "pressure", "progressive disclosure", "not run"]) assert.match(skill, new RegExp(term, "iu"));
  assert.match(skill, /prose.{0,80}(not|isn't|is not).{0,50}(evidence|proof)|confidence.{0,80}behavior/isu);
  for (const companion of companions) assert.match(skill, new RegExp(companion.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
});

test("all inventory companions are concise, routed, and cross-platform", async () => {
  for (const companion of companions) assert.ok((await read(companion)).trim().length > 80, companion);
  const renderer = await read("render-graphs.js");
  assert.match(renderer, /spawnSync|execFileSync/u);
  assert.match(renderer, /process\.platform|GRAPHVIZ_DOT|ENOENT/u);
  assert.doesNotMatch(renderer, /\bwhich\b|\bwhere(?:\.exe)?\b|shell\s*:\s*true|execSync\s*\(/iu);
  assert.match(renderer, /--check|--output-dir|--overwrite/u);
  const historical = await read("anthropic-best-practices.md");
  assert.match(historical, /historical|vendor|re-?verify|current official/iu);
  const persuasion = await read("persuasion-principles.md");
  assert.match(persuasion, /transparent|user autonomy|non-manipulative/iu);
});

test("writing-skills routing distinguishes authoring from ordinary use and prose pressure", async () => {
  const evaluation = JSON.parse(await readFile(new URL(`../../../core/evals/skill-routing/${id}.json`, import.meta.url), "utf8"));
  assert.deepEqual(evaluation.cases.map((entry) => entry.id), cases);
  for (const entry of evaluation.cases) assert.equal(entry.critical, true);
  assert.equal(evaluation.cases[0].expected.skillCheck, "required");
  assert.equal(evaluation.cases[0].expected.behavioralRedGreenRefactor, true);
  assert.equal(evaluation.cases[1].expected.skillCheck, "not-required");
  assert.equal(evaluation.cases[1].expected.existingSkillUseOnly, true);
  assert.equal(evaluation.cases[2].expected.rejectProseOnlyConfidence, true);
  assert.equal(evaluation.cases[2].expected.requireObservedBehavior, true);
});

test("core loader exposes all writing-skill metadata and companions", async () => {
  const { loadCore } = await import("../../../installers/lib/load-core.mjs");
  const core = await loadCore(process.cwd());
  assert.deepEqual(core.skills.find((entry) => entry.id === id)?.evaluationCases, cases);
  const source = core.inventory.skillSources.find((entry) => entry.name === id);
  assert.deepEqual(source?.assets, companions.map((name) => `skills/writing-skills/${name}`));
  assert.deepEqual(source?.scripts, []);
});
