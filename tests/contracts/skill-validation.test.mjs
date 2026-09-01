import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

let validateSkillArtifacts;
try {
  ({ validateSkillArtifacts } = await import("../../installers/lib/validate-skill.mjs"));
} catch (error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
}

const SKILL_ID = "alpha";
const CASE_IDS = ["AL-TRIGGER-use", "AL-NONTRIGGER-neighbor", "AL-PRESSURE-skip-proof"];

function evaluation(cases = CASE_IDS) {
  return {
    schemaVersion: 1,
    id: "alpha-routing",
    skill: SKILL_ID,
    kind: "skill-routing",
    cases: cases.map((id) => ({
      id,
      critical: true,
      prompt: `Prompt for ${id}`,
      expected: { decision: "bounded" },
      observables: [`Observe ${id}`]
    }))
  };
}

function inventory() {
  return {
    schemaVersion: 1,
    skills: [SKILL_ID],
    skillSources: [{
      name: SKILL_ID,
      source: `skills/${SKILL_ID}/SKILL.md`,
      assets: [`skills/${SKILL_ID}/guide.md`],
      scripts: []
    }]
  };
}

function coreFor(currentInventory = inventory(), currentEvaluation = evaluation()) {
  return {
    inventory: currentInventory,
    skills: [{
      id: SKILL_ID,
      name: SKILL_ID,
      description: "Use when alpha behavior is needed.",
      content: "Alpha body.",
      capabilities: ["repository-read"],
      evaluationCases: currentEvaluation.cases.map((entry) => entry.id),
      companions: [{
        canonicalPath: `skills/${SKILL_ID}/guide.md`,
        relativePath: "guide.md",
        kind: "asset",
        content: "# Guide\n",
        mode: null
      }]
    }],
    evals: [currentEvaluation]
  };
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "aaa-skill-validation-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(resolve(root, "core", "skills", SKILL_ID), { recursive: true });
  await mkdir(resolve(root, "core", "evals", "skill-routing"), { recursive: true });
  await mkdir(resolve(root, "tests", "behavioral", "skills"), { recursive: true });
  const currentInventory = inventory();
  const currentEvaluation = evaluation();
  await writeFile(resolve(root, "core", "inventory.json"), `${JSON.stringify(currentInventory, null, 2)}\n`);
  await writeFile(resolve(root, "core", "skills", SKILL_ID, "SKILL.md"), `---\nname: ${SKILL_ID}\ndescription: Use when alpha behavior is needed.\nevaluationCases:\n${CASE_IDS.map((id) => `  - ${id}`).join("\n")}\n---\n\n# Alpha\n\nRead [the guide](guide.md).\n`);
  await writeFile(resolve(root, "core", "skills", SKILL_ID, "guide.md"), "# Guide\n");
  await writeFile(resolve(root, "core", "evals", "skill-routing", `${SKILL_ID}.json`), `${JSON.stringify(currentEvaluation, null, 2)}\n`);
  await writeFile(resolve(root, "tests", "behavioral", "skills", `${SKILL_ID}.test.mjs`), `import test from "node:test";\ntest("${SKILL_ID} behavior", () => {});\n`);
  return { root, inventory: currentInventory, evaluation: currentEvaluation, core: coreFor(currentInventory, currentEvaluation) };
}

function codes(result) {
  return result.errors.map((entry) => entry.code);
}

test("skill validator exposes its public interface", () => {
  assert.equal(typeof validateSkillArtifacts, "function", "validateSkillArtifacts must be exported");
});

test("skill validator accepts a complete owned skill", async (t) => {
  const sample = await fixture(t);
  const result = await validateSkillArtifacts({ repositoryRoot: sample.root, core: sample.core, skillId: SKILL_ID });

  assert.equal(result.valid, true);
  assert.equal(result.skillId, SKILL_ID);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.cases.map((entry) => [entry.kind, entry.status]), [
    ["trigger", "PASS"],
    ["nontrigger", "PASS"],
    ["pressure", "PASS"]
  ]);
  assert.ok(result.artifacts.every((entry) => entry.status === "PASS"));
  assert.deepEqual(result.artifacts.map((entry) => entry.path), [...result.artifacts.map((entry) => entry.path)].sort());
});

test("skill validator reports missing source and inventory ownership", async (t) => {
  const missingSource = await fixture(t);
  await rm(resolve(missingSource.root, "core", "skills", SKILL_ID, "SKILL.md"));
  const sourceResult = await validateSkillArtifacts({ repositoryRoot: missingSource.root, core: missingSource.core, skillId: SKILL_ID });
  assert.equal(sourceResult.valid, false);
  assert.ok(codes(sourceResult).includes("missing-skill-source"));

  const missingInventory = await fixture(t);
  missingInventory.core.inventory.skills = [];
  missingInventory.core.inventory.skillSources = [];
  const inventoryResult = await validateSkillArtifacts({ repositoryRoot: missingInventory.root, core: missingInventory.core, skillId: SKILL_ID });
  assert.equal(inventoryResult.valid, false);
  assert.ok(codes(inventoryResult).includes("missing-inventory-record"));
});

test("skill validator reports missing and invalid companions", async (t) => {
  const missing = await fixture(t);
  await rm(resolve(missing.root, "core", "skills", SKILL_ID, "guide.md"));
  const missingResult = await validateSkillArtifacts({ repositoryRoot: missing.root, core: missing.core, skillId: SKILL_ID });
  assert.ok(codes(missingResult).includes("missing-companion"));

  const invalid = await fixture(t);
  invalid.core.inventory.skillSources[0].assets = [`skills/${SKILL_ID}/../outside.md`];
  const invalidResult = await validateSkillArtifacts({ repositoryRoot: invalid.root, core: invalid.core, skillId: SKILL_ID });
  assert.ok(codes(invalidResult).includes("invalid-companion"));
});

test("skill validator requires routing eval and all three case kinds", async (t) => {
  const missing = await fixture(t);
  await rm(resolve(missing.root, "core", "evals", "skill-routing", `${SKILL_ID}.json`));
  const missingResult = await validateSkillArtifacts({ repositoryRoot: missing.root, core: missing.core, skillId: SKILL_ID });
  assert.ok(codes(missingResult).includes("missing-routing-eval"));

  for (const [token, expectedCode] of [
    ["-TRIGGER-", "missing-trigger-case"],
    ["-NONTRIGGER-", "missing-nontrigger-case"],
    ["-PRESSURE-", "missing-pressure-case"]
  ]) {
    const sample = await fixture(t);
    const reduced = evaluation(CASE_IDS.filter((id) => !id.includes(token)));
    sample.core.evals = [reduced];
    sample.core.skills[0].evaluationCases = reduced.cases.map((entry) => entry.id);
    await writeFile(resolve(sample.root, "core", "evals", "skill-routing", `${SKILL_ID}.json`), `${JSON.stringify(reduced, null, 2)}\n`);
    const result = await validateSkillArtifacts({ repositoryRoot: sample.root, core: sample.core, skillId: SKILL_ID });
    assert.ok(codes(result).includes(expectedCode), expectedCode);
  }
});

test("skill validator requires exact behavioral-test ownership", async (t) => {
  const sample = await fixture(t);
  await rm(resolve(sample.root, "tests", "behavioral", "skills", `${SKILL_ID}.test.mjs`));
  const result = await validateSkillArtifacts({ repositoryRoot: sample.root, core: sample.core, skillId: SKILL_ID });
  assert.ok(codes(result).includes("missing-behavioral-test"));
});

test("skill validator rejects escaping Markdown references", async (t) => {
  const sample = await fixture(t);
  const skillPath = resolve(sample.root, "core", "skills", SKILL_ID, "SKILL.md");
  const content = await readFile(skillPath, "utf8");
  await writeFile(skillPath, content.replace("(guide.md)", "(../outside.md)"));
  const result = await validateSkillArtifacts({ repositoryRoot: sample.root, core: sample.core, skillId: SKILL_ID });
  assert.ok(codes(result).includes("invalid-skill-reference"));
});

test("skill validator rejects routing ownership mismatch", async (t) => {
  const sample = await fixture(t);
  const mismatch = { ...sample.evaluation, skill: "beta" };
  await writeFile(resolve(sample.root, "core", "evals", "skill-routing", `${SKILL_ID}.json`), `${JSON.stringify(mismatch, null, 2)}\n`);
  const result = await validateSkillArtifacts({ repositoryRoot: sample.root, core: sample.core, skillId: SKILL_ID });
  assert.ok(codes(result).includes("ownership-mismatch"));
});

test("skill validator rejects unsafe skill IDs before file access", async () => {
  for (const skillId of ["", "../alpha", "C:\\alpha", "alpha/beta", "Alpha"]) {
    await assert.rejects(
      () => validateSkillArtifacts({ repositoryRoot: process.cwd(), core: {}, skillId }),
      /skillId/iu
    );
  }
});
