import assert from "node:assert/strict";
import { access, mkdir, readFile, rename, symlink, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import test from "node:test";

import { withTempRoot } from "../helpers/temp-root.mjs";
import { buildPlan } from "../../installers/lib/plan.mjs";
import { buildManagedState } from "../../installers/lib/state.mjs";
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

test("applyPlan completes unchanged content without mutating that destination", async () => {
  await withTempRoot(async (root) => {
    await writeFile(join(root, "same.txt"), "same");
    const plan = planFor(root, [["same.txt", "same"]]);
    const calls = [];
    const fileSystem = fsFor([["same.txt", "same"]], {
      mkdir: async (path, options) => { calls.push(["mkdir", path]); return mkdir(path, options); },
      writeFile: async (path, ...args) => { calls.push(["writeFile", path]); return writeFile(path, ...args); },
      rename: async (from, to) => { calls.push(["rename", from, to]); return rename(from, to); },
      unlink: async (path) => { calls.push(["unlink", path]); return (await import("node:fs/promises")).unlink(path); }
    });
    const result = await applyPlan({ plan, fileSystem });
    assert.equal(result.status, "complete");
    assert.equal(result.completed.find((action) => action.relativePath === "same.txt").kind, "unchanged");
    assert.deepEqual(JSON.parse(await readFile(join(root, STATE_RELATIVE_PATH), "utf8")).ownedPaths, [{ relativePath: "same.txt", sha256: hashBytes(bytes("same")) }]);
    assert.equal(calls.some((call) => call.slice(1).some((value) => String(value).endsWith("same.txt"))), false);
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

test("applyPlan fails closed when a parent becomes a symlink between preflight and content mutation", async () => {
  await withTempRoot(async (root) => {
    const nested = join(root, "nested");
    const outside = join(root, "outside");
    await mkdir(nested);
    await mkdir(outside);
    let linkAvailable = true;
    let escapedWriteCalls = 0;
    const fileSystem = fsFor([["nested/escape.txt", "must stay inside"]], {
      mkdir: async (path, options) => {
        await mkdir(path, options);
        if (path === nested) {
          await rename(nested, join(root, "nested-original"));
          try { await symlink(outside, nested, process.platform === "win32" ? "junction" : "dir"); } catch { linkAvailable = false; }
        }
      },
      writeFile: async (path, ...args) => {
        escapedWriteCalls += 1;
        return writeFile(join(outside, basename(path)), ...args);
      }
    });
    if (!linkAvailable) return;
    const result = await applyPlan({ plan: planFor(root, [["nested/escape.txt", "must stay inside"]]), fileSystem });
    assert.equal(result.status, "failed");
    assert.equal(escapedWriteCalls, 0);
    assert.equal(await access(join(outside, "escape.txt")).then(() => true, () => false), false);
    assert.equal(await access(join(root, STATE_RELATIVE_PATH)).then(() => true, () => false), false);
  });
});

test("applyPlan fails closed when an owned parent becomes a symlink before prune", async () => {
  await withTempRoot(async (root) => {
    const ownedDirectory = join(root, "owned");
    const outside = join(root, "outside");
    await mkdir(ownedDirectory);
    await mkdir(outside);
    await writeFile(join(ownedDirectory, "stale.txt"), "owned");
    await writeFile(join(outside, "stale.txt"), "outside");
    let linkAvailable = true;
    let swapped = false;
    const state = { schemaVersion: 1, repositoryVersion: "repo-1", profile: "portable", surfaces: ["claude"], ownedPaths: [{ relativePath: "owned/stale.txt", sha256: hashBytes(bytes("owned")) }] };
    const fileSystem = fsFor([], {
      readFile: async (path) => {
        const value = await readFile(path);
        if (!swapped && path === join(ownedDirectory, "stale.txt")) {
          swapped = true;
          await rename(ownedDirectory, join(root, "owned-original"));
          try { await symlink(outside, ownedDirectory, process.platform === "win32" ? "junction" : "dir"); } catch { linkAvailable = false; }
        }
        return value;
      }
    });
    if (!linkAvailable) return;
    const result = await applyPlan({ plan: planFor(root, [], state), fileSystem });
    assert.equal(result.status, "failed");
    assert.equal(await readFile(join(outside, "stale.txt"), "utf8"), "outside");
    assert.equal(await access(join(root, STATE_RELATIVE_PATH)).then(() => true, () => false), false);
  });
});

test("applyPlan fails closed when the managed-state parent becomes a symlink", async () => {
  await withTempRoot(async (root) => {
    const stateDirectory = join(root, ".all-about-agents");
    const outside = join(root, "outside");
    await mkdir(stateDirectory);
    await mkdir(outside);
    let linkAvailable = true;
    let escapedWriteCalls = 0;
    const fileSystem = fsFor([], {
      mkdir: async (path, options) => {
        await mkdir(path, options);
        if (path === stateDirectory) {
          await rename(stateDirectory, join(root, "state-original"));
          try { await symlink(outside, stateDirectory, process.platform === "win32" ? "junction" : "dir"); } catch { linkAvailable = false; }
        }
      },
      writeFile: async (path, ...args) => {
        escapedWriteCalls += 1;
        return writeFile(join(outside, basename(path)), ...args);
      }
    });
    if (!linkAvailable) return;
    const plan = planFor(root, []);
    const result = await applyPlan({ plan, fileSystem });
    assert.equal(result.status, "failed");
    assert.equal(escapedWriteCalls, 0);
    assert.equal(await access(join(outside, "state.json")).then(() => true, () => false), false);
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

test("applyPlan rejects ambiguous previous state before the first destination mutation", async () => {
  await withTempRoot(async (root) => {
    const previousState = buildManagedState({
      repositoryVersion: "repo-old",
      profile: "portable",
      surfaces: ["claude", "codex"],
      ownedPaths: [{ relativePath: "shared.txt", sha256: hashBytes(bytes("shared")) }]
    });
    let writes = 0;
    const result = await applyPlan({
      plan: planFor(root, [["new.txt", "new"]], previousState),
      fileSystem: fsFor([["new.txt", "new"]], {
        previousState,
        writeFile: async (...args) => { writes += 1; return writeFile(...args); }
      })
    });
    assert.equal(result.status, "failed");
    assert.match(result.failed.reason, /ambiguous.*surface/u);
    assert.equal(writes, 0);
    assert.equal(await access(join(root, "new.txt")).then(() => true, () => false), false);
    assert.equal(await access(join(root, STATE_RELATIVE_PATH)).then(() => true, () => false), false);
  });
});
