import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { join } from "node:path";
import test from "node:test";

const requiredOutputs = [
  "installers/lib/load-core.mjs",
  "core/schemas/rule.schema.json",
  "core/schemas/role.schema.json",
  "core/schemas/workflow.schema.json",
  "core/schemas/command.schema.json",
  "core/schemas/skill.schema.json",
  "tests/contracts/core-loader.test.mjs",
  "tests/fixtures/core/valid/",
  "tests/fixtures/core/broken-reference/",
  "tests/fixtures/core/duplicate-id/",
  "tests/fixtures/core/unknown-field/"
];

test("T003 creates every owned artifact", async () => {
  assert.ok(requiredOutputs.length > 0);
  for (const relativePath of requiredOutputs) {
    await access(resolve(process.cwd(), relativePath));
  }
});

const fixture = (name) => resolve(process.cwd(), "tests/fixtures/core", name);

async function loader() {
  return import("../../installers/lib/load-core.mjs");
}

test("loadCore returns deterministic sorted collections from a valid core", async () => {
  const { loadCore } = await loader();
  const first = await loadCore(fixture("valid"));
  const second = await loadCore(fixture("valid"));
  assert.deepEqual(first, second);
  assert.deepEqual(first.rules.map((record) => record.id), ["a-rule", "z-rule"]);
  assert.deepEqual(first.roles.map((record) => record.id), ["reviewer"]);
  assert.deepEqual(first.skills.map((record) => record.id), ["alpha", "beta"]);
  assert.deepEqual(first.workflows.map((record) => record.id), ["a-flow", "z-flow"]);
  assert.deepEqual(first.commands.map((record) => record.id), ["a-command", "z-command"]);
  assert.deepEqual(first.evals.map((record) => record.id), ["a-eval", "z-eval"]);
});

test("loadCore reports missing references with the source path and JSON pointer", async () => {
  const { loadCore } = await loader();
  await assert.rejects(loadCore(fixture("broken-reference")), (error) => {
    assert.equal(error.name, "CoreLoadError");
    assert.ok(error.errors.some((entry) =>
      entry.sourcePath === "core/rules/broken.json" &&
      entry.jsonPointer === "/skills/0" &&
      entry.keyword === "reference"
    ));
    assert.match(error.message, /core\/rules\/broken\.json#\/skills\/0/u);
    return true;
  });
});

test("loadCore rejects duplicate IDs in one collection", async () => {
  const { loadCore } = await loader();
  await assert.rejects(loadCore(fixture("duplicate-id")), (error) => {
    assert.ok(error.errors.some((entry) =>
      entry.sourcePath === "core/rules/second.json" &&
      entry.jsonPointer === "/id" &&
      entry.keyword === "duplicateId"
    ));
    return true;
  });
});

test("loadCore rejects unknown fields and vendor tool names in portable metadata", async () => {
  const { loadCore } = await loader();
  await assert.rejects(loadCore(fixture("unknown-field")), (error) => {
    assert.ok(error.errors.some((entry) =>
      entry.sourcePath === "core/rules/unknown.json" &&
      entry.jsonPointer === "/unexpected" &&
      entry.keyword === "additionalProperties"
    ));
    assert.ok(error.errors.some((entry) =>
      entry.sourcePath === "core/rules/unknown.json" &&
      entry.jsonPointer === "/capabilities/0" &&
      entry.keyword === "semanticCapability"
    ));
    assert.ok(error.errors.some((entry) =>
      entry.sourcePath === "core/rules/unknown.json" &&
      entry.jsonPointer === "/capabilities/0" &&
      entry.keyword === "vendorTool"
    ));
    assert.ok(error.errors.some((entry) =>
      entry.sourcePath === "core/skills/alpha/SKILL.md" &&
      entry.jsonPointer === "/frontmatter/capabilities" &&
      entry.keyword === "frontmatterType"
    ));
    assert.ok(error.errors.some((entry) =>
      entry.sourcePath === "core/commands/unknown-command.json" &&
      entry.jsonPointer === "/arguments/operation" &&
      entry.keyword === "vendorTool"
    ));
    for (const [index, name] of ["MultiEdit", "Agent", "Skill", "TodoWrite", "PowerShell"].entries()) {
      assert.ok(error.errors.some((entry) =>
        entry.sourcePath === "core/commands/native-names.json" &&
        entry.jsonPointer === `/arguments/nested/${index}` &&
        entry.keyword === "vendorTool"
      ), `nested vendor tool ${name} was not rejected`);
    }
    return true;
  });
});

test("core schemas are strict and expose the five canonical record contracts", async () => {
  const { validateSchema } = await import("../../installers/lib/validate-schema.mjs");
  for (const kind of ["rule", "role", "workflow", "command", "skill"]) {
    const schema = JSON.parse(await readFile(resolve(process.cwd(), `core/schemas/${kind}.schema.json`), "utf8"));
    assert.equal(schema.additionalProperties, false, `${kind} schema must be strict`);
    const invalid = { id: "example", unexpected: true };
    const result = validateSchema({ schema, value: invalid, sourcePath: `core/${kind}.json` });
    assert.equal(result.valid, false, `${kind} schema must reject unknown fields`);
    assert.ok(result.errors.some((entry) => entry.jsonPointer === "/unexpected"));
  }
});

test("validate accepts the exact core scope and rejects incomplete skill scope", async () => {
  const { main } = await import("../../scripts/aaa.mjs");
  const output = { write() {} };
  const errors = { write() {} };
  assert.equal(await main(["validate", "--scope", "core"], output, errors), 0);
  assert.equal(await main(["validate", "--scope", "skill"], output, errors), 2);
  assert.equal(await main(["validate", "--scope", "other"], output, errors), 2);
});

test("skill validation requires the exact skill to be listed in inventory.skills", async () => {
  const root = await mkdtemp(join(tmpdir(), "aaa-t003-inventory-membership-"));
  try {
    await mkdir(resolve(root, "core/skills/requested"), { recursive: true });
    await mkdir(resolve(root, "core/evals"), { recursive: true });
    await writeFile(resolve(root, "package.json"), JSON.stringify({ type: "module", engines: { node: ">=22.12.0" } }));
    await writeFile(resolve(root, "core/inventory.json"), JSON.stringify({ schemaVersion: 1, skills: ["other"] }));
    await writeFile(resolve(root, "core/skills/requested/SKILL.md"), "---\nname: requested\ndescription: A requested skill.\n---\n\nContent.\n");
    await writeFile(resolve(root, "core/evals/requested.json"), JSON.stringify({ id: "requested", skill: "requested", cases: ["case"] }));
    const result = spawnSync(process.execPath, [resolve(process.cwd(), "scripts/aaa.mjs"), "validate", "--scope", "skill", "--skill", "requested"], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /inventory\.skills/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadCore validates inventory against its strict schema when the schema is present", async () => {
  const root = await mkdtemp(join(tmpdir(), "aaa-t003-inventory-schema-"));
  try {
    await mkdir(resolve(root, "core/schemas"), { recursive: true });
    const schema = await readFile(resolve(process.cwd(), "core/schemas/inventory.schema.json"), "utf8");
    await writeFile(resolve(root, "core/schemas/inventory.schema.json"), schema);
    await writeFile(resolve(root, "core/inventory.json"), JSON.stringify({ schemaVersion: 1, skills: [], unexpected: true }));
    const { loadCore } = await loader();
    await assert.rejects(loadCore(root), (error) => {
      assert.ok(error.errors.some((entry) => entry.sourcePath === "core/inventory.json" && entry.jsonPointer === "/unexpected" && entry.keyword === "additionalProperties"));
      return true;
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
