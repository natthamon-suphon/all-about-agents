#!/usr/bin/env node
// Informational: report how old the newest manual trigger-suite result is.
// Always exits 0; quality:full lists this check as optional evidence, never as a gate.
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Every trigger-suite run writes <runs dir>/<prefix><UTC timestamp>-<suffix>/result.json. */
export const TRIGGER_SUITE_PREFIX = "trigger-suite-";

// Other results, such as `aaa eval --output .aaa/eval-runs`, share the folder and are ignored.
function newestTriggerSuiteResult(runsDir) {
  let entries;
  try {
    entries = readdirSync(runsDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  let newest = null;
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(TRIGGER_SUITE_PREFIX)) continue;
    const path = join(runsDir, entry.name, "result.json");
    if (!existsSync(path)) continue;
    const mtime = statSync(path).mtimeMs;
    if (newest === null || mtime > newest.mtime) newest = { name: `${entry.name}/result.json`, path, mtime };
  }
  return newest;
}

function countStatuses(path) {
  let results;
  try {
    results = JSON.parse(readFileSync(path, "utf8")).results;
  } catch (error) {
    return `unreadable: ${String(error?.message ?? error)}`;
  }
  if (!Array.isArray(results)) return "no case results";
  const count = (status) => results.filter((entry) => entry?.metadata?.status === status).length;
  return `${count("PASS")} pass, ${count("FAIL")} fail, ${count("NOT_RUN_UNAVAILABLE")} not run`;
}

/** Describe the newest trigger-suite result, with its case counts, so an all-NOT_RUN run never reads as a fresh PASS. */
export function describeSuiteAge(runsDir, now = Date.now()) {
  const newest = newestTriggerSuiteResult(runsDir);
  if (newest === null) return "model trigger suite: no result recorded yet (run `npm run test:model` on a machine with an authenticated claude CLI)";
  const ageHours = Math.round((now - newest.mtime) / 3_600_000);
  return `model trigger suite: newest result ${newest.name} is ${ageHours} hours old (${countStatuses(newest.path)})`;
}

if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
  process.stdout.write(`${describeSuiteAge(join(root, ".aaa", "eval-runs"))}\n`);
}
