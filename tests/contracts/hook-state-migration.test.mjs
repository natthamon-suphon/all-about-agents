import assert from "node:assert/strict";
import fs from "node:fs";
import { access, link, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { withTempRoot } from "../helpers/temp-root.mjs";
import { resolveHookDataRoot } from "../../core/hooks/state-path.mjs";

test("hook data rejects missing, relative, package-local and linked destinations", async () => {
  await withTempRoot(async (root) => {
    const packageRoot = join(root, "package");
    await mkdir(packageRoot);
    const resolveData = (value) => resolveHookDataRoot("codex", { env: { PLUGIN_DATA: value }, packageRoot });
    for (const value of [undefined, "", "relative", packageRoot, join(packageRoot, "data"), `${root}/../outside`]) assert.equal(resolveData(value), null);
    const safe = join(root, "ข้อมูล data");
    await mkdir(safe);
    assert.equal(resolveData(safe), safe);
    const link = join(root, "linked");
    await symlink(safe, link, process.platform === "win32" ? "junction" : "dir");
    assert.equal(resolveData(link), null);
    await mkdir(join(safe, "checkpoints"));
    await writeFile(join(root, "outside.jsonl"), "untouched\n");
    await symlink(join(root, "outside.jsonl"), join(safe, "checkpoints", "checkpoint.jsonl"));
    assert.equal(resolveHookDataRoot("codex", { env: { PLUGIN_DATA: safe }, packageRoot, segments: ["checkpoints", "checkpoint.jsonl"] }), null);
    assert.equal(await readFile(join(root, "outside.jsonl"), "utf8"), "untouched\n");
  });
});

test("legacy hook import is dry-run by default, repeatable, bounded and source-preserving", async () => {
  const module = await import("../../scripts/migrate-hook-state.mjs").catch(() => null);
  assert.ok(module, "a reviewed non-destructive legacy import must be available");
  await withTempRoot(async (root) => {
    const packageRoot = join(root, "old package");
    const dataRoot = join(root, "data");
    await mkdir(join(packageRoot, "hooks", "audit"), { recursive: true });
    const source = join(packageRoot, "hooks", "audit", "activity-audit.log");
    await writeFile(source, "old history\n");
    const input = { surface: "codex", packageRoot, env: { PLUGIN_DATA: dataRoot } };
    const preview = await module.migrateHookState(input);
    assert.equal(preview.status, "dry-run");
    assert.equal(preview.files.length, 1);
    assert.equal(await access(dataRoot).then(() => true, () => false), false);
    const applied = await module.migrateHookState({ ...input, apply: true });
    assert.equal(applied.status, "complete");
    assert.equal(await readFile(applied.files[0].destination, "utf8"), "old history\n");
    assert.equal(await readFile(source, "utf8"), "old history\n");
    assert.equal((await module.migrateHookState({ ...input, apply: true })).files[0].changed, false);
    await writeFile(applied.files[0].destination, "different\n");
    await assert.rejects(() => module.migrateHookState({ ...input, apply: true }), /conflict/u);
    await assert.rejects(() => module.migrateHookState({ ...input, maxBytes: 1 }), /limit/u);
    assert.equal(await readFile(source, "utf8"), "old history\n");
  });
});

test("legacy import accepts Windows volume serial widths but rejects a different device or inode", async () => {
  const { migrateHookState } = await import("../../scripts/migrate-hook-state.mjs");
  for (const change of ["serial-width", "device", "inode"]) {
    await withTempRoot(async (root) => {
      const packageRoot = join(root, "old package");
      const dataRoot = join(root, "data");
      const source = join(packageRoot, "hooks", "audit", "activity-audit.log");
      await mkdir(join(packageRoot, "hooks", "audit"), { recursive: true });
      await writeFile(source, "old history\n");
      const original = fs.promises.lstat;
      fs.promises.lstat = async function (path, ...args) {
        const info = await original.call(this, path, ...args);
        if (info.isFile() && String(path).startsWith(root)) {
          const field = change === "inode" ? "ino" : "dev";
          const value = BigInt(info[field]);
          const changed = change === "serial-width"
            ? (0x12345678n << 32n) | BigInt.asUintN(32, value)
            : value ^ 1n;
          info[field] = typeof info[field] === "bigint" ? changed : Number(changed);
        }
        return info;
      };
      syncBuiltinESMExports();
      try {
        const input = { surface: "codex", packageRoot, env: { PLUGIN_DATA: dataRoot } };
        if (change === "serial-width" && process.platform === "win32") {
          assert.equal((await migrateHookState(input)).status, "dry-run");
          const applied = await migrateHookState({ ...input, apply: true });
          assert.equal(await readFile(applied.files[0].destination, "utf8"), "old history\n");
          assert.equal((await migrateHookState({ ...input, apply: true })).files[0].changed, false);
        } else {
          await assert.rejects(() => migrateHookState({ ...input, apply: true }), /stable regular file without links/u, change);
          await assert.rejects(access(dataRoot), { code: "ENOENT" });
        }
      } finally {
        fs.promises.lstat = original;
        syncBuiltinESMExports();
      }
      assert.equal(await readFile(source, "utf8"), "old history\n");
    });
  }
});

test("hook state refuses hardlinked checkpoint targets without modifying an unowned neighbor", async () => {
  await withTempRoot(async (root) => {
    const packageRoot = join(root, "package");
    const dataRoot = join(root, "data");
    await mkdir(join(dataRoot, "checkpoints"), { recursive: true });
    const neighbor = join(root, "neighbor.jsonl");
    await writeFile(neighbor, "keep\n");
    await link(neighbor, join(dataRoot, "checkpoints", "checkpoint.jsonl"));
    assert.equal(resolveHookDataRoot("codex", { env: { PLUGIN_DATA: dataRoot }, packageRoot, segments: ["checkpoints", "checkpoint.jsonl"] }), null);
    assert.equal(await readFile(neighbor, "utf8"), "keep\n");
  });
});
