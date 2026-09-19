import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const skillId = "dispatching-parallel-agents";
const requiredCases = ["DP-TRIGGER-two-independent-reads", "DP-NONTRIGGER-shared-state", "DP-PRESSURE-tool-unavailable"];

test("T026 exposes its routing evidence", async () => {
  const skill = await readFile(new URL(`../../../core/skills/${skillId}/SKILL.md`, import.meta.url), "utf8");
  const evaluation = JSON.parse(
    await readFile(new URL(`../../../core/evals/skill-routing/${skillId}.json`, import.meta.url), "utf8"),
  );
  const serialized = JSON.stringify(evaluation);
  assert.match(skill, /^---\n/);
  for (const caseId of requiredCases) assert.match(serialized, new RegExp(caseId));
});

const skillPath = new URL("../../../core/skills/dispatching-parallel-agents/SKILL.md", import.meta.url);
const evaluationPath = new URL("../../../core/evals/skill-routing/dispatching-parallel-agents.json", import.meta.url);

test("dispatching-parallel-agents uses the two-task threshold only for useful independent work", async () => {
  const skill = await readFile(skillPath, "utf8");
  assert.match(skill, /^---\n/u);
  const closing = skill.indexOf("\n---\n", 4);
  assert.ok(closing > 0, "frontmatter must close");
  const frontmatter = skill.slice(4, closing);
  assert.match(frontmatter, /^name:\s*dispatching-parallel-agents\s*$/mu);
  assert.match(frontmatter, /^description:\s*Use when\b/mu);
  assert.match(frontmatter, /^evaluationCases:\s*$/mu);
  assert.match(skill, /at least two|two or more/iu);
  assert.match(skill, /three or more|three\+/iu);
  assert.match(skill, /useful independent|independence/iu);
  assert.match(skill, /disjoint|non-overlapping|separate.*(?:write|mutation) scope/iu);
  assert.match(skill, /ownership|owner/iu);
  assert.match(skill, /native.*(?:available|availability)|availability.*native/iu);
  assert.match(skill, /shared state|shared mutable/iu);
  assert.match(skill, /sequential|serialize|replan/iu);
  assert.doesNotMatch(skill, /(?:\.claude|\.codex|\.gemini|mcp__|WebSearch|WebFetch|spawn_agent|invoke_subagent)/iu);
});

test("dispatching-parallel-agents requires the Skill Gate Protocol and explicit authority", async () => {
  const skill = await readFile(skillPath, "utf8");
  assert.match(skill, /Skill Gate Protocol/iu);
  assert.match(skill, /recorded.*explicit.*human approval|explicit.*human approval.*recorded/isu);
  assert.match(skill, /executable.*plan|approved.*plan/iu);
  assert.match(skill, /exact.*(?:input|output|scope)|mutation scope/iu);
  assert.match(skill, /durable.*(?:ledger|checkpoint)|checkpoint.*(?:durable|resume)/isu);
  assert.match(skill, /review/iu);
  assert.match(skill, /do not.*(?:invoke|dispatch)|return to.*(?:planning|sequential)|not.*parallel/isu);
  assert.match(skill, /explicit.*authori[sz]|authority/iu);
});

test("dispatching-parallel-agents routing evaluation defines three critical cases", async () => {
  const evaluation = JSON.parse(await readFile(evaluationPath, "utf8"));
  assert.equal(evaluation.schemaVersion, 1);
  assert.equal(evaluation.skill, skillId);
  assert.deepEqual(evaluation.cases.map((entry) => entry.id), requiredCases);
  for (const entry of evaluation.cases) {
    assert.equal(entry.critical, true, `${entry.id} must be critical`);
    assert.equal(typeof entry.prompt, "string");
    assert.equal(typeof entry.expected, "object");
    assert.ok(Array.isArray(entry.observables) && entry.observables.length > 0);
  }
  assert.equal(evaluation.cases[0].expected.skillCheck, "required");
  assert.equal(evaluation.cases[0].expected.independentTasks, true);
  assert.equal(evaluation.cases[0].expected.usefulIndependence, true);
  assert.equal(evaluation.cases[0].expected.disjointOwnership, true);
  assert.equal(evaluation.cases[0].expected.nativeAvailability, true);
  assert.equal(evaluation.cases[0].expected.parallelDispatch, true);
  assert.equal(evaluation.cases[1].expected.skillCheck, "not-required");
  assert.equal(evaluation.cases[1].expected.sharedState, true);
  assert.equal(evaluation.cases[1].expected.noParallelDispatch, true);
  assert.equal(evaluation.cases[1].expected.replanOrSequential, true);
  assert.equal(evaluation.cases[2].expected.skillCheck, "required");
  assert.equal(evaluation.cases[2].expected.nativeAvailability, false);
  assert.equal(evaluation.cases[2].expected.noFakeParallelism, true);
  assert.equal(evaluation.cases[2].expected.sequentialFallbackOrBlock, true);
});

test("core loader exposes dispatching-parallel-agents metadata and routing links", async () => {
  const { loadCore } = await import("../../../installers/lib/load-core.mjs");
  const core = await loadCore(process.cwd());
  const skill = core.skills.find((entry) => entry.id === skillId);
  assert.ok(skill);
  assert.equal(skill.name, skillId);
  assert.deepEqual(skill.evaluationCases, requiredCases);
  assert.deepEqual(core.evals.find((entry) => entry.id === "dispatching-parallel-agents-routing")?.cases.map((entry) => entry.id), requiredCases);
});
