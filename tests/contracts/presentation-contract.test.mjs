import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  displayLabel,
  renderInvocationGuidance,
  renderPresentationCatalog,
  validatePresentationContract
} from "../../installers/lib/presentation-contract.mjs";
import { loadCore } from "../../installers/lib/load-core.mjs";
import { validateSchema } from "../../installers/lib/validate-schema.mjs";

const root = resolve(process.cwd());

const expected = {
  skills: {
    "brainstorming": "🧠",
    "codebase-design": "🧱",
    "dispatching-parallel-agents": "⚡",
    "executing-plans": "🚀",
    "finishing-a-development-branch": "🏁",
    "handoff": "🤝",
    "improve-codebase-architecture": "🏛️",
    "interviewing": "🎤",
    "loop-me": "🔁",
    "nano-image-generator": "🖼️",
    "performance-profiling-and-benchmarking": "⏱️",
    "receiving-code-review": "📥",
    "requesting-code-review": "📤",
    "research": "🔎",
    "resolving-merge-conflicts": "🧩",
    "session-compaction-resilience": "🗜️",
    "subagent-driven-development": "👥",
    "systematic-debugging": "🐛",
    "test-driven-development": "🧪",
    "threat-modeling-and-security": "🛡️",
    "using-all-about-agents": "🧰",
    "using-git-worktrees": "🌳",
    "verification-before-completion": "✅",
    "wait-what": "❓",
    "wayfinder": "🧭",
    "writing-plans": "📝",
    "writing-skills": "✍️",
    "zero-downtime-migrations": "🔄"
  },
  roles: {
    architect: "🏛️",
    implementer: "🛠️",
    investigator: "🕵️",
    researcher: "🔎",
    reviewer: "👀",
    "security-reviewer": "🛡️",
    verifier: "✅"
  },
  subagents: { default: "🤖" },
  commands: {
    "aaa:design": "🎨",
    "aaa:build": "🏗️",
    "aaa:fix": "🔧",
    "aaa:review": "👀",
    "aaa:audit": "🔍",
    "aaa:improve-skill": "✨",
    "aaa:resume": "▶️",
    "aaa:verify": "✅"
  },
  workflows: {
    "design-change": "🎨",
    "fix-bug": "🐛",
    "implement-change": "🛠️",
    "improve-skill": "✨",
    "release-qualification": "🚦",
    "review-and-audit": "🔍"
  },
  hooks: {
    bootstrap: "🚀",
    "activity-audit": "🧾",
    checkpoint: "💾"
  },
  profiles: { portable: "🧳", template: "⚙️" }
};

function registryFromExpected() {
  return Object.fromEntries(Object.entries(expected).map(([category, values]) => [
    category,
    Object.fromEntries(Object.entries(values).map(([id, emoji]) => [id, { emoji }]))
  ]));
}

function canonicalFromExpected() {
  return Object.fromEntries(Object.entries(expected)
    .filter(([category]) => category !== "subagents")
    .map(([category, values]) => [category, Object.keys(values)]));
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function validProgressContract() {
  return {
    schemaVersion: 1,
    states: {
      pending: { emoji: "⬜", terminal: false },
      "in-progress": { emoji: "🔄", terminal: false },
      completed: { emoji: "✅", terminal: true },
      blocked: { emoji: "🚧", terminal: true, reasonRequired: true },
      failed: { emoji: "❌", terminal: true, reasonRequired: true },
      "not-run": { emoji: "⏸️", terminal: true, reasonRequired: true },
      skipped: { emoji: "⏭️", terminal: true, reasonRequired: true }
    },
    minItems: 2,
    maxItems: 7,
    maxSequentialInProgress: 1,
    updateOnlyOnStateChange: true,
    terminalCompletionRequired: true
  };
}

test("presentation files exist, have the exact approved counts, and validate", async () => {
  await access(resolve(root, "core/presentation/emoji-registry.json"));
  await access(resolve(root, "core/presentation/progress-contract.json"));
  await access(resolve(root, "core/schemas/presentation.schema.json"));
  const emojiRegistry = JSON.parse(await readFile(resolve(root, "core/presentation/emoji-registry.json"), "utf8"));
  const progressContract = JSON.parse(await readFile(resolve(root, "core/presentation/progress-contract.json"), "utf8"));
  assert.deepEqual(emojiRegistry, { schemaVersion: 1, ...registryFromExpected() });
  assert.deepEqual(Object.fromEntries(Object.entries(emojiRegistry).filter(([key]) => key !== "schemaVersion").map(([key, values]) => [key, Object.keys(values).length])), {
    skills: 28, roles: 7, subagents: 1, commands: 8, workflows: 6, hooks: 3, profiles: 2
  });
  assert.deepEqual(validatePresentationContract({ emojiRegistry, progressContract, canonical: canonicalFromExpected() }), { valid: true, errors: [] });
  const schema = JSON.parse(await readFile(resolve(root, "core/schemas/presentation.schema.json"), "utf8"));
  assert.equal(validateSchema({ schema, value: emojiRegistry, sourcePath: "core/presentation/emoji-registry.json" }).valid, true);
  assert.equal(validateSchema({ schema, value: progressContract, sourcePath: "core/presentation/progress-contract.json" }).valid, true);
});

test("presentation validation is strict about completeness, categories, identifiers, and safe emoji", () => {
  const base = { emojiRegistry: { schemaVersion: 1, ...registryFromExpected() }, progressContract: { schemaVersion: 1, states: {
    pending: { emoji: "⬜", terminal: false },
    "in-progress": { emoji: "🔄", terminal: false },
    completed: { emoji: "✅", terminal: true },
    blocked: { emoji: "🚧", terminal: true, reasonRequired: true },
    failed: { emoji: "❌", terminal: true, reasonRequired: true },
    "not-run": { emoji: "⏸️", terminal: true, reasonRequired: true },
    skipped: { emoji: "⏭️", terminal: true, reasonRequired: true }
  }, minItems: 2, maxItems: 7, maxSequentialInProgress: 1, updateOnlyOnStateChange: true, terminalCompletionRequired: true }, canonical: canonicalFromExpected() };
  const cases = [
    ["missing", (value) => { delete value.skills.research; }],
    ["extra", (value) => { value.skills.unknown = { emoji: "❔" }; }],
    ["wrong-category", (value) => { value.roles.brainstorming = { emoji: "🧠" }; }],
    ["invalid-ID", (value) => { value.skills["not valid"] = { emoji: "❌" }; }],
    ["missing-emoji", (value) => { delete value.skills.research.emoji; }],
    ["emoji-before-name", (value) => { value.skills.research.emoji = "🧠 research"; }],
    ["HTML/ANSI", (value) => { value.skills.research.emoji = "<b>🔎</b>\u001b[31m"; }],
    ["unapproved-entity-emoji", (value) => { value.skills.brainstorming.emoji = "🦄"; }],
    ["control-character-entity-emoji", (value) => { value.skills.brainstorming.emoji = "\u0007"; }]
  ];
  for (const [name, mutate] of cases) {
    const value = structuredClone(base);
    mutate(value.emojiRegistry);
    const result = validatePresentationContract(value);
    assert.equal(result.valid, false, `${name} must fail`);
    assert.ok(result.errors.length > 0, `${name} must report an error`);
  }
  const unknownState = structuredClone(base);
  unknownState.progressContract.states.paused = { emoji: "⏸️", terminal: true };
  assert.equal(validatePresentationContract(unknownState).valid, false);

  const wrongStateMarker = structuredClone(base);
  wrongStateMarker.progressContract.states.pending.emoji = "🔶";
  assert.equal(validatePresentationContract(wrongStateMarker).valid, false);
  assert.ok(validatePresentationContract(wrongStateMarker).errors.some((error) => error.code === "unapproved-checklist-emoji"));

  const controlStateMarker = structuredClone(base);
  controlStateMarker.progressContract.states.pending.emoji = "\u0007";
  assert.equal(validatePresentationContract(controlStateMarker).valid, false);
});

test("display labels preserve machine IDs and use the dynamic subagent fallback", () => {
  const presentation = { emojiRegistry: { schemaVersion: 1, ...registryFromExpected() }, progressContract: {} };
  for (const [category, values] of Object.entries(expected)) {
    for (const [id, emoji] of Object.entries(values)) assert.equal(displayLabel(presentation, category === "subagents" ? "subagent" : category.slice(0, -1), id), `${id} ${emoji}`);
  }
  assert.equal(displayLabel(presentation, "subagent", "worker-17"), "worker-17 🤖");
  assert.throws(() => displayLabel(presentation, "skill", "research 🔎"), /identifier|emoji/iu);
  assert.throws(() => displayLabel(presentation, "skill", "unknown"), /unknown|mapping/iu);
});

test("the dynamic subagent fallback is fixed and rejects registry mutation", () => {
  const presentation = { emojiRegistry: { schemaVersion: 1, ...registryFromExpected() }, progressContract: validProgressContract(), canonical: canonicalFromExpected() };
  presentation.emojiRegistry.subagents.default.emoji = "🦄";
  const result = validatePresentationContract(presentation);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === "fixed-subagent-emoji"));
  assert.throws(() => displayLabel(presentation, "subagent", "worker-17"), /fixed|mapping/iu);
});

test("display labels fail closed when an approved entity mapping is changed", () => {
  const presentation = { emojiRegistry: { schemaVersion: 1, ...registryFromExpected() }, progressContract: validProgressContract() };
  presentation.emojiRegistry.skills.brainstorming.emoji = "🦄";
  assert.throws(() => displayLabel(presentation, "skill", "brainstorming"), /approved|mapping/iu);
});

test("invocation guidance includes one announcement, bounded checklist, state transitions, terminal completion, and de-duplication", () => {
  const progressContract = validProgressContract();
  const presentation = { emojiRegistry: { schemaVersion: 1, ...registryFromExpected() }, progressContract };
  const guidance = renderInvocationGuidance(presentation, {
    kind: "command",
    id: "aaa:verify",
    workflowId: "release-qualification",
    task: "Verify the release evidence",
    reason: "Verify the release evidence before handoff."
  });
  assert.match(guidance, /Running command \*\*aaa:verify ✅\*\*/u);
  assert.match(guidance, /Verify the release evidence before handoff\./u);
  assert.match(guidance, /one short, task-specific reason/iu);
  assert.match(guidance, /Checklist/u);
  assert.match(guidance, /2.{0,8}7|2-7/u);
  assert.match(guidance, /state change|only when .*change/iu);
  assert.match(guidance, /terminal|completed/iu);
  assert.match(guidance, /parallel owner/iu);
  assert.match(guidance, /workflow-owned|duplicate checklist|second checklist/iu);
  assert.equal((guidance.match(/^Checklist$/gmu) ?? []).length, 1);
  assert.match(guidance, /⬜/u);
  assert.match(guidance, /task-specific|derive .*steps/iu);
  assert.doesNotMatch(guidance, /Understand the requirement|Complete the scoped work|Verify the result/u);
  assert.match(guidance, /aaa:verify ✅/u);
  assert.match(guidance, /release-qualification 🚦/u);
});

test("invocation guidance rejects a changed checklist marker", () => {
  const progressContract = validProgressContract();
  progressContract.states.pending.emoji = "🔶";
  const presentation = { emojiRegistry: { schemaVersion: 1, ...registryFromExpected() }, progressContract };
  assert.throws(() => renderInvocationGuidance(presentation, { kind: "skill", id: "brainstorming" }), /approved|progress contract|checklist/iu);
});

test("invocation guidance rejects Unicode line separators in visible prose", () => {
  const presentation = { emojiRegistry: { schemaVersion: 1, ...registryFromExpected() }, progressContract: validProgressContract() };
  assert.throws(() => renderInvocationGuidance(presentation, { kind: "skill", id: "brainstorming", reason: "First\u2028second" }), /safe|reason/iu);
  assert.throws(() => renderInvocationGuidance(presentation, { kind: "skill", id: "brainstorming", task: "First\u2029second" }), /safe|task/iu);
});

test("guidance and catalog fail closed for an invalid progress contract", () => {
  const presentation = { emojiRegistry: { schemaVersion: 1, ...registryFromExpected() }, progressContract: validProgressContract() };
  delete presentation.progressContract.states.completed;
  assert.throws(() => renderInvocationGuidance(presentation, { kind: "skill", id: "research" }), /progress contract|checklist state/iu);
  assert.throws(() => renderPresentationCatalog(presentation), /progress contract|checklist state/iu);
});

test("catalog is deterministic, complete, and keeps hooks silent", () => {
  const presentation = { emojiRegistry: { schemaVersion: 1, ...registryFromExpected() }, progressContract: validProgressContract() };
  const catalog = renderPresentationCatalog(presentation);
  const second = renderPresentationCatalog(presentation);
  assert.equal(catalog, second);
  for (const [category, values] of Object.entries(expected)) for (const [id, emoji] of Object.entries(values)) assert.equal((catalog.match(new RegExp(`^- ${escapeRegex(id)} ${escapeRegex(emoji)}$`, "gmu")) ?? []).length, 1, `${category}/${id}`);
  assert.match(catalog, /⬜.*pending/u);
  assert.match(catalog, /⏸️.*not-run/u);
  assert.match(catalog, /hooks?.*report-only|silent.*hooks?/iu);
});

test("loadCore exposes the shared presentation contract", async () => {
  const core = await loadCore(root);
  assert.deepEqual(Object.keys(core.presentation).sort(), ["emojiRegistry", "progressContract"]);
  assert.equal(core.presentation.emojiRegistry.schemaVersion, 1);
  assert.equal(Object.keys(core.presentation.emojiRegistry.skills).length, 28);
  assert.equal(Object.keys(core.presentation.emojiRegistry.roles).length, 7);
  assert.equal(Object.keys(core.presentation.emojiRegistry.commands).length, 8);
});
