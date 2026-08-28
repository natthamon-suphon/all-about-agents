import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { validateSchema } from "../../installers/lib/validate-schema.mjs";

const surfaces = ["claude", "codex", "antigravity-2", "agy"];

async function loadCapability(surface) {
  const path = resolve(process.cwd(), `adapters/${surface}/capabilities.json`);
  return JSON.parse(await readFile(path, "utf8"));
}

test("capability records exist for every supported surface", async () => {
  for (const surface of surfaces) {
    await access(resolve(process.cwd(), `adapters/${surface}/capabilities.json`));
  }
  await access(resolve(process.cwd(), "core/schemas/capability.schema.json"));
});

test("capability records use the strict shared record shape", async () => {
  for (const surface of surfaces) {
    const record = await loadCapability(surface);
    assert.equal(record.surface, surface);
    assert.match(record.checkedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(typeof record.productVersion === "string");
    assert.ok(Array.isArray(record.capabilities));
    assert.ok(record.capabilities.length > 0);
    for (const capability of record.capabilities) {
      for (const key of ["feature", "support", "stability", "source", "checkedAt", "productVersion"]) {
        assert.ok(Object.hasOwn(capability, key), `${surface} capability missing ${key}`);
      }
      assert.ok(capability.source.length > 0);
      assert.match(capability.checkedAt, /^\d{4}-\d{2}-\d{2}$/);
    }
  }
});

test("capability evidence keeps unsupported and unknown claims explicit", async () => {
  const codex = await loadCapability("codex");
  const fallback = codex.capabilities.find((item) => item.feature === "model.automatic-fallback");
  assert.ok(fallback);
  assert.equal(fallback.support, "unsupported");
  assert.equal(fallback.stability, "unsupported");
  assert.match(fallback.source, /research-model-policy-codex\.md$/);

  const antigravity = await loadCapability("antigravity-2");
  const persistence = antigravity.capabilities.find((item) => item.feature === "desktop.model-persistence");
  assert.ok(persistence);
  assert.equal(persistence.support, "unknown");
  assert.equal(persistence.stability, "unknown");
});

test("strict schemas reject undeclared capability properties", async () => {
  const schema = JSON.parse(await readFile(resolve(process.cwd(), "core/schemas/capability.schema.json"), "utf8"));
  const valid = await loadCapability("claude");
  assert.equal(validateSchema({ schema, value: valid, sourcePath: "adapters/claude/capabilities.json" }).valid, true);
  const invalid = { ...valid, unexpected: true };
  const result = validateSchema({ schema, value: invalid, sourcePath: "fixture.json" });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.keyword === "additionalProperties"));
});

test("every adapter record validates and active claims retain evidence", async () => {
  const schema = JSON.parse(await readFile(resolve(process.cwd(), "core/schemas/capability.schema.json"), "utf8"));
  for (const surface of surfaces) {
    const record = await loadCapability(surface);
    const result = validateSchema({ schema, value: record, sourcePath: `adapters/${surface}/capabilities.json` });
    assert.equal(result.valid, true, `${surface}: ${JSON.stringify(result.errors)}`);
    for (const capability of record.capabilities) {
      if (capability.support === "supported") assert.notEqual(capability.source, "unknown");
    }
  }
});
