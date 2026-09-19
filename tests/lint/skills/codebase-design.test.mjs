import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const skillId = "codebase-design";
const requiredCases = ["CD-TRIGGER-interface-seam-decision", "CD-NONTRIGGER-local-rename", "CD-PRESSURE-refactor-everything"];

async function readSkill(relativePath = "SKILL.md") {
  return readFile(new URL(`../../../core/skills/${skillId}/${relativePath}`, import.meta.url), "utf8");
}

test("T037 exposes its routing evidence", async () => {
  const skill = await readSkill();
  const evaluation = JSON.parse(await readFile(new URL(`../../../core/evals/skill-routing/${skillId}.json`, import.meta.url), "utf8"));
  const serialized = JSON.stringify(evaluation);
  assert.match(skill, /^---\n/);
  for (const caseId of requiredCases) assert.match(serialized, new RegExp(caseId));
});

test("codebase-design preserves the deep-module vocabulary and evidence gate", async () => {
  const skill = await readSkill();
  for (const term of ["Module", "Interface", "Implementation", "Depth", "Seam", "Adapter", "Leverage", "Locality"]) {
    assert.match(skill, new RegExp(`\\*\\*${term}\\*\\*`, "u"));
  }
  assert.match(skill, /Skill Gate Protocol/iu);
  assert.match(skill, /caller|call site/iu);
  assert.match(skill, /invariant/iu);
  assert.match(skill, /error mode/iu);
  assert.match(skill, /evidence/iu);
  assert.match(skill, /proportional|smallest sound|local change/iu);
});

test("codebase-design owns its deepening and alternative-design references", async () => {
  const skill = await readSkill();
  const deepening = await readSkill("DEEPENING.md");
  const designTwice = await readSkill("DESIGN-IT-TWICE.md");
  assert.match(skill, /\[DEEPENING\.md\]\(DEEPENING\.md\)/u);
  assert.match(skill, /\[DESIGN-IT-TWICE\.md\]\(DESIGN-IT-TWICE\.md\)/u);
  assert.match(deepening, /in-process/iu);
  assert.match(deepening, /local-substitutable/iu);
  assert.match(deepening, /remote but owned/iu);
  assert.match(deepening, /true external/iu);
  assert.match(deepening, /replace,? do(?:n't| not) layer/iu);
  assert.match(designTwice, /radically different/iu);
  assert.match(designTwice, /depth/iu);
  assert.match(designTwice, /locality/iu);
  assert.match(designTwice, /seam placement/iu);
});

test("codebase-design evaluation makes trigger, nontrigger, and pressure outcomes explicit", async () => {
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
  assert.equal(evaluation.cases[0].expected.compareInterfaces, true);
  assert.equal(evaluation.cases[1].expected.skillCheck, "not-required");
  assert.equal(evaluation.cases[1].expected.localChangeOnly, true);
  assert.equal(evaluation.cases[2].expected.rejectRepositoryWideRefactor, true);
  assert.equal(evaluation.cases[2].expected.requireEvidence, true);
});

test("core loader exposes codebase-design metadata and companion files", async () => {
  const { loadCore } = await import("../../../installers/lib/load-core.mjs");
  const core = await loadCore(process.cwd());
  const skill = core.skills.find((entry) => entry.id === skillId);
  assert.ok(skill);
  assert.equal(skill.name, skillId);
  assert.deepEqual(skill.evaluationCases, requiredCases);
  const inventory = core.inventory.skillSources.find((entry) => entry.name === skillId);
  assert.ok(inventory);
  assert.deepEqual(inventory.assets, ["skills/codebase-design/DEEPENING.md", "skills/codebase-design/DESIGN-IT-TWICE.md"]);
});
