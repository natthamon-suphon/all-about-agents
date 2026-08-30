import assert from "node:assert/strict";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";

import { withTempRoot } from "../helpers/temp-root.mjs";
import { buildPlan } from "../../installers/lib/plan.mjs";
import { hashBytes } from "../../installers/lib/hash.mjs";
import { applyPlan, STATE_RELATIVE_PATH } from "../../installers/lib/apply.mjs";
import { validateSchema } from "../../installers/lib/validate-schema.mjs";
import reportSchema from "../../installers/schemas/report.schema.json" with { type: "json" };

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

test("T047 creates every owned artifact", async () => {
  assert.ok(requiredOutputs.length > 0);
  for (const relativePath of requiredOutputs) {
    await access(resolve(process.cwd(), relativePath));
  }
});

const bytes = (value) => new TextEncoder().encode(value);
const planFor = (root, files, previousState = null) => buildPlan({
  destinationRoot: root,
  previousState,
  payload: {
    files: files.map(([relativePath, content]) => ({ relativePath, content: bytes(content), mode: null })),
    registrations: [{ kind: "profile-translation", surface: "claude" }],
    diagnostics: [],
    ownership: files.map(([relativePath, content]) => ({ relativePath, sha256: hashBytes(bytes(content)) }))
  }
});
const fsFor = (files, overrides = {}) => ({
  contents: new Map(files.map(([relativePath, content]) => [relativePath, bytes(content)])),
  repositoryVersion: "test-repository",
  profile: "portable",
  surfaces: ["claude"],
  ...overrides
});

test("applyPlan validates every rendered byte before its first destination write", async () => {
  await withTempRoot(async (root) => {
    const plan = planFor(root, [["a.txt", "a"], ["b.txt", "b"]]);
    let writes = 0;
    const fileSystem = fsFor([["a.txt", "a"]], { writeFile: async (...args) => { writes += 1; return writeFile(...args); } });
    const result = await applyPlan({ plan, fileSystem });
    assert.equal(result.status, "failed");
    assert.match(result.failed.reason, /content|missing|rejected/u);
    assert.equal(writes, 0);
    assert.deepEqual(result.notAttempted.map((action) => action.relativePath), ["a.txt"]);
    assert.equal(await access(join(root, "a.txt")).then(() => true, () => false), false);
  });
});

test("applyPlan atomically creates and replaces files and preserves unknown neighbors", async () => {
  await withTempRoot(async (root) => {
    await writeFile(join(root, "neighbor.txt"), "keep");
    const plan = planFor(root, [["a.txt", "new"]]);
    const tempDirectories = [];
    const fileSystem = fsFor([["a.txt", "new"]], {
      rename: async (from, to) => {
        assert.equal(resolve(from, ".."), resolve(to, ".."));
        tempDirectories.push(resolve(from, ".."));
        return rename(from, to);
      }
    });
    const result = await applyPlan({ plan, fileSystem });
    assert.equal(result.status, "complete");
    assert.deepEqual(result.completed.map((action) => action.relativePath), ["a.txt"]);
    assert.equal(await readFile(join(root, "a.txt"), "utf8"), "new");
    assert.equal(await readFile(join(root, "neighbor.txt"), "utf8"), "keep");
    assert.ok(tempDirectories.length >= 2);
    assert.ok(tempDirectories.every((directory) => directory === resolve(root) || directory === resolve(root, ".all-about-agents")));
    assert.equal(await access(join(root, STATE_RELATIVE_PATH)).then(() => true, () => false), true);
    assert.equal(validateSchema({ schema: reportSchema, value: result, sourcePath: "report.json" }).valid, true);
  });
});

test("applyPlan replaces only the exact planned bytes and refuses a stale destination", async () => {
  await withTempRoot(async (root) => {
    await writeFile(join(root, "replace.txt"), "before");
    const plan = planFor(root, [["replace.txt", "after"]]);
    const replaced = await applyPlan({ plan, fileSystem: fsFor([["replace.txt", "after"]]) });
    assert.equal(replaced.status, "complete");
    assert.equal(await readFile(join(root, "replace.txt"), "utf8"), "after");

    await writeFile(join(root, "replace.txt"), "changed-out-of-band");
    let writes = 0;
    const stale = await applyPlan({ plan, fileSystem: fsFor([["replace.txt", "after"]], {
      writeFile: async (...args) => { writes += 1; return writeFile(...args); }
    }) });
    assert.equal(stale.status, "failed");
    assert.match(stale.failed.reason, /changed|planning/u);
    assert.equal(writes, 0);
    assert.equal(await readFile(join(root, "replace.txt"), "utf8"), "changed-out-of-band");
  });
});

test("applyPlan stops at the first runtime failure and reports exact partial state", async () => {
  await withTempRoot(async (root) => {
    const plan = planFor(root, [["a.txt", "a"], ["b.txt", "b"], ["c.txt", "c"]]);
    const fileSystem = fsFor([["a.txt", "a"], ["b.txt", "b"], ["c.txt", "c"]], {
      rename: async (from, to) => {
        if (to.endsWith(`${join("", "b.txt")}`)) {
          const error = new Error("locked destination");
          error.code = "EPERM";
          throw error;
        }
        return rename(from, to);
      }
    });
    const result = await applyPlan({ plan, fileSystem });
    assert.equal(result.status, "partial");
    assert.deepEqual(result.completed.map((action) => action.relativePath), ["a.txt"]);
    assert.equal(result.failed.relativePath, "b.txt");
    assert.deepEqual(result.notAttempted.map((action) => action.relativePath), ["c.txt"]);
    assert.equal(await readFile(join(root, "a.txt"), "utf8"), "a");
    assert.equal(await access(join(root, "b.txt")).then(() => true, () => false), false);
    assert.equal(await access(join(root, "c.txt")).then(() => true, () => false), false);
    assert.equal(await access(join(root, STATE_RELATIVE_PATH)).then(() => true, () => false), false);
  });
});

test("applyPlan reports permission and final-hash failures without rollback", async () => {
  await withTempRoot(async (root) => {
    const permissionPlan = planFor(root, [["permission.txt", "data"]]);
    const permissionResult = await applyPlan({ plan: permissionPlan, fileSystem: fsFor([["permission.txt", "data"]], {
      writeFile: async () => { const error = new Error("permission denied"); error.code = "EACCES"; throw error; }
    }) });
    assert.equal(permissionResult.status, "failed");
    assert.equal(permissionResult.failed.relativePath, "permission.txt");

    const hashPlan = planFor(root, [["hash.txt", "data"]]);
    const hashResult = await applyPlan({ plan: hashPlan, fileSystem: fsFor([["hash.txt", "data"]], {
      rename: async (from, to) => {
        await rename(from, to);
        await writeFile(to, "tampered");
      }
    }) });
    assert.equal(hashResult.status, "failed");
    assert.equal(hashResult.failed.relativePath, "hash.txt");
    assert.match(hashResult.failed.reason, /hash|apply failed/u);
  });
});

test("applyPlan writes state only after content actions and reports state-write failure", async () => {
  await withTempRoot(async (root) => {
    const plan = planFor(root, [["a.txt", "a"]]);
    const fileSystem = fsFor([["a.txt", "a"]], {
      rename: async (from, to) => {
        if (to.endsWith(STATE_RELATIVE_PATH.replaceAll("/", "\\")) || to.endsWith(STATE_RELATIVE_PATH)) {
          const error = new Error("state destination locked");
          error.code = "EPERM";
          throw error;
        }
        return rename(from, to);
      }
    });
    const result = await applyPlan({ plan, fileSystem });
    assert.equal(result.status, "partial");
    assert.deepEqual(result.completed.map((action) => action.relativePath), ["a.txt"]);
    assert.equal(result.failed.relativePath, STATE_RELATIVE_PATH);
    assert.equal(result.failed.kind, "reject");
    assert.equal(await readFile(join(root, "a.txt"), "utf8"), "a");
    assert.equal(await access(join(root, STATE_RELATIVE_PATH)).then(() => true, () => false), false);
  });
});

test("applyPlan verifies the final managed-state hash", async () => {
  await withTempRoot(async (root) => {
    const plan = planFor(root, [["a.txt", "a"]]);
    const fileSystem = fsFor([["a.txt", "a"]], {
      rename: async (from, to) => {
        await rename(from, to);
        if (to.endsWith(STATE_RELATIVE_PATH.replaceAll("/", "\\")) || to.endsWith(STATE_RELATIVE_PATH)) await writeFile(to, "tampered-state");
      }
    });
    const result = await applyPlan({ plan, fileSystem });
    assert.equal(result.status, "partial");
    assert.equal(result.failed.relativePath, STATE_RELATIVE_PATH);
    assert.match(result.failed.reason, /hash|apply failed/u);
    assert.equal(await readFile(join(root, "a.txt"), "utf8"), "a");
  });
});

test("applyPlan is idempotent after a managed state-backed rerun and prunes only owned stale files", async () => {
  await withTempRoot(async (root) => {
    const firstPlan = planFor(root, [["old.txt", "old"], ["keep.txt", "keep"]]);
    const first = await applyPlan({ plan: firstPlan, fileSystem: fsFor([["old.txt", "old"], ["keep.txt", "keep"]]) });
    assert.equal(first.status, "complete");
    const state = JSON.parse(await readFile(join(root, STATE_RELATIVE_PATH), "utf8"));
    const secondPlan = planFor(root, [["keep.txt", "keep"]], state);
    const second = await applyPlan({ plan: secondPlan, fileSystem: fsFor([["keep.txt", "keep"]]) });
    assert.equal(second.status, "complete");
    assert.equal(second.completed.find((action) => action.relativePath === "old.txt").kind, "prune");
    assert.equal(second.completed.find((action) => action.relativePath === "keep.txt").kind, "unchanged");
    assert.equal(await access(join(root, "old.txt")).then(() => true, () => false), false);
    const files = await import("node:fs/promises").then(({ readdir }) => readdir(root));
    assert.ok(files.includes("keep.txt"));
  });
});
