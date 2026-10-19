import assert from "node:assert/strict";
import { access, link, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
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
