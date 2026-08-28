import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { validateCommandRecords } from "../../adapters/shared/adapter-contract.mjs";

const requiredOutputs = [
  "core/commands/design/command.json",
  "core/commands/build/command.json",
  "core/commands/fix/command.json",
  "core/commands/review/command.json",
  "core/commands/audit/command.json",
  "core/commands/improve-skill/command.json",
  "core/commands/resume/command.json",
  "core/commands/verify/command.json",
  "adapters/shared/adapter-contract.mjs",
  "adapters/shared/render-utils.mjs",
  "tests/contracts/commands.test.mjs",
  "tests/contracts/adapter-contract.test.mjs"
];

test("T007 creates every owned artifact", async () => {
  assert.ok(requiredOutputs.length > 0);
  for (const relativePath of requiredOutputs) {
    await access(resolve(process.cwd(), relativePath));
  }
});

const actionIds = [
  "aaa:design",
  "aaa:build",
  "aaa:fix",
  "aaa:review",
  "aaa:audit",
  "aaa:improve-skill",
  "aaa:resume",
  "aaa:verify"
];

const workflowIds = [
  "design-change",
  "implement-change",
  "fix-bug",
  "review-and-audit",
  "improve-skill",
  "release-qualification"
];

const actionWorkflows = {
  "aaa:design": "design-change",
  "aaa:build": "implement-change",
  "aaa:fix": "fix-bug",
  "aaa:review": "review-and-audit",
  "aaa:audit": "review-and-audit",
  "aaa:improve-skill": "improve-skill",
  "aaa:resume": "implement-change",
  "aaa:verify": "release-qualification"
};

async function readCommands() {
  return Promise.all(actionIds.map(async (actionId) => {
    const id = actionId.slice(4);
    const sourcePath = resolve(process.cwd(), `core/commands/${id}/command.json`);
    return JSON.parse(await readFile(sourcePath, "utf8"));
  }));
}

test("canonical commands are thin strict records with unique mapped actions", async () => {
  const records = await readCommands();
  assert.deepEqual(records.map((record) => record.actionId), actionIds);
  for (const record of records) {
    assert.deepEqual(Object.keys(record).sort(), ["$schema", "actionId", "arguments", "id", "presentation", "result", "workflowId"].sort());
    assert.equal(record.workflowId, actionWorkflows[record.actionId]);
    assert.deepEqual(Object.keys(record.arguments).sort(), ["additionalProperties", "properties", "required", "type"]);
    assert.deepEqual(Object.keys(record.result).sort(), ["additionalProperties", "properties", "required", "type"]);
    assert.deepEqual(Object.keys(record.presentation).sort(), ["help", "label"]);
  }
  const result = validateCommandRecords(records, workflowIds);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

test("command validation rejects duplicate action IDs", async () => {
  const records = await readCommands();
  const duplicate = structuredClone(records);
  duplicate[1].actionId = duplicate[0].actionId;
  const result = validateCommandRecords(duplicate, workflowIds);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === "duplicate-action-id"));
});

test("command validation rejects embedded workflow logic", async () => {
  const records = await readCommands();
  const embedded = structuredClone(records);
  embedded[0].states = ["discover-context"];
  const result = validateCommandRecords(embedded, workflowIds);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === "embedded-workflow"));
});

test("command validation rejects an absent or unknown workflow mapping", async () => {
  const records = await readCommands();
  const absent = structuredClone(records);
  delete absent[0].workflowId;
  const absentResult = validateCommandRecords(absent, workflowIds);
  assert.equal(absentResult.valid, false);
  assert.ok(absentResult.errors.some((error) => error.code === "missing-workflow"));

  const unknown = structuredClone(records);
  unknown[0].workflowId = "not-a-workflow";
  const unknownResult = validateCommandRecords(unknown, workflowIds);
  assert.equal(unknownResult.valid, false);
  assert.ok(unknownResult.errors.some((error) => error.code === "unknown-workflow"));
});

test("command validation requires the complete canonical action set", async () => {
  const records = await readCommands();
  const emptyResult = validateCommandRecords([], workflowIds);
  assert.equal(emptyResult.valid, false);
  assert.ok(emptyResult.errors.some((error) => error.code === "missing-action"));

  const partialResult = validateCommandRecords(records.slice(0, -1), workflowIds);
  assert.equal(partialResult.valid, false);
  assert.ok(partialResult.errors.some((error) => error.code === "missing-action"));

  const unknown = structuredClone(records);
  unknown[0].actionId = "aaa:unknown";
  const unknownResult = validateCommandRecords(unknown, workflowIds);
  assert.equal(unknownResult.valid, false);
  assert.ok(unknownResult.errors.some((error) => error.code === "unknown-action"));
});
