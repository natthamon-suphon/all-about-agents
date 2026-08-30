import assert from "node:assert/strict";
import { access, mkdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

import { withTempRoot } from "../helpers/temp-root.mjs";

const requiredOutputs = [
  ".github/workflows/installer-matrix.yml",
  "tests/integration/claude-install.test.mjs",
  "tests/integration/codex-install.test.mjs",
  "tests/integration/antigravity-2-install.test.mjs",
  "tests/integration/agy-install.test.mjs",
  "tests/integration/all-surfaces.test.mjs",
  "tests/fixtures/user-profiles/",
  "tests/integration/manual-desktop-checklist.json"
];

test("T049 creates every owned artifact", async () => {
  assert.ok(requiredOutputs.length > 0);
  for (const relativePath of requiredOutputs) {
    await access(resolve(process.cwd(), relativePath));
  }
});

test("Claude clean-profile install works from an unrelated working directory", async () => {
  await withTempRoot(async (root) => {
    const unrelated = resolve(root, "unrelated");
    const destination = resolve(root, "claude");
    await mkdir(unrelated, { recursive: true });
    const result = spawnSync(process.execPath, [
      resolve(process.cwd(), "scripts", "aaa.mjs"),
      "install", "--surface", "claude", "--destination-root", destination, "--apply", "--format", "json"
    ], { cwd: unrelated, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, "complete");
    assert.equal(JSON.parse(await readFile(resolve(destination, "all-about-agents", "statusline.json"), "utf8")).displayName, "");
    for (const registeredPath of [
      "settings.json",
      "all-about-agents/statusline.json",
      "rules/authority-and-scope.md",
      ".claude-plugin/plugin.json",
      "skills/brainstorming/SKILL.md"
    ]) await access(resolve(destination, registeredPath));
  });
});
