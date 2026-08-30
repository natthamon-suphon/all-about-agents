import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const skillId = "session-compaction-resilience";
const requiredCases = [
  "SC-TRIGGER-long-task-compaction",
  "SC-NONTRIGGER-short-answer",
  "SC-PRESSURE-assume-commit",
];

test("T029 exposes its routing evidence", async () => {
  const skill = await readFile(new URL(`../../../core/skills/${skillId}/SKILL.md`, import.meta.url), "utf8");
  const evaluation = JSON.parse(
    await readFile(new URL(`../../../core/evals/skill-routing/${skillId}.json`, import.meta.url), "utf8"),
  );
  const serialized = JSON.stringify(evaluation);
  assert.match(skill, /^---\n/);
  for (const caseId of requiredCases) assert.match(serialized, new RegExp(caseId));
});

test("session-compaction-resilience names the canonical long-task workflow", async () => {
  const skill = await readFile(resolve(process.cwd(), "core/skills/session-compaction-resilience/SKILL.md"), "utf8");
  assert.match(skill, /canonical long-task workflow/iu);
});

test("session-compaction-resilience preserves durable evidence and safe recovery boundaries", async () => {
  const skill = await readFile(resolve(process.cwd(), "core/skills/session-compaction-resilience/SKILL.md"), "utf8");
  assert.match(skill, /Skill Gate Protocol/iu);
  assert.match(skill, /vendor-neutral/iu);
  assert.match(skill, /before compaction[\s\S]*goal[\s\S]*status[\s\S]*decisions[\s\S]*blockers[\s\S]*evidence[\s\S]*not run[\s\S]*one next/iu);
  assert.match(skill, /verify[^\n]*disk|current bytes/iu);
  assert.match(skill, /conversation summary|handoff claim|model-generated status/iu);
  assert.match(skill, /redact(?:s|ed)? secrets|<REDACTED>/iu);
  assert.match(skill, /completed[\s\S]*in-flight[\s\S]*blocked[\s\S]*not run/iu);
  assert.match(skill, /one next concrete action/iu);
  assert.match(skill, /explicit human authority/iu);
  assert.match(skill, /dependency installation/iu);
  assert.match(skill, /live transfer/iu);
  assert.doesNotMatch(skill, /(?:git log|commit SHA|commits?\s*[:<])/iu);
});

test("session-compaction-resilience evaluation covers trigger, non-trigger, and pressure cases", async () => {
  const evaluation = JSON.parse(await readFile(resolve(process.cwd(), "core/evals/skill-routing/session-compaction-resilience.json"), "utf8"));
  assert.equal(evaluation.schemaVersion, 1);
  assert.equal(evaluation.id, "session-compaction-resilience-routing");
  assert.equal(evaluation.skill, skillId);
  assert.deepEqual(evaluation.cases.map((entry) => entry.id), requiredCases);
  for (const entry of evaluation.cases) {
    assert.equal(entry.critical, true, `${entry.id} must be critical`);
    assert.equal(typeof entry.prompt, "string");
    assert.equal(typeof entry.expected, "object");
    assert.ok(Array.isArray(entry.observables) && entry.observables.length > 0);
  }
  assert.equal(evaluation.cases[0].expected.skillCheck, "required");
  assert.equal(evaluation.cases[0].expected.canonicalLongTaskWorkflow, true);
  assert.equal(evaluation.cases[0].expected.snapshotBeforeCompaction, true);
  assert.equal(evaluation.cases[0].expected.verifyDiskState, true);
  assert.equal(evaluation.cases[0].expected.oneNextAction, true);
  assert.equal(evaluation.cases[1].expected.skillCheck, "not-required");
  assert.equal(evaluation.cases[1].expected.noSnapshot, true);
  assert.equal(evaluation.cases[2].expected.skillCheck, "required");
  assert.equal(evaluation.cases[2].expected.resumeWithoutCommitHistory, true);
  assert.equal(evaluation.cases[2].expected.noAutomaticGitAction, true);
  assert.equal(evaluation.cases[2].expected.noAutomaticDependencyInstall, true);
  assert.equal(evaluation.cases[2].expected.explicitLiveAuthority, true);
});

test("core loader exposes session-compaction-resilience metadata and routing links", async () => {
  const { loadCore } = await import("../../../installers/lib/load-core.mjs");
  const core = await loadCore(process.cwd());
  const skill = core.skills.find((entry) => entry.id === skillId);
  assert.ok(skill);
  assert.equal(skill.name, skillId);
  assert.deepEqual(skill.evaluationCases, requiredCases);
  assert.deepEqual(core.evals.find((entry) => entry.id === "session-compaction-resilience-routing")?.cases.map((entry) => entry.id), requiredCases);
});
