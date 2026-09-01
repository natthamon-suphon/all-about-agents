import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test, { after } from "node:test";

import { MAX_OVERLAY_BYTES, mergeSettingsOverlay } from "../../installers/lib/settings-overlay.mjs";
import { hashBytes } from "../../installers/lib/hash.mjs";

const GENERATED_TEMP_ROOTS = new Set();

async function generatedTempRoot(prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  GENERATED_TEMP_ROOTS.add(root);
  return root;
}

after(async () => {
  for (const root of [...GENERATED_TEMP_ROOTS]) {
    if (resolve(dirname(root)) !== resolve(tmpdir()) || !/^aaa-(?:overlay|outside)-/u.test(basename(root))) throw new Error("refusing unsafe settings-overlay fixture cleanup");
    await rm(root, { recursive: true, force: true });
  }
});

async function fixture(target = "target/settings.json") {
  const root = await generatedTempRoot("aaa-overlay-");
  const packageRoot = join(root, "package");
  await mkdir(packageRoot, { recursive: true });
  const targetPath = join(root, target);
  const overlayPath = join(packageRoot, "settings.overlay.json");
  await writeFile(overlayPath, '{"nested":{"new":2},"array":[2],"scalar":true}\n');
  return { root, packageRoot, targetPath, overlayPath };
}

test("mergeSettingsOverlay recursively merges objects, replaces arrays/scalars, and returns hashes", async () => {
  const input = await fixture();
  await mkdir(join(input.root, "target"), { recursive: true });
  await writeFile(input.targetPath, '{"nested":{"old":1},"array":[1],"scalar":false,"unknown":"keep"}\n');
  const result = await mergeSettingsOverlay({ ...input, allowedRoot: input.root });
  assert.equal(result.changed, true);
  assert.equal(result.bytes > 0, true);
  assert.match(result.beforeHash, /^[0-9a-f]{64}$/u);
  assert.match(result.afterHash, /^[0-9a-f]{64}$/u);
  assert.deepEqual(JSON.parse(await readFile(input.targetPath, "utf8")), { nested: { old: 1, new: 2 }, array: [2], scalar: true, unknown: "keep" });
});

test("mergeSettingsOverlay binds the bytes read to an expected managed hash", async () => {
  const input = await fixture();
  const expectedOverlayHash = hashBytes(await readFile(input.overlayPath));
  await mergeSettingsOverlay({ ...input, allowedRoot: input.root, expectedOverlayHash });
  await writeFile(input.overlayPath, '{"changed":true}\n');
  await assert.rejects(
    () => mergeSettingsOverlay({ ...input, allowedRoot: input.root, expectedOverlayHash }),
    (error) => error.code === "overlay-hash-mismatch"
  );
});

test("mergeSettingsOverlay creates a missing target without a backup", async () => {
  const input = await fixture("new/settings.json");
  const result = await mergeSettingsOverlay({ ...input, allowedRoot: input.root });
  assert.equal(result.beforeHash, null);
  assert.equal(JSON.parse(await readFile(input.targetPath, "utf8")).scalar, true);
  const entries = (await import("node:fs/promises")).readdir(input.root, { recursive: true });
  assert.deepEqual((await entries).filter((name) => /\.bak|\.tmp|history|rollback/iu.test(name)), []);
});

test("mergeSettingsOverlay rejects malformed, non-object, oversized, and prototype-bearing JSON", async () => {
  const input = await fixture();
  for (const body of ["not-json", "[]", '{"__proto__":{"polluted":true}}', '{"nested":{"constructor":{}}}']) {
    await writeFile(input.overlayPath, body);
    await assert.rejects(() => mergeSettingsOverlay({ ...input, allowedRoot: input.root }), /JSON|object|prototype|constructor|proto/u);
  }
  await writeFile(input.overlayPath, "x".repeat(MAX_OVERLAY_BYTES + 1));
  await assert.rejects(() => mergeSettingsOverlay({ ...input, allowedRoot: input.root }), /size|large|maximum/u);
});

test("mergeSettingsOverlay rejects escape and symlink/junction targets", async () => {
  const input = await fixture("target/settings.json");
  await mkdir(join(input.root, "target"), { recursive: true });
  await assert.rejects(() => mergeSettingsOverlay({ ...input, targetPath: join(input.root, "..", "escape.json"), allowedRoot: input.root }), /contain|root|escape/u);
  const outside = await generatedTempRoot("aaa-outside-");
  const link = join(input.root, "target-link");
  try {
    await (await import("node:fs/promises")).symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
  } catch { return; }
  await assert.rejects(() => mergeSettingsOverlay({ ...input, targetPath: join(link, "settings.json"), allowedRoot: input.root }), /symlink|junction|reparse|unsafe/u);
  const fileLink = join(input.root, "file-link.json");
  const outsideFile = join(outside, "settings.json");
  await writeFile(outsideFile, "{}\n");
  try { await (await import("node:fs/promises")).symlink(outsideFile, fileLink); } catch { return; }
  await assert.rejects(() => mergeSettingsOverlay({ ...input, targetPath: fileLink, allowedRoot: input.root }), /symlink|junction|reparse|unsafe/u);
});

test("mergeSettingsOverlay validates all roots and paths before resolving them", async () => {
  const input = await fixture();
  const separator = process.platform === "win32" ? "\\" : "/";
  const rawTraversal = `${input.root}${separator}..${separator}escape.json`;
  await assert.rejects(
    () => mergeSettingsOverlay({ ...input, allowedRoot: "." }),
    (error) => error.code === "invalid-root"
  );
  await assert.rejects(
    () => mergeSettingsOverlay({ ...input, targetPath: "target/settings.json", allowedRoot: input.root }),
    (error) => error.code === "invalid-target-path"
  );
  await assert.rejects(
    () => mergeSettingsOverlay({ ...input, overlayPath: "package/settings.overlay.json", allowedRoot: input.root }),
    (error) => error.code === "invalid-overlay-path"
  );
  await assert.rejects(
    () => mergeSettingsOverlay({ ...input, allowedRoot: rawTraversal }),
    (error) => error.code === "root-traversal"
  );
  await assert.rejects(
    () => mergeSettingsOverlay({ ...input, targetPath: rawTraversal, allowedRoot: input.root }),
    (error) => error.code === "root-traversal"
  );
  await assert.rejects(
    () => mergeSettingsOverlay({ ...input, overlayPath: rawTraversal, allowedRoot: input.root }),
    (error) => error.code === "root-traversal"
  );
  const escapedSibling = join(`${input.root}-sibling`, "settings.json");
  await assert.rejects(
    () => mergeSettingsOverlay({ ...input, targetPath: escapedSibling, allowedRoot: input.root }),
    (error) => error.code === "root-escape"
  );
});

test("mergeSettingsOverlay keeps the original target on an injected pre-rename failure", async () => {
  const input = await fixture();
  await mkdir(join(input.root, "target"), { recursive: true });
  await writeFile(input.targetPath, '{"original":true}\n');
  const original = await readFile(input.targetPath);
  const error = Object.assign(new Error("injected rename failure"), { code: "EPERM" });
  await assert.rejects(() => mergeSettingsOverlay({ ...input, allowedRoot: input.root, fileSystem: { rename: async () => { throw error; } } }), /rename|injected|EPERM/u);
  assert.deepEqual(await readFile(input.targetPath), original);
  const files = await (await import("node:fs/promises")).readdir(join(input.root, "target"));
  assert.deepEqual(files.filter((name) => name.includes(".aaa-") || name.endsWith(".tmp")), []);
});

test("mergeSettingsOverlay rejects malformed, oversized, and prototype-bearing existing targets", async () => {
  const input = await fixture();
  await mkdir(join(input.root, "target"), { recursive: true });
  for (const body of ["broken", "[]", '{"__proto__":{"polluted":true}}', '{"nested":{"prototype":{}}}']) {
    await writeFile(input.targetPath, body);
    await assert.rejects(() => mergeSettingsOverlay({ ...input, allowedRoot: input.root }), /JSON|object|prototype|proto/u);
  }
  await writeFile(input.targetPath, "x".repeat(MAX_OVERLAY_BYTES + 1));
  await assert.rejects(() => mergeSettingsOverlay({ ...input, allowedRoot: input.root }), /size|large|maximum/u);
});

test("mergeSettingsOverlay accepts UTF-8 and rejects invalid UTF-8 bytes", async () => {
  const input = await fixture();
  await writeFile(input.overlayPath, Buffer.from([0xc3, 0x28]));
  await assert.rejects(() => mergeSettingsOverlay({ ...input, allowedRoot: input.root }), /UTF-8|encoding/u);
  await writeFile(input.overlayPath, '{"ภาษา":"ไทย"}\n');
  await mergeSettingsOverlay({ ...input, allowedRoot: input.root });
});
