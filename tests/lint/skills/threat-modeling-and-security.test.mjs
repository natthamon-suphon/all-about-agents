import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const id = "threat-modeling-and-security";
const cases = ["TM-TRIGGER-security-boundary-change", "TM-NONTRIGGER-cosmetic-change", "TM-PRESSURE-stack-absolutism"];
const read = (name = "SKILL.md") => readFile(new URL(`../../../core/skills/${id}/${name}`, import.meta.url), "utf8");

test("T040 exposes routing evidence", async () => {
  const skill = await read();
  const evaluation = JSON.parse(await readFile(new URL(`../../../core/evals/skill-routing/${id}.json`, import.meta.url), "utf8"));
  assert.match(skill, /^---\n/u);
  for (const value of cases) assert.match(JSON.stringify(evaluation), new RegExp(value));
});

test("threat modeling derives conditional controls from the actual architecture", async () => {
  const skill = await read();
  for (const term of ["Skill Gate Protocol", "actor", "asset", "trust boundar", "data flow", "entry point", "abuse", "likelihood", "impact", "residual risk", "control owner"]) assert.match(skill, new RegExp(term, "iu"));
  assert.match(skill, /untrusted/iu);
  assert.match(skill, /authorization/iu);
  assert.match(skill, /least privilege/iu);
  assert.match(skill, /not run/iu);
  assert.match(skill, /conditional|when applicable|if the architecture/iu);
  assert.doesNotMatch(skill, /Zod|Pydantic|Redis|SERIALIZABLE|bcrypt.{0,20}12/iu);
});

test("STRIDE companion is portable and rejects stack absolutism", async () => {
  const checklist = await read("stride-checklist.md");
  for (const category of ["Spoofing", "Tampering", "Repudiation", "Information disclosure", "Denial of service", "Elevation of privilege"]) assert.match(checklist, new RegExp(category, "iu"));
  assert.match(checklist, /applicable|actual architecture|evidence/iu);
  assert.match(checklist, /not applicable/iu);
  assert.match(checklist, /residual risk/iu);
  assert.doesNotMatch(checklist, /must use JWT|must use Redis|SERIALIZABLE|Argon2id|RS256/iu);
});

test("threat-model routing covers boundary change, cosmetic nontrigger, and stack pressure", async () => {
  const evaluation = JSON.parse(await readFile(new URL(`../../../core/evals/skill-routing/${id}.json`, import.meta.url), "utf8"));
  assert.deepEqual(evaluation.cases.map((entry) => entry.id), cases);
  for (const entry of evaluation.cases) assert.equal(entry.critical, true);
  assert.equal(evaluation.cases[0].expected.skillCheck, "required");
  assert.equal(evaluation.cases[0].expected.architectureDerivedControls, true);
  assert.equal(evaluation.cases[1].expected.skillCheck, "not-required");
  assert.equal(evaluation.cases[1].expected.cosmeticOnly, true);
  assert.equal(evaluation.cases[2].expected.rejectStackAbsolutism, true);
  assert.equal(evaluation.cases[2].expected.noInventedControl, true);
});

test("core loader exposes threat-model metadata and checklist", async () => {
  const { loadCore } = await import("../../../installers/lib/load-core.mjs");
  const core = await loadCore(process.cwd());
  assert.deepEqual(core.skills.find((entry) => entry.id === id)?.evaluationCases, cases);
  assert.deepEqual(core.inventory.skillSources.find((entry) => entry.name === id)?.assets, ["skills/threat-modeling-and-security/stride-checklist.md"]);
});
