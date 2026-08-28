import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const legacyTopLevelDirectories = [
  ".claude-plugin",
  ".idea",
  "agents",
  "configs",
  "docs",
  "hooks",
  "scripts",
  "setup",
  "skills",
  "statusline"
];

test("new test directories coexist with every legacy top-level directory", async () => {
  for (const relativePath of [...legacyTopLevelDirectories, "tests", "tests/helpers", "tests/static"]) {
    const details = await stat(resolve(process.cwd(), relativePath));
    assert.ok(details.isDirectory(), `${relativePath} must remain a directory`);
  }
});

test("disposable evaluation paths are ignored and contain no tracked artifacts", async () => {
  const gitignore = await readFile(resolve(process.cwd(), ".gitignore"), "utf8");
  assert.match(gitignore, /^\.aaa\/eval-runs\/$/m);
  assert.match(gitignore, /^tests\/\.tmp\/$/m);

  const trackedPaths = execFileSync(
    "git",
    ["ls-files", "--", ".aaa/eval-runs", "tests/.tmp"],
    { cwd: process.cwd(), encoding: "utf8" }
  );
  assert.equal(trackedPaths.trim(), "");
});
