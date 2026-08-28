import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const requiredOutputs = [
  "core/skills/using-all-about-agents/SKILL.md",
  "core/evals/skill-routing/using-all-about-agents.json",
  "tests/behavioral/skills/using-all-about-agents.test.mjs",
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

test("bootstrap skill has a concise portable contract", async () => {
  const skill = await readFile(skillPath, "utf8");
  assert.match(skill, /^---\n/u);
  const closing = skill.indexOf("\n---\n", 4);
  assert.ok(closing > 0, "frontmatter must close");
  const frontmatter = skill.slice(4, closing);
  assert.match(frontmatter, /^name:\s*using-all-about-agents\s*$/mu);
  const description = frontmatter.match(/^description:\s*(.+)$/mu)?.[1] ?? "";
  assert.match(description, /^Use when\b/u, "description must lead with its trigger");
  const body = skill.slice(closing + "\n---\n".length).trim();
  assert.ok(body.split(/\s+/u).length <= 500, "bootstrap body must stay under 500 words");
  for (const forbidden of [/\.claude/iu, /\.codex/iu, /\.gemini/iu, /\bRead\b/u, /\bspawn_agent\b/u, /\binvoke_subagent\b/u]) {
    assert.doesNotMatch(skill, forbidden, `portable skill contains forbidden vendor detail: ${forbidden}`);
  }
  assert.doesNotMatch(skill, /\b(?:must|always|unconditionally|required)\b[^.\n]{0,80}\b(?:agent|worker|subagent)\b/iu, "bootstrap must not require a worker unconditionally");
});

const evaluationPath = resolve(process.cwd(), "core/evals/skill-routing/using-all-about-agents.json");
const requiredCaseIds = [
  "UA-TRIGGER-fresh-implementation",
  "UA-NONTRIGGER-already-dispatched-worker",
  "UA-PRESSURE-vendor-path-assumption"
];

test("routing evaluation defines the required scenarios", async () => {
  const evaluation = JSON.parse(await readFile(evaluationPath, "utf8"));
  assert.equal(evaluation.schemaVersion, 1);
  assert.equal(evaluation.skill, "using-all-about-agents");
  assert.deepEqual(evaluation.cases.map((entry) => entry.id), requiredCaseIds);
  assert.equal(new Set(evaluation.cases.map((entry) => entry.id)).size, requiredCaseIds.length);
  for (const entry of evaluation.cases) {
    assert.equal(entry.critical, true, `${entry.id} must be critical`);
    assert.equal(typeof entry.prompt, "string");
    assert.equal(typeof entry.expected, "object");
  }
  const trigger = evaluation.cases[0];
  assert.equal(trigger.expected.skillCheck, "required");
  assert.equal(trigger.expected.simpleFactualCheck, "required");
  const worker = evaluation.cases[1];
  assert.equal(worker.expected.skillCheck, "not-required");
  assert.equal(worker.expected.followTaskContract, true);
  const pressure = evaluation.cases[2];
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
