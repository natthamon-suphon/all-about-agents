import assert from "node:assert/strict";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import test from "node:test";

import { withTempRoot } from "../helpers/temp-root.mjs";
import { validateSchema } from "../../installers/lib/validate-schema.mjs";
import planSchema from "../../installers/schemas/plan.schema.json" with { type: "json" };
import { buildPlan } from "../../installers/lib/plan.mjs";
import { hashBytes } from "../../installers/lib/hash.mjs";

const bytes = (value) => new TextEncoder().encode(value);
const surface = "claude";
const payloadFor = (files) => ({
  files,
  registrations: [{ kind: "profile-translation", surface }],
  diagnostics: [],
  ownership: files.map((file) => ({ relativePath: file.relativePath, sha256: hashBytes(file.content) }))
});

test("hashBytes uses exact Uint8Array bytes and lower-case SHA-256", () => {
  const expected = createHash("sha256").update(Uint8Array.from([0, 255, 10])).digest("hex");
  assert.equal(hashBytes(Uint8Array.from([0, 255, 10])), expected);
  assert.match(expected, /^[0-9a-f]{64}$/u);
  assert.throws(() => hashBytes("text"), /Uint8Array/u);
});

test("buildPlan creates, replaces, and leaves exact-byte matches unchanged in sorted order", async () => {
  await withTempRoot(async (root) => {
    await writeFile(join(root, "replace.txt"), Uint8Array.from([65, 10]));
    await writeFile(join(root, "same.txt"), Uint8Array.from([0, 255]));
    const payload = payloadFor([
      { relativePath: "z-create.txt", content: bytes("new"), mode: null },
      { relativePath: "replace.txt", content: bytes("replacement"), mode: null },
      { relativePath: "same.txt", content: Uint8Array.from([0, 255]), mode: null }
    ]);
    const plan = buildPlan({ payload, destinationRoot: root, previousState: null });
    assert.deepEqual(plan.actions.map(({ kind, relativePath }) => ({ kind, relativePath })), [
      { kind: "replace", relativePath: "replace.txt" },
      { kind: "unchanged", relativePath: "same.txt" },
      { kind: "create", relativePath: "z-create.txt" }
    ]);
    assert.equal(plan.actions.find((entry) => entry.relativePath === "replace.txt").contentHash, hashBytes(bytes("replacement")));
    assert.equal(await readFile(join(root, "replace.txt"), "utf8"), "A\n");
  });
});

test("buildPlan prunes only previously owned unchanged files and preserves unknown neighbors", async () => {
  await withTempRoot(async (root) => {
    await writeFile(join(root, "stale.txt"), "owned");
    await writeFile(join(root, "neighbor.txt"), "keep");
    const previousState = { schemaVersion: 1, repositoryVersion: "repo-1", profile: "portable", surfaces: ["claude"], ownedPaths: [{ relativePath: "stale.txt", sha256: hashBytes(bytes("owned")) }] };
    const plan = buildPlan({ payload: payloadFor([{ relativePath: "current.txt", content: bytes("current"), mode: null }]), destinationRoot: root, previousState });
    assert.equal(plan.actions.find((entry) => entry.relativePath === "stale.txt").kind, "prune");
    assert.equal(plan.actions.some((entry) => entry.relativePath === "neighbor.txt"), false);
    const changed = buildPlan({ payload: payloadFor([]), destinationRoot: root, previousState: { ...previousState, ownedPaths: [{ relativePath: "stale.txt", sha256: hashBytes(bytes("other")) }] } });
    assert.equal(changed.actions.find((entry) => entry.relativePath === "stale.txt").kind, "reject");
  });
});

test("buildPlan rejects traversal, symlink, junction/directory, and unreadable destinations without writing", async () => {
  await withTempRoot(async (root) => {
    await mkdir(join(root, "dir"));
    await writeFile(join(root, "regular.txt"), "before");
    const outside = join(root, "outside.txt");
    await writeFile(outside, "outside");
    const linkPath = join(root, "link.txt");
    let linkAvailable = true;
    try { await symlink(outside, linkPath); } catch { linkAvailable = false; }
    const files = [
      { relativePath: "../escape.txt", content: bytes("escape"), mode: null },
      { relativePath: "dir", content: bytes("directory"), mode: null },
      { relativePath: "regular.txt", content: bytes("after"), mode: null },
      ...(linkAvailable ? [{ relativePath: "link.txt", content: bytes("link"), mode: null }] : [])
    ];
    assert.throws(() => buildPlan({ payload: payloadFor(files), destinationRoot: root, previousState: null }), /safe relativePath/u);
    const validFiles = [
      { relativePath: "dir", content: bytes("directory"), mode: null },
      { relativePath: "regular.txt", content: bytes("after"), mode: null },
      ...(linkAvailable ? [{ relativePath: "link.txt", content: bytes("link"), mode: null }] : [])
    ];
    const plan = buildPlan({ payload: payloadFor(validFiles), destinationRoot: root, previousState: null });
    assert.equal(plan.actions.find((entry) => entry.relativePath === "dir").kind, "reject");
    assert.equal(plan.actions.find((entry) => entry.relativePath === "regular.txt").kind, "replace");
    if (linkAvailable) assert.equal(plan.actions.find((entry) => entry.relativePath === "link.txt").kind, "reject");
    assert.equal(await readFile(join(root, "regular.txt"), "utf8"), "before");
  });
});

test("buildPlan disables pruning for malformed prior state and is deterministic", async () => {
  await withTempRoot(async (root) => {
    await writeFile(join(root, "stale.txt"), "owned");
    const payload = payloadFor([{ relativePath: "b.txt", content: bytes("b"), mode: null }, { relativePath: "a.txt", content: bytes("a"), mode: null }]);
    const first = buildPlan({ payload, destinationRoot: root, previousState: { schemaVersion: 9, repositoryVersion: "repo-1", profile: "portable", surfaces: ["claude"], ownedPaths: [] } });
    const second = buildPlan({ payload: { ...payload, files: [...payload.files].reverse() }, destinationRoot: root, previousState: { schemaVersion: 9, repositoryVersion: "repo-1", profile: "portable", surfaces: ["claude"], ownedPaths: [] } });
    assert.deepEqual(first, second);
    assert.ok(first.diagnostics.some((entry) => entry.code === "invalid-previous-state"));
    assert.equal(first.actions.some((entry) => entry.relativePath === "stale.txt"), false);
    assert.equal(validateSchema({ schema: planSchema, value: first, sourcePath: "plan.json" }).valid, true);
  });
});

test("buildPlan disables pruning for missing or extra strict-state fields and legacy ownership", async () => {
  await withTempRoot(async (root) => {
    await writeFile(join(root, "stale.txt"), "owned");
    const owned = { relativePath: "stale.txt", sha256: hashBytes(bytes("owned")) };
    const malformedStates = [
      { schemaVersion: 1, profile: "portable", surfaces: ["claude"], ownedPaths: [owned] },
      { schemaVersion: 1, repositoryVersion: "repo-1", surfaces: ["claude"], ownedPaths: [owned] },
      { schemaVersion: 1, repositoryVersion: "repo-1", profile: "portable", ownedPaths: [owned] },
      { schemaVersion: 1, repositoryVersion: "repo-1", profile: "portable", surfaces: ["claude"], ownedPaths: [owned], diagnostics: [] },
      { schemaVersion: 1, repositoryVersion: "repo-1", profile: "portable", surfaces: ["claude"], ownership: [owned] }
    ];
    for (const previousState of malformedStates) {
      const plan = buildPlan({ payload: payloadFor([]), destinationRoot: root, previousState });
      assert.equal(plan.actions.some((action) => action.kind === "prune"), false);
      assert.ok(plan.diagnostics.some((diagnostic) => diagnostic.code === "invalid-previous-state"));
    }
  });
});

test("buildPlan prunes only when strict managed state includes the selected surface", async () => {
  await withTempRoot(async (root) => {
    await writeFile(join(root, "stale.txt"), "owned");
    const state = { schemaVersion: 1, repositoryVersion: "repo-1", profile: "portable", surfaces: ["claude"], ownedPaths: [{ relativePath: "stale.txt", sha256: hashBytes(bytes("owned")) }] };
    const included = buildPlan({ payload: payloadFor([]), destinationRoot: root, previousState: state });
    assert.equal(included.actions.find((action) => action.relativePath === "stale.txt").kind, "prune");
    const excluded = buildPlan({ payload: { ...payloadFor([]), registrations: [{ kind: "profile-translation", surface: "codex" }] }, destinationRoot: root, previousState: state });
    assert.equal(excluded.actions.some((action) => action.kind === "prune"), false);
    assert.ok(excluded.diagnostics.some((diagnostic) => diagnostic.code === "invalid-previous-state"));
  });
});

test("buildPlan fails closed when a nonexistent root crosses a symlink ancestor", async () => {
  await withTempRoot(async (root) => {
    const outside = join(root, "outside");
    const alias = join(root, "alias");
    await mkdir(outside);
    try { await symlink(outside, alias, process.platform === "win32" ? "junction" : "dir"); } catch { return; }
    const destinationRoot = join(alias, "missing-root");
    const plan = buildPlan({ payload: payloadFor([{ relativePath: "x.txt", content: bytes("x"), mode: null }]), destinationRoot, previousState: null });
    const action = plan.actions.find((entry) => entry.relativePath === "x.txt");
    assert.equal(action.kind, "reject");
    assert.match(action.reason, /symlink|junction|unsafe|ancestor/u);
  });
});
