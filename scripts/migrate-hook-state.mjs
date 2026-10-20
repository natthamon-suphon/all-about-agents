#!/usr/bin/env node
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, opendir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertStatePath, resolveHookDataRoot } from "../core/hooks/state-path.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

function sameFileIdentity(left, right) {
  // Older Windows libuv mixes 64-bit path serials with 32-bit handle serials.
  const sameDevice = process.platform === "win32"
    ? BigInt.asUintN(32, left.dev) === BigInt.asUintN(32, right.dev)
    : left.dev === right.dev;
  return sameDevice && left.ino === right.ino;
}

async function readBoundedFile(path, maxBytes) {
  assertStatePath(path, { allowFile: true });
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat({ bigint: true });
    const named = await lstat(path, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n || !sameFileIdentity(before, named)) throw new Error("legacy import requires a stable regular file without links");
    if (before.size > BigInt(maxBytes)) throw new Error("legacy import byte limit exceeded");
    const chunks = [];
    let total = 0;
    while (true) {
      const buffer = Buffer.alloc(Math.min(64 * 1024, maxBytes - total + 1));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maxBytes) throw new Error("legacy import byte limit exceeded");
      chunks.push(buffer.subarray(0, bytesRead));
    }
    const after = await handle.stat({ bigint: true });
    assertStatePath(path, { allowFile: true });
    const current = await lstat(path, { bigint: true });
    if (after.size !== before.size || after.mtimeNs !== before.mtimeNs || after.nlink !== 1n || !sameFileIdentity(current, before)) throw new Error("legacy source changed during review");
    return Buffer.concat(chunks, total);
  } finally { await handle.close(); }
}

/** Import only known legacy history files; never delete or overwrite a source. */
export async function migrateHookState({ surface, packageRoot, env = process.env, apply = false, maxBytes = 16 * 1024 * 1024, maxFiles = 64 } = {}) {
  if (!["claude", "codex"].includes(surface) || typeof apply !== "boolean") throw new TypeError("surface must be claude or codex; apply must be boolean");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isSafeInteger(maxFiles) || maxFiles < 1) throw new TypeError("invalid import limit");
  const sourceRoot = assertStatePath(packageRoot);
  if (!(await lstat(sourceRoot)).isDirectory()) throw new Error("legacy package root must be a directory");
  const dataRoot = resolveHookDataRoot(surface, { env, packageRoot: sourceRoot });
  if (!dataRoot) throw new Error("native plugin data unavailable");
  const files = [];
  let totalBytes = 0;
  let inspected = 0;
  for (const kind of ["audit", "checkpoints"]) {
    const source = assertStatePath(join(sourceRoot, "hooks", kind));
    let entries;
    try { entries = await opendir(source); } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    for await (const entry of entries) {
      if (++inspected > 128) throw new Error("legacy import entry limit exceeded");
      const known = kind === "audit" ? /^activity-audit(?:\.\d+)?\.log$/u.test(entry.name) : entry.name === "checkpoint.jsonl";
      if (!known) continue;
      const sourcePath = assertStatePath(join(source, entry.name), { allowFile: true });
      const info = await lstat(sourcePath);
      if (!info.isFile() || info.nlink > 1) throw new Error("legacy import requires regular files without links");
      if (files.length >= maxFiles || totalBytes + info.size > maxBytes) throw new Error("legacy import byte or file limit exceeded");
      const bytes = await readBoundedFile(sourcePath, maxBytes - totalBytes);
      if (bytes.byteLength !== info.size) throw new Error("legacy source changed during review");
      totalBytes += bytes.byteLength;
      const digest = hash(bytes);
      const destination = assertStatePath(join(dataRoot, "legacy", surface, kind, `${digest}-${entry.name}`), { allowFile: true });
      let changed = true;
      try {
        const existing = await lstat(destination);
        if (!existing.isFile() || existing.nlink > 1 || existing.size !== bytes.byteLength || hash(await readBoundedFile(destination, bytes.byteLength)) !== digest) throw new Error("legacy import destination conflict");
        changed = false;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      files.push({ source: sourcePath, destination, sha256: digest, bytes: bytes.byteLength, changed });
    }
  }
  files.sort((left, right) => left.destination < right.destination ? -1 : left.destination > right.destination ? 1 : 0);
  if (apply) {
    for (const file of files.filter((item) => item.changed)) {
      assertStatePath(file.source, { allowFile: true });
      const bytes = await readBoundedFile(file.source, Math.min(file.bytes, maxBytes));
      if (hash(bytes) !== file.sha256) throw new Error("legacy source changed after review");
      assertStatePath(file.destination, { allowFile: true });
      await mkdir(dirname(file.destination), { recursive: true });
      assertStatePath(file.destination, { allowFile: true });
      try { await writeFile(file.destination, bytes, { flag: "wx", mode: 0o600 }); } catch (error) {
        if (error.code !== "EEXIST" || hash(await readBoundedFile(file.destination, file.bytes)) !== file.sha256) throw new Error("legacy import destination conflict", { cause: error });
        file.changed = false;
      }
    }
  }
  return { status: apply ? "complete" : "dry-run", surface, totalBytes, files };
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.includes("--help")) {
    process.stdout.write("node scripts/migrate-hook-state.mjs --surface claude|codex --package-root PATH --data-root PATH [--apply]\nDry-run by default. Sources and existing different files are never overwritten.\n");
    return 0;
  }
  const options = {};
  let dataRoot;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--apply") { options.apply = true; continue; }
    if (!["--surface", "--package-root", "--data-root"].includes(flag) || index + 1 >= argv.length || argv[index + 1].startsWith("--")) throw new TypeError("invalid migration arguments; use --help");
    const value = argv[++index];
    if (flag === "--data-root") dataRoot = value;
    else options[flag === "--surface" ? "surface" : "packageRoot"] = value;
  }
  const variable = options.surface === "claude" ? "CLAUDE_PLUGIN_DATA" : "PLUGIN_DATA";
  if (dataRoot !== undefined) options.env = { [variable]: dataRoot };
  process.stdout.write(`${JSON.stringify(await migrateHookState(options), null, 2)}\n`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
