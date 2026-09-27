import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const skillId = "handoff";
const requiredCases = ["HO-TRIGGER-explicit-handoff", "HO-NONTRIGGER-normal-progress", "HO-PRESSURE-claude-only-shell"];
const boundary = "`handoff` records a pause or transfer when the human asks for one; `session-compaction-resilience` keeps long-task state that must survive compaction. Both use the same record shape.";
const canonicalStates = /pending,\s+in\s+progress,\s+completed,\s+blocked,\s+failed,\s+not\s+run,\s+skipped/u;

test("handoff keeps the canonical workflow semantic and vendor-neutral", async () => {
  const skill = await readFile(resolve(process.cwd(), "core/skills/handoff/SKILL.md"), "utf8");
  assert.match(skill, /^name:\s*handoff\s*$/mu);
  assert.match(skill, /^description:\s*Use when\b/mu);
  assert.match(skill, /Skill Gate Protocol/iu);
  assert.match(skill, /explicit(?:ly)?[^\n]*(?:human|authority)|human[^\n]*(?:authority|requested)/isu);
  assert.match(skill, /semantic handoff|semantic artifact|continuation record/iu);
  assert.match(skill, /Goal[\s\S]*State[\s\S]*Decisions[\s\S]*Evidence[\s\S]*Suggested skills[\s\S]*Next concrete step/iu);
  assert.match(skill, /durable evidence|durable continuation/iu);
  assert.match(skill, canonicalStates);
  assert.match(skill, /not run/iu);
  assert.match(skill, /redact(?:s|ed)? secrets|<REDACTED>/iu);
  assert.match(skill, /untrusted[^\n]*(?:data|content)/iu);
  assert.match(skill, /do not interpolate|never interpolate|shell command/iu);
  assert.match(skill, /live handoff[^\n]*(?:only|when)[^\n]*adapter|adapter[^\n]*(?:documents|exposes)[^\n]*structured/isu);
  assert.doesNotMatch(skill, /(?:claude\s+--bg|Claude Code|Codex CLI|Gemini CLI|mcp__|spawn_agent|invoke_subagent)/iu);
});

test("handoff shares one record shape with session-compaction-resilience", async () => {
  const skill = await readFile(resolve(process.cwd(), "core/skills/handoff/SKILL.md"), "utf8");
  const description = /^description:\s*(.+)$/mu.exec(skill)?.[1] ?? "";
  assert.ok(skill.includes(boundary), "handoff must carry the HANDOFF-COMPACTION boundary sentence");
  assert.doesNotMatch(description, /durable continuation evidence/iu);
  assert.match(skill, /`snapshot-template\.md` in `session-compaction-resilience`/u, "handoff must name the shared record template");
  assert.doesNotMatch(skill, /\]\(\.\.\//u, "a skill may not link into another skill's folder");
  await readFile(resolve(process.cwd(), "core/skills/session-compaction-resilience/snapshot-template.md"), "utf8");
  assert.doesNotMatch(skill, /```markdown/u, "handoff must not inline a second record shape");
  assert.match(skill, /\.aaa\/<topic>\/handoff\.md/u);
  assert.doesNotMatch(skill, /\.claude/u);
  assert.match(skill, /reviewed for secrets and completeness/u);
  assert.doesNotMatch(skill, /\bis validated\b/u);
});

test("handoff evaluation defines the three critical routing cases", async () => {
  const evaluation = JSON.parse(await readFile(resolve(process.cwd(), "core/evals/skill-routing/handoff.json"), "utf8"));
  assert.equal(evaluation.schemaVersion, 1);
  assert.equal(evaluation.id, "handoff-routing");
  assert.equal(evaluation.skill, skillId);
  assert.deepEqual(evaluation.cases.map((entry) => entry.id), requiredCases);
  for (const entry of evaluation.cases) {
    assert.equal(entry.critical, true, `${entry.id} must be critical`);
    assert.equal(typeof entry.prompt, "string");
    assert.equal(typeof entry.expected, "object");
    assert.ok(Array.isArray(entry.observables) && entry.observables.length > 0);
  }
  assert.equal(evaluation.cases[0].expected.skillCheck, "required");
  assert.equal(evaluation.cases[0].expected.semanticArtifact, true);
  assert.equal(evaluation.cases[0].expected.durableResumeEvidence, true);
  assert.equal(evaluation.cases[0].expected.liveOnlyIfAdapterSupported, true);
  assert.equal(evaluation.cases[1].expected.skillCheck, "not-required");
  assert.equal(evaluation.cases[1].expected.noHandoffArtifact, true);
  assert.equal(evaluation.cases[1].expected.noLiveTransfer, true);
  assert.equal(evaluation.cases[2].expected.noClaudeSpecificShell, true);
  assert.equal(evaluation.cases[2].expected.noShellInterpolation, true);
  assert.equal(evaluation.cases[2].expected.redactSecrets, true);
});
