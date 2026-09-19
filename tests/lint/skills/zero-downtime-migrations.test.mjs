import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const id = "zero-downtime-migrations";
const cases = ["ZM-TRIGGER-live-schema-migration", "ZM-NONTRIGGER-local-throwaway-db", "ZM-PRESSURE-postgres-universal"];
const read = (name = "SKILL.md") => readFile(new URL(`../../../core/skills/${id}/${name}`, import.meta.url), "utf8");

test("T041 exposes routing evidence", async () => {
  const skill = await read();
  const evaluation = JSON.parse(await readFile(new URL(`../../../core/evals/skill-routing/${id}.json`, import.meta.url), "utf8"));
  assert.match(skill, /^---\n/u);
  for (const value of cases) assert.match(JSON.stringify(evaluation), new RegExp(value));
});

test("migration protocol is portable, measured, and reversible by forward repair", async () => {
  const skill = await read();
  for (const term of ["Skill Gate Protocol", "expand", "migrate", "contract", "compatib", "observ", "rollback", "owner", "invariant"]) assert.match(skill, new RegExp(term, "iu"));
  assert.match(skill, /measur|representative|production evidence/iu);
  assert.match(skill, /forward[- ]fix|forward repair|roll forward/iu);
  assert.match(skill, /not run/iu);
  assert.doesNotMatch(skill, /batch size.{0,30}\b1000\b|must use SERIALIZABLE|always.*down migration|lock_timeout\s*=\s*['"]?5s/iu);
});

test("PostgreSQL companion is conditional and contains no universal mandates", async () => {
  const reference = await read("postgres-expand-contract-examples.md");
  assert.match(reference, /PostgreSQL/iu);
  assert.match(reference, /verify|version|deployment|replication/iu);
  assert.match(reference, /placeholder|measure|derive/iu);
  assert.match(reference, /expand|backfill|contract/iu);
  assert.doesNotMatch(reference, /batch size.{0,30}\b1000\b|must use SERIALIZABLE|always.*down migration|lock_timeout\s*=\s*['"]?5s/iu);
});

test("migration routing covers live changes, disposable nontrigger, and PostgreSQL pressure", async () => {
  const evaluation = JSON.parse(await readFile(new URL(`../../../core/evals/skill-routing/${id}.json`, import.meta.url), "utf8"));
  assert.deepEqual(evaluation.cases.map((entry) => entry.id), cases);
  for (const entry of evaluation.cases) assert.equal(entry.critical, true);
  assert.equal(evaluation.cases[0].expected.skillCheck, "required");
  assert.equal(evaluation.cases[0].expected.expandContract, true);
  assert.equal(evaluation.cases[1].expected.skillCheck, "not-required");
  assert.equal(evaluation.cases[1].expected.disposableOnly, true);
  assert.equal(evaluation.cases[2].expected.rejectUniversalPostgresRecipe, true);
  assert.equal(evaluation.cases[2].expected.measuredConditions, true);
});

test("core loader exposes migration metadata and PostgreSQL companion", async () => {
  const { loadCore } = await import("../../../installers/lib/load-core.mjs");
  const core = await loadCore(process.cwd());
  assert.deepEqual(core.skills.find((entry) => entry.id === id)?.evaluationCases, cases);
  assert.deepEqual(core.inventory.skillSources.find((entry) => entry.name === id)?.assets, ["skills/zero-downtime-migrations/postgres-expand-contract-examples.md"]);
});
