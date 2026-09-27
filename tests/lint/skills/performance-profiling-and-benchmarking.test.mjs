import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const skillId = "performance-profiling-and-benchmarking";
const requiredCases = ["PF-TRIGGER-latency-goal-proof", "PF-NONTRIGGER-no-performance-goal", "PF-PRESSURE-intuition-percentage", "PF-NONTRIGGER-regression-unknown-cause"];
const readSkill = (name = "SKILL.md") => readFile(new URL(`../../../core/skills/${skillId}/${name}`, import.meta.url), "utf8");

test("performance claims require workload-specific baseline, variance, and acceptance evidence", async () => {
  const skill = await readSkill();
  assert.match(skill, /Skill Gate Protocol/iu);
  assert.match(skill, /workload/iu);
  assert.match(skill, /warmup/iu);
  assert.match(skill, /variance|distribution|confidence/iu);
  assert.match(skill, /environment/iu);
  assert.match(skill, /acceptance criteria/iu);
  assert.match(skill, /before.{0,80}after|baseline/isu);
  assert.match(skill, /same conditions|controlled/iu);
  assert.match(skill, /not run/iu);
  assert.doesNotMatch(skill, /at least 5 warm|variance \(>10%\)|wrong 80%|minimum (?:10|20)% improvement/iu);
});

test("profiling recipes are illustrative and avoid universal benchmark parameters", async () => {
  const recipes = await readSkill("profiling-recipes.md");
  assert.match(recipes, /placeholder|adapt|workload-specific/iu);
  assert.match(recipes, /CPU/iu);
  assert.match(recipes, /memory/iu);
  assert.match(recipes, /database/iu);
  assert.match(recipes, /frontend|client/iu);
  assert.match(recipes, /production-like|representative/iu);
  assert.match(recipes, /read-only SELECT|ROLLBACK/iu);
  assert.doesNotMatch(recipes, /-c 100 -d 10|2026-01-01|zero-overhead/iu);
});

test("performance routing covers a goal proof, non-goals, and intuition pressure", async () => {
  const skill = await readSkill();
  const evaluation = JSON.parse(await readFile(new URL(`../../../core/evals/skill-routing/${skillId}.json`, import.meta.url), "utf8"));
  assert.equal(evaluation.schemaVersion, 1);
  assert.deepEqual(evaluation.cases.map((entry) => entry.id), requiredCases);
  for (const entry of evaluation.cases) assert.equal(entry.critical, true);
  assert.equal(evaluation.cases[0].expected.skillCheck, "required");
  assert.equal(evaluation.cases[0].expected.workloadSpecificBaseline, true);
  assert.equal(evaluation.cases[1].expected.skillCheck, "not-required");
  assert.equal(evaluation.cases[1].expected.noOptimizationClaim, true);
  assert.equal(evaluation.cases[2].expected.rejectIntuitionClaim, true);
  assert.equal(evaluation.cases[2].expected.noInventedPercentage, true);
  assert.equal(evaluation.cases[3].expected.skillCheck, "not-required");
  assert.equal(evaluation.cases[3].expected.routeTo, "systematic-debugging");
  const description = /^description:\s*(.+)$/mu.exec(skill)?.[1] ?? "";
  assert.doesNotMatch(description, /investigating a performance regression/iu);
  assert.match(description, /systematic-debugging/u);
});

test("core loader exposes performance metadata and recipes", async () => {
  const { loadCore } = await import("../../../installers/lib/load-core.mjs");
  const core = await loadCore(process.cwd());
  assert.deepEqual(core.skills.find((entry) => entry.id === skillId)?.evaluationCases, requiredCases);
  assert.deepEqual(core.inventory.skillSources.find((entry) => entry.name === skillId)?.assets, ["skills/performance-profiling-and-benchmarking/profiling-recipes.md"]);
});

test("performance skill names the debugging boundary and uses correct profiler command shapes", async () => {
  const skill = await readSkill();
  const recipes = await readSkill("profiling-recipes.md");
  assert.match(skill, /A failure or regression with an unknown cause goes to `systematic-debugging` first; measuring, profiling, or proving a performance change goes to `performance-profiling-and-benchmarking`\./u);
  assert.match(recipes, /--cpu-prof-dir=<DIR> --cpu-prof-name=<FILE>\.cpuprofile/u);
  assert.doesNotMatch(recipes, /--cpu-prof-name=<PROFILE_PATH>/u);
  assert.match(recipes, /py-spy[\s\S]*macOS[\s\S]*elevated rights/u);
});
