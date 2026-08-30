import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const skillId = "subagent-driven-development";
const requiredCases = [
  "SD-TRIGGER-independent-plan-tasks",
  "SD-NONTRIGGER-overlapping-writers",
  "SD-PRESSURE-cheap-model-cleanup"
];

const skillPath = resolve(process.cwd(), "core/skills/subagent-driven-development/SKILL.md");
const evaluationPath = resolve(process.cwd(), "core/evals/skill-routing/subagent-driven-development.json");
const gateFixturePath = resolve(process.cwd(), "tests/fixtures/subagent-driven-development/skill-gate.json");
const injectionFixturePath = resolve(process.cwd(), "tests/fixtures/subagent-driven-development/command-injection.json");

test("T025 exposes its routing evidence", async () => {
  const skill = await readFile(skillPath, "utf8");
  const evaluation = JSON.parse(await readFile(evaluationPath, "utf8"));
  const serialized = JSON.stringify(evaluation);
  assert.match(skill, /^---\n/u);
  for (const caseId of requiredCases) assert.match(serialized, new RegExp(caseId));
});

test("subagent-driven-development gates execution and isolates implementation writers", async () => {
  const skill = await readFile(skillPath, "utf8");
  assert.match(skill, /^---\n/u);
  const closing = skill.indexOf("\n---\n", 4);
  assert.ok(closing > 0, "frontmatter must close");
  const frontmatter = skill.slice(4, closing);
  assert.match(frontmatter, /^name:\s*subagent-driven-development\s*$/mu);
  assert.match(frontmatter, /^description:\s*Use when\b/mu);
  assert.match(frontmatter, /^evaluationCases:\s*$/mu);
  assert.match(skill, /Skill Gate Protocol/iu);
  assert.match(skill, /approved (?:implementation )?plan/iu);
  assert.match(skill, /independent (?:plan )?tasks|tasks? (?:are )?independent/iu);
  assert.match(skill, /fresh implementer/iu);
  assert.match(skill, /task review|review.*(?:spec|quality)/iu);
  assert.match(skill, /whole.branch|whole branch|final review/iu);
  assert.match(skill, /overlapping writers|overlap.*writes|one writer at a time/iu);
  assert.match(skill, /do not .*parallel.*(?:writer|implementer)|never .*parallel.*(?:writer|implementer)/isu);
  assert.match(skill, /stop|return to|replan/iu);
  assert.doesNotMatch(skill, /(?:\.claude|\.codex|\.gemini|mcp__|WebSearch|WebFetch|spawn_agent|invoke_subagent)/iu);
});

test("subagent-driven-development preserves model, process, and command safety", async () => {
  const skill = await readFile(skillPath, "utf8");
  assert.match(skill, /strongest approved|most capable approved|highest approved/iu);
  assert.match(skill, /explicit(?:ly)? specify.*model|model.*explicitly/iu);
  assert.match(skill, /argument array|argv|executable.*arguments/iu);
  assert.match(skill, /shell interpolation|interpolat(?:e|ion).*shell|shell.*interpolat/iu);
  assert.match(skill, /command injection|shell metacharacter|injection/iu);
  assert.match(skill, /no automatic(?:ally)? commit|do not automatically commit|automatic commit/iu);
  assert.match(skill, /broad.*(?:delete|deletion|cleanup)|workspace.*(?:delete|deletion)/isu);
  assert.match(skill, /explicit(?:ly)? user|user(?:'s)? explicit|authorization/iu);
  assert.match(skill, /uncommitted.*(?:preserve|untouched)|preserve.*uncommitted/isu);
});

test("T025 fixtures encode the Skill Gate and command-injection boundaries", async () => {
  const gate = JSON.parse(await readFile(gateFixturePath, "utf8"));
  const injection = JSON.parse(await readFile(injectionFixturePath, "utf8"));
  assert.equal(gate.case, "approved-independent-plan");
  assert.equal(gate.expected.skillCheck, "required");
  assert.equal(gate.expected.dispatch, true);
  assert.equal(gate.expected.overlappingWriters, false);
  assert.ok(Array.isArray(injection.safeArgv));
  assert.ok(Array.isArray(injection.unsafeShellStrings));
  assert.equal(injection.expected.argvOnly, true);
  assert.equal(injection.expected.rejectShellInterpolation, true);
  assert.ok(injection.unsafeShellStrings.some((command) => /\$\(|`|;|&&/u.test(command)));
});

test("subagent-driven-development routing evaluation defines three complete critical cases", async () => {
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
  assert.equal(evaluation.cases[0].expected.independentTasks, true);
  assert.equal(evaluation.cases[0].expected.freshImplementerPerTask, true);
  assert.equal(evaluation.cases[0].expected.noOverlappingWriters, true);
  assert.equal(evaluation.cases[0].expected.taskReview, true);
  assert.equal(evaluation.cases[0].expected.finalReview, true);
  assert.equal(evaluation.cases[1].expected.skillCheck, "not-required");
  assert.equal(evaluation.cases[1].expected.overlappingWriters, true);
  assert.equal(evaluation.cases[1].expected.noParallelWriters, true);
  assert.equal(evaluation.cases[1].expected.replanOrSequential, true);
  assert.equal(evaluation.cases[2].expected.skillCheck, "required");
  assert.equal(evaluation.cases[2].expected.strongestApprovedModels, true);
  assert.equal(evaluation.cases[2].expected.noCheapModelSubstitution, true);
  assert.equal(evaluation.cases[2].expected.argvOnly, true);
  assert.equal(evaluation.cases[2].expected.rejectCommandInjection, true);
  assert.equal(evaluation.cases[2].expected.noAutomaticCommit, true);
  assert.equal(evaluation.cases[2].expected.noBroadDeletion, true);
});

test("core loader exposes subagent-driven-development metadata and routing links", async () => {
  const { loadCore } = await import("../../../installers/lib/load-core.mjs");
  const core = await loadCore(process.cwd());
  const skill = core.skills.find((entry) => entry.id === skillId);
  assert.ok(skill);
  assert.equal(skill.name, skillId);
  assert.deepEqual(skill.evaluationCases, requiredCases);
  assert.deepEqual(core.evals.find((entry) => entry.id === "subagent-driven-development-routing")?.cases.map((entry) => entry.id), requiredCases);
});
