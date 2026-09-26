import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const requiredOutputs = [
  "core/skills/using-all-about-agents/SKILL.md",
  "core/evals/skill-routing/using-all-about-agents.json",
  "tests/lint/skills/using-all-about-agents.test.mjs",
  "tests/fixtures/bootstrap-skill/expected-manifest.json",
  "core/inventory.json"
];

test("T004 creates every owned artifact", async () => {
  assert.ok(requiredOutputs.length > 0);
  for (const relativePath of requiredOutputs) {
    await access(resolve(process.cwd(), relativePath));
  }
});

const skillPath = resolve(process.cwd(), "core/skills/using-all-about-agents/SKILL.md");
const unconditionalAgentRequirement = /(?:\b(?:must|always|required|mandatory|unconditionally)\b[^.\n]{0,80}\b(?:agent|worker|subagent)\b|\b(?:agent|worker|subagent)\b[^.\n]{0,80}\b(?:must|always|required|mandatory|unconditionally)\b[^.\n]{0,80}\b(?:every|all|any|each)\s+(?:task|request|conversation|change|job)\b|\b(?:every|all|any|each)\s+(?:task|request|conversation|change|job)\b[^.\n]{0,80}\b(?:requires?|needs?|must|always)\b[^.\n]{0,80}\b(?:agent|worker|subagent)\b)/iu;

test("bootstrap skill has a concise portable contract", async () => {
  const skill = await readFile(skillPath, "utf8");
  assert.match(skill, /^---\n/u);
  const closing = skill.indexOf("\n---\n", 4);
  assert.ok(closing > 0, "frontmatter must close");
  const frontmatter = skill.slice(4, closing);
  assert.match(frontmatter, /^name:\s*using-all-about-agents\s*$/mu);
  assert.equal((frontmatter.match(/^description\s*:/gmu) ?? []).length, 1, "frontmatter must define one description");
  const description = frontmatter.match(/^description:\s*(.+)$/mu)?.[1] ?? "";
  assert.match(description, /^Use when\b/u, "description must lead with its trigger");
  assert.match(frontmatter, /^\s+-\s+adapter-capability-guidance\s*$/mu, "adapter capability guidance must be referenced");
  const body = skill.slice(closing + "\n---\n".length).trim();
  assert.ok(body.split(/\s+/u).length <= 500, "bootstrap body must stay under 500 words");
  for (const forbidden of [/\.claude/iu, /\.codex/iu, /\.gemini/iu, /\bRead\b/u, /\bspawn_agent\b/u, /\binvoke_subagent\b/u]) {
    assert.doesNotMatch(skill, forbidden, `portable skill contains forbidden vendor detail: ${forbidden}`);
  }
  assert.equal(unconditionalAgentRequirement.test("An agent is mandatory for every task"), true, "detector must cover equivalent mandatory wording");
  assert.doesNotMatch(skill, unconditionalAgentRequirement, "bootstrap must not require a worker unconditionally");
});

test("pressure fallback covers missing selected-adapter guidance", async () => {
  const skill = await readFile(skillPath, "utf8");
  assert.match(skill, /When selected adapter guidance, native paths, or syntax are unavailable,/iu);
  assert.match(skill, /name the unavailable capability and affected step, then stop or ask for direction\./iu);
  assert.match(skill, /Do not continue as if supported or invent a path or syntax\./iu);
});

test("fresh implementation routing precedes the first implementation action", async () => {
  const skill = await readFile(skillPath, "utf8");
  assert.match(skill, /For a fresh implementation request, complete the applicability check before the first implementation action\./u);
});

test("simple factual routing still checks applicability before answering", async () => {
  const skill = await readFile(skillPath, "utf8");
  assert.match(skill, /For a simple factual response, complete the applicability check before answering\./u);
});

test("assigned workers follow their contract without restarting bootstrap", async () => {
  const skill = await readFile(skillPath, "utf8");
  assert.match(skill, /An already-dispatched worker must follow its task contract without restarting this bootstrap\./u);
});

const evaluationPath = resolve(process.cwd(), "core/evals/skill-routing/using-all-about-agents.json");
const requiredCaseIds = [
  "UA-TRIGGER-fresh-implementation",
  "UA-NONTRIGGER-already-dispatched-worker",
  "UA-PRESSURE-vendor-path-assumption"
];

test("routing evaluation defines the required scenarios", async () => {
  const evaluation = JSON.parse(await readFile(evaluationPath, "utf8"));
  const requiredExpectedKeys = [
    "skillCheck",
    "simpleFactualCheck",
    "selectApplicableGuidanceBeforeAction",
    "restartBootstrap",
    "continueAsIfSupported",
    "followTaskContract",
    "unavailableCapability",
    "inventDetails"
  ];
  assert.equal(evaluation.schemaVersion, 1);
  assert.equal(evaluation.skill, "using-all-about-agents");
  assert.deepEqual(evaluation.cases.map((entry) => entry.id), requiredCaseIds);
  assert.equal(new Set(evaluation.cases.map((entry) => entry.id)).size, requiredCaseIds.length);
  for (const entry of evaluation.cases) {
    assert.equal(entry.critical, true, `${entry.id} must be critical`);
    assert.equal(typeof entry.prompt, "string");
    assert.equal(typeof entry.expected, "object");
    for (const key of requiredExpectedKeys) assert.ok(Object.hasOwn(entry.expected, key), `${entry.id} is missing expected.${key}`);
    assert.ok(Array.isArray(entry.observables) && entry.observables.length > 0, `${entry.id} must define nonempty observables`);
    assert.ok(entry.observables.every((observable) => typeof observable === "string" && observable.trim().length > 0), `${entry.id} observables must be nonempty strings`);
  }
  const trigger = evaluation.cases[0];
  assert.deepEqual(trigger.expected, {
    skillCheck: "required",
    simpleFactualCheck: "required",
    selectApplicableGuidanceBeforeAction: true,
    restartBootstrap: false,
    continueAsIfSupported: true,
    followTaskContract: false,
    unavailableCapability: "not-applicable",
    inventDetails: false
  });
  assert.equal(trigger.expected.skillCheck, "required");
  assert.equal(trigger.expected.simpleFactualCheck, "required");
  const worker = evaluation.cases[1];
  assert.deepEqual(worker.expected, {
    skillCheck: "not-required",
    simpleFactualCheck: "not-applicable",
    selectApplicableGuidanceBeforeAction: false,
    continueAsIfSupported: true,
    followTaskContract: true,
    unavailableCapability: "not-applicable",
    restartBootstrap: false,
    inventDetails: false
  });
  assert.equal(worker.expected.skillCheck, "not-required");
  assert.equal(worker.expected.followTaskContract, true);
  const pressure = evaluation.cases[2];
  assert.deepEqual(pressure.expected, {
    skillCheck: "required",
    simpleFactualCheck: "not-applicable",
    selectApplicableGuidanceBeforeAction: true,
    restartBootstrap: false,
    continueAsIfSupported: false,
    followTaskContract: false,
    unavailableCapability: "report",
    inventDetails: false
  });
  assert.equal(pressure.expected.unavailableCapability, "report");
  assert.equal(pressure.expected.inventDetails, false);
});

test("adapter acceptance fixture pins the canonical public name and content hash", async () => {
  const manifest = JSON.parse(await readFile(resolve(process.cwd(), "tests/fixtures/bootstrap-skill/expected-manifest.json"), "utf8"));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.publicName, "using-all-about-agents");
  assert.equal(manifest.canonicalPath, "core/skills/using-all-about-agents/SKILL.md");
  assert.match(manifest.sha256, /^[a-f0-9]{64}$/u);
  const digest = createHash("sha256").update(await readFile(skillPath)).digest("hex");
  assert.equal(manifest.sha256, digest);
});

test("core loader accepts the canonical skill and links its routing cases", async () => {
  const { loadCore } = await import("../../../installers/lib/load-core.mjs");
  const core = await loadCore(process.cwd());
  const skill = core.skills.find((entry) => entry.id === "using-all-about-agents");
  assert.ok(skill);
  assert.equal(skill.name, "using-all-about-agents");
  assert.deepEqual(skill.capabilities, ["role-dispatch", "schema-validation"]);
  assert.deepEqual(skill.evaluationCases, requiredCaseIds);
  assert.deepEqual(core.evals.find((entry) => entry.id === "using-all-about-agents-routing")?.cases.map((entry) => entry.id), requiredCaseIds);
});

test("codex reference never auto-commits and cites real step numbers", async () => {
  const reference = await readFile(resolve(process.cwd(), "core/skills/using-all-about-agents/references/codex-tools.md"), "utf8");
  assert.doesNotMatch(reference, /commits all work/iu);
  assert.doesNotMatch(reference, /Step 0/u);
  assert.match(reference, /explicit/iu);
});
