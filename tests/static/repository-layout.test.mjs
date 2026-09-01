import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const activeTopLevelDirectories = [
  ".agents",
  ".idea",
  "adapters",
  "core",
  "docs",
  "installers",
  "profiles",
  "quarantine",
  "scripts",
  "tests"
];

test("canonical directories replace active legacy top-level sources", async () => {
  for (const relativePath of [...activeTopLevelDirectories, "tests/helpers", "tests/static", "quarantine/legacy"]) {
    const details = await stat(resolve(process.cwd(), relativePath));
    assert.ok(details.isDirectory(), `${relativePath} must remain a directory`);
  }
  for (const relativePath of ["agents", "configs", "hooks", "setup", "skills", "statusline", ".claude-plugin"]) {
    await assert.rejects(stat(resolve(process.cwd(), relativePath)), (error) => error?.code === "ENOENT");
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
