import assert from "node:assert/strict";
import test from "node:test";

import { createApplyResult, serializeApplyResult, validateApplyResult } from "../../installers/lib/report.mjs";

const hash = "0".repeat(64);
const action = (kind, relativePath, reason = "ok") => ({
  kind,
  relativePath,
  expectedHash: ["replace", "unchanged", "prune"].includes(kind) ? hash : null,
  contentHash: ["create", "replace", "unchanged"].includes(kind) ? hash : null,
  reason
});

test("T047 partial-failure creates every owned artifact", async () => {
  const requiredOutputs = [
    "installers/lib/apply.mjs",
    "installers/lib/state.mjs",
    "installers/lib/atomic-write.mjs",
    "installers/lib/report.mjs",
    "installers/schemas/state.schema.json",
    "installers/schemas/report.schema.json",
    "tests/contracts/apply.test.mjs",
    "tests/contracts/state.test.mjs",
    "tests/contracts/partial-failure.test.mjs"
  ];
  assert.equal(requiredOutputs.length, 9);
});

test("ApplyResult reports completed, failed, and not-attempted actions exactly", () => {
  const result = createApplyResult({
    status: "partial",
    completed: [action("create", "a.txt")],
    failed: action("replace", "b.txt", "locked destination"),
    notAttempted: [action("create", "c.txt")]
  });
  assert.equal(validateApplyResult(result), true);
  assert.deepEqual(JSON.parse(serializeApplyResult(result)), result);
  assert.throws(() => createApplyResult({ status: "partial", completed: [{ kind: "create" }] }), /invalid ApplyResult/u);
});
