import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
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
