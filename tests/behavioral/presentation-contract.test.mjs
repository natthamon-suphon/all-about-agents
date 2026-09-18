import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { loadCore } from "../../installers/lib/load-core.mjs";
import { displayLabel } from "../../installers/lib/presentation-contract.mjs";
import { renderForSurface } from "../../installers/lib/render.mjs";
import { validateSchema } from "../../installers/lib/validate-schema.mjs";
import traceSchema from "../../core/evals/presentation-trace.schema.json" with { type: "json" };
import scenarios from "../../core/evals/scenarios/presentation-contract.json" with { type: "json" };
import { auditPresentationTrace } from "../../core/evals/presentation-trace.mjs";

const scenario = (id) => {
  const value = scenarios.scenarios.find((entry) => entry.id === id);
  assert.ok(value, `scenario is missing: ${id}`);
  return value;
};

function auditCase(id, index = 0) {
  const entry = scenario(id).cases[index];
  assert.ok(entry, `${id} case ${index} is missing`);
  return entry;
}

function assertScenario(id, expectedValid, index = 0) {
  const entry = auditCase(id, index);
  const result = auditPresentationTrace({ trace: entry.trace, presentation: entry.presentation ?? undefined });
  assert.equal(result.valid, expectedValid, `${id}: ${JSON.stringify(result.errors)}`);
  assert.ok(Array.isArray(result.errors));
  assert.ok(result.summary && typeof result.summary === "object");
  if (expectedValid) assert.deepEqual(result.errors, []);
  return result;
}

test("trace schema rejects unknown keys, unsafe IDs, duplicate revisions, missing reasons, and unknown states", () => {
  const valid = auditCase("one-skill").trace;
  const unknown = structuredClone(valid);
  unknown.extra = true;
  const unknownResult = validateSchema({ schema: traceSchema, value: unknown, sourcePath: "trace" });
  assert.equal(unknownResult.valid, false);
  assert.ok(unknownResult.errors.some((error) => error.keyword === "additionalProperties"));

  const unsafe = structuredClone(valid);
  unsafe.invocationId = "../unsafe";
  unsafe.events[0].id = "../brainstorming";
  const unsafeResult = validateSchema({ schema: traceSchema, value: unsafe, sourcePath: "trace" });
  assert.equal(unsafeResult.valid, false);
  assert.ok(unsafeResult.errors.some((error) => error.keyword === "pattern"));

  const duplicateRevision = structuredClone(valid);
  duplicateRevision.events.splice(2, 0, structuredClone(duplicateRevision.events[1]));
  const duplicateResult = validateSchema({ schema: traceSchema, value: duplicateRevision, sourcePath: "trace" });
  assert.equal(duplicateResult.valid, true, "revision uniqueness is a semantic rule, not a JSON-shape rule");
  assert.ok(auditPresentationTrace({ trace: duplicateRevision }).errors.some((error) => error.code === "revision-duplicate"));

  const missingReason = structuredClone(valid);
  missingReason.events[1].items[0].status = "blocked";
  const missingReasonResult = validateSchema({ schema: traceSchema, value: missingReason, sourcePath: "trace" });
  assert.equal(missingReasonResult.valid, true, "reason is a semantic requirement, not a JSON-shape requirement");

  const unknownState = structuredClone(valid);
  unknownState.events[1].items[0].status = "waiting";
  const unknownStateResult = validateSchema({ schema: traceSchema, value: unknownState, sourcePath: "trace" });
  assert.equal(unknownStateResult.valid, false);
});

test("one skill invocation has an exact label, reason, stable checklist, and completion", () => {
  assertScenario("one-skill", true);
});

test("one role or agent invocation has an exact label and checklist", () => {
  assertScenario("one-role", true);
});

test("one dynamic subagent invocation uses the registered default emoji", () => {
  const result = assertScenario("one-subagent", true);
  assert.equal(result.summary.announcement.label, "worker-alpha 🤖");
});

test("parallel work has one named owner for each in-progress item", () => {
  assertScenario("parallel-owners", true);
});

test("blocked failed skipped and not-run terminal items require reasons", () => {
  const result = assertScenario("exceptional-terminal-reasons", true);
  assert.equal(result.summary.terminalExceptionalStates.length, 4);
});

test("resumed long work keeps completed item IDs and changes only state", () => {
  const result = assertScenario("resumed-work", true);
  assert.equal(result.summary.checklistRevisions, 2);
  assert.equal(result.summary.finalStatuses.filter((status) => status === "completed").length, 3);
});

test("completion is allowed only after every checklist item is terminal", () => {
  const result = assertScenario("all-terminal-completion", true);
  assert.equal(result.summary.completed, true);
  assert.equal(result.summary.pendingCount, 0);
  assert.equal(result.summary.inProgressCount, 0);
});

test("announcement is first, at least one checklist exists, and terminal items cannot be reopened", () => {
  const outOfOrder = structuredClone(auditCase("one-skill").trace);
  [outOfOrder.events[0], outOfOrder.events[1]] = [outOfOrder.events[1], outOfOrder.events[0]];
  assert.ok(auditPresentationTrace({ trace: outOfOrder }).errors.some((error) => error.code === "announcement-first"));

  const withoutChecklist = structuredClone(auditCase("one-skill").trace);
  withoutChecklist.events = withoutChecklist.events.filter((event) => event.type !== "checklist");
  const noChecklistResult = auditPresentationTrace({ trace: withoutChecklist });
  assert.ok(noChecklistResult.errors.some((error) => error.code === "checklist-required"));

  const reopened = structuredClone(auditCase("resumed-work").trace);
  reopened.events[2].items[0].status = "in-progress";
  const reopenedResult = auditPresentationTrace({ trace: reopened });
  const terminalRegression = reopenedResult.errors.find((error) => error.code === "terminal-regression");
  assert.ok(terminalRegression);
  assert.equal(terminalRegression.path, "/trace/events/2/items/0/status");

  const activeAtCompletion = structuredClone(auditCase("one-skill").trace);
  activeAtCompletion.events[1].items[0].status = "in-progress";
  const activeResult = auditPresentationTrace({ trace: activeAtCompletion });
  const completionActive = activeResult.errors.find((error) => error.code === "completion-has-active-item");
  assert.ok(completionActive);
  assert.equal(completionActive.path, "/trace/events/1/items/0/status");
});

test("an unchanged checklist repeat is rejected even when its revision increases", () => {
  const result = assertScenario("unchanged-checklist", false);
  assert.ok(result.errors.some((error) => error.code === "checklist-unchanged"));
});

test("a checklist revision with unchanged item states is rejected even when prose changes", () => {
  const trace = structuredClone(auditCase("unchanged-checklist").trace);
  trace.events[2].items[0].text = "Find and confirm the primary source";
  trace.events[2].items[1].owner = "researcher";
  const result = auditPresentationTrace({ trace });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === "checklist-unchanged"), JSON.stringify(result.errors));
});

test("trace auditing rejects C1 and Unicode format controls without copying them into diagnostics or summaries", () => {
  const cases = [];

  const c1Reason = structuredClone(auditCase("one-skill").trace);
  c1Reason.events[0].reason = "Unsafe C1 control \u009b[31m";
  cases.push(c1Reason);

  const lineSeparatorReason = structuredClone(auditCase("one-skill").trace);
  lineSeparatorReason.events[0].reason = "Unsafe line\u2028separator";
  cases.push(lineSeparatorReason);

  const bidiReason = structuredClone(auditCase("exceptional-terminal-reasons").trace);
  const exceptionalItem = bidiReason.events.findLast((event) => event.type === "checklist").items.find((item) => item.reason);
  exceptionalItem.reason = "Unsafe bidi override \u202etext";
  cases.push(bidiReason);

  const paragraphSeparatorReason = structuredClone(auditCase("exceptional-terminal-reasons").trace);
  const paragraphItem = paragraphSeparatorReason.events.findLast((event) => event.type === "checklist").items.find((item) => item.reason);
  paragraphItem.reason = "Unsafe paragraph\u2029separator";
  cases.push(paragraphSeparatorReason);

  const hostileKind = structuredClone(auditCase("one-skill").trace);
  hostileKind.events[0].kind = "skill\u202e";
  cases.push(hostileKind);

  const hostileState = structuredClone(auditCase("one-skill").trace);
  hostileState.events[1].items[0].status = "pending\u009b";
  cases.push(hostileState);

  const hostileField = structuredClone(auditCase("one-skill").trace);
  hostileField.events[0]["field\u202e"] = true;
  cases.push(hostileField);

  const hostileHtmlField = structuredClone(auditCase("one-skill").trace);
  hostileHtmlField.events[0]["<style>"] = true;
  cases.push(hostileHtmlField);

  for (const trace of cases) {
    const result = auditPresentationTrace({ trace });
    assert.equal(result.valid, false);
    assert.doesNotMatch(JSON.stringify(result), /[\u009b\u202e]/u, "audit output must not propagate hostile control or format characters");
    assert.doesNotMatch(JSON.stringify(result), /[\u2028\u2029]/u, "audit output must not propagate Unicode line separators");
    assert.doesNotMatch(JSON.stringify(result), /<[^>]*>/u, "audit output must not propagate HTML-shaped field names or placeholders");
  }

  const hostilePresentation = {
    emojiRegistry: { skills: { brainstorming: { emoji: "\u202e" } } },
    progressContract: { states: {} }
  };
  const hostilePresentationResult = auditPresentationTrace({ trace: structuredClone(auditCase("one-skill").trace), presentation: hostilePresentation });
  assert.equal(hostilePresentationResult.valid, false);
  assert.doesNotMatch(JSON.stringify(hostilePresentationResult), /\u202e/u, "audit diagnostics must not echo an unsafe registry value");
});

test("trace auditing reports null and primitive checklist items without throwing", () => {
  const trace = structuredClone(auditCase("one-skill").trace);
  trace.events[1].items = [null, 7];
  let result;
  assert.doesNotThrow(() => { result = auditPresentationTrace({ trace }); });
  assert.equal(result.valid, false);
  assert.equal(result.errors.filter((error) => error.code === "type").length, 2);
  assert.deepEqual(result.summary.finalStatuses, [null, null]);
});

test("standalone trace auditing enforces the schema event limit and bounds semantic work", () => {
  const base = structuredClone(auditCase("one-skill").trace);
  const checklists = Array.from({ length: 64 }, (_, index) => {
    const checklist = structuredClone(base.events[1]);
    checklist.revision = index + 1;
    checklist.items[0].status = index === 63 ? "completed" : index % 2 === 0 ? "in-progress" : "pending";
    checklist.items[1].status = index === 63 ? "completed" : index % 2 === 0 ? "pending" : "in-progress";
    return checklist;
  });
  base.events = [base.events[0], ...checklists, base.events.at(-1)];
  assert.equal(base.events.length, 66);

  const result = auditPresentationTrace({ trace: base });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === "event-count" && error.path === "/trace/events"));
  assert.equal(result.summary.checklistRevisions, 63, "the auditor must not process events after the 64-entry resource bound");
});

test("emoji-before-name and unknown emoji labels are rejected", () => {
  assertScenario("emoji-order-and-unknown", false, 0);
  assertScenario("emoji-order-and-unknown", false, 1);
});

test("both surfaces use the same normative presentation clauses and native label placements", async () => {
  const core = await loadCore(process.cwd());
  const renders = new Map();
  for (const surface of ["claude", "codex"]) {
    const result = await renderForSurface({
      repositoryRoot: process.cwd(),
      core,
      surface,
      profile: "portable",
      statuslineName: "",
      platform: process.platform,
      ...(surface === "codex" ? { targetRuntime: "cli" } : {})
    });
    renders.set(surface, new Map(result.files.map((file) => [file.relativePath, new TextDecoder().decode(file.content)])));
  }

  const placements = {
    claude: ["skills/brainstorming/SKILL.md", "agents/architect.md", "rules/presentation.md"],
    codex: [".agents/skills/brainstorming/SKILL.md", ".codex/agents/architect.toml", "AGENTS.md"]
  };
  const clauses = [
    "one short, task-specific reason",
    "2-7 material steps",
    "update only when a state changes",
    "one in-progress item",
    "terminal state"
  ];
  for (const [surface, files] of renders) {
    const selectedText = placements[surface].map((path) => files.get(path) ?? "").join("\n");
    for (const clause of clauses) assert.match(selectedText, new RegExp(clause.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "iu"), `${surface}: ${clause}`);
    for (const [kind, id] of [["skill", "brainstorming"], ["role", "architect"]]) {
      assert.match(selectedText, new RegExp(displayLabel(core.presentation, kind, id).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"), `${surface}: exact ${kind}/${id}`);
    }
  }
});

test("scenario fixture names every required presentation behavior family", () => {
  assert.deepEqual(scenarios.scenarios.map((entry) => entry.id), [
    "one-skill",
    "one-role",
    "one-subagent",
    "parallel-owners",
    "exceptional-terminal-reasons",
    "resumed-work",
    "all-terminal-completion",
    "unchanged-checklist",
    "emoji-order-and-unknown"
  ]);
});
