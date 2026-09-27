import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

// Git-tracked directories only. The .agents plugin slot is written by a coding
// tool at install time, so it is absent on a clean checkout.
const activeTopLevelDirectories = [
  "adapters",
  "core",
  "docs",
  "installers",
  "profiles",
  "scripts",
  "tests"
];

test("canonical directories replace active legacy top-level sources", async () => {
  for (const relativePath of [...activeTopLevelDirectories, "tests/helpers", "tests/static"]) {
    const details = await stat(resolve(process.cwd(), relativePath));
    assert.ok(details.isDirectory(), `${relativePath} must remain a directory`);
  }
  for (const relativePath of ["agents", "configs", "hooks", "setup", "skills", "statusline", ".claude-plugin", "quarantine"]) {
    await assert.rejects(stat(resolve(process.cwd(), relativePath)), (error) => error?.code === "ENOENT");
  }
});

test("disposable evaluation paths are ignored and contain no tracked artifacts", async () => {
  const gitignore = await readFile(resolve(process.cwd(), ".gitignore"), "utf8");
  assert.match(gitignore, /^tests\/\.tmp\/$/m);

  const trackedPaths = execFileSync(
    "git",
    ["ls-files", "--", ".aaa/eval-runs", "tests/.tmp"],
    { cwd: process.cwd(), encoding: "utf8" }
  );
  assert.equal(trackedPaths.trim(), "");
});
