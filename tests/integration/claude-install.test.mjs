import assert from "node:assert/strict";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import { renderClaude } from "../../adapters/claude/adapter.mjs";
import { loadCore } from "../../installers/lib/load-core.mjs";
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

test("Claude Windows statusline command runs through Git Bash and PowerShell", { skip: process.platform !== "win32" ? "Windows shell routes are unavailable on this platform" : false }, async (t) => {
  const core = await loadCore(process.cwd());
  await withTempRoot(async (root) => {
    const configRoot = join(root, "Claude Config ทีม", "O'Reilly $&;" + String.fromCharCode(96) + "tick");
    const result = renderClaude({
      core,
      profile: "template",
      statuslineName: "ทีม \"Claude\"",
      platform: "win32",
      env: { CLAUDE_CONFIG_DIR: configRoot },
      homeDir: "C:/Users/tester"
    });
    const files = new Map(result.files.map((file) => [file.relativePath, file.content]));
    const settings = JSON.parse(new TextDecoder().decode(files.get("config/settings.json")));
    const launcher = files.get("statusline/statusline.ps1");
    assert.ok(launcher, "rendered package must include the Windows launcher");
    const renderer = files.get("statusline/statusline.mjs");
    assert.ok(renderer, "rendered package must include the Node renderer");
    const config = files.get("config/statusline.json");
    assert.ok(config, "rendered package must include statusline config");
    assert.equal(typeof settings.statusLine?.command, "string");
    await mkdir(join(configRoot, "statusline"), { recursive: true });
    await mkdir(join(configRoot, "all-about-agents"), { recursive: true });
    await mkdir(join(root, "unrelated"), { recursive: true });
    await writeFile(join(configRoot, "statusline", "statusline.ps1"), launcher);
    await writeFile(join(configRoot, "statusline", "statusline.mjs"), renderer);
    await writeFile(join(configRoot, "all-about-agents", "statusline.json"), config);
    const input = JSON.stringify({ workspace: { project_dir: "C:/repo" }, model: { display_name: "Opus" } });
    const commandPath = (name) => {
      const lookup = spawnSync("where.exe", [name], { encoding: "utf8" });
      return lookup.status === 0 ? lookup.stdout.trim().split(/\r?\n/u)[0] : "";
    };
    const gitExecutable = commandPath("git.exe");
    // git.exe resolves to either <Git>\bin or <Git>\mingw64\bin; bash.exe lives only in <Git>\bin.
    const gitRoots = gitExecutable ? [dirname(dirname(gitExecutable)), dirname(dirname(dirname(gitExecutable)))] : [];
    const gitBash = gitRoots.map((base) => join(base, "bin", "bash.exe")).find((candidate) => existsSync(candidate)) ?? "";
    const routes = [
      { name: "Git Bash", executable: gitBash, args: ["-lc", settings.statusLine.command] },
      { name: "PowerShell", executable: commandPath("powershell.exe"), args: ["-NoProfile", "-Command", settings.statusLine.command] }
    ];
    let executed = 0;
    for (const route of routes) {
      const available = route.executable.length > 0;
      if (!available) {
        t.diagnostic(route.name + " route unavailable: the required executable was not found");
        continue;
      }
      const child = spawnSync(route.executable, route.args, {
        cwd: join(root, "unrelated"),
        encoding: "utf8",
        input,
        env: { ...process.env, CLAUDE_CONFIG_DIR: configRoot }
      });
      assert.equal(child.error, undefined, route.name + " failed to start");
      assert.equal(child.status, 0, route.name + ": " + child.stderr);
      assert.equal(child.stderr, "", route.name + " stderr must stay empty");
      assert.equal(child.stdout.trimEnd().split(/\r?\n/u).length, 4, route.name + " must emit four lines");
      assert.ok(child.stdout.includes('ทีม "Claude"'), route.name + " output should include the exact configured display name");
      executed += 1;
    }
    assert.ok(executed > 0, "at least one Windows shell route must be available");
  });
});
