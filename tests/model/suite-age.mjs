#!/usr/bin/env node
// Informational: report how old the newest manual trigger-suite result is.
// Always exits 0; quality:full lists this check as optional evidence, never as a gate.
import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const dir = join(root, ".aaa", "eval-runs");
let newest = null;
try {
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const mtime = statSync(join(dir, name)).mtimeMs;
    if (newest === null || mtime > newest.mtime) newest = { name, mtime };
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
if (newest === null) {
  process.stdout.write("model trigger suite: no result recorded yet (run `npm run test:model` on a machine with an authenticated claude CLI)\n");
} else {
  const ageHours = Math.round((Date.now() - newest.mtime) / 3_600_000);
  process.stdout.write(`model trigger suite: newest result ${newest.name} is ${ageHours} hours old\n`);
}
