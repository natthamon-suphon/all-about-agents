import assert from "node:assert/strict";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import test from "node:test";

import { loadCore } from "../../installers/lib/load-core.mjs";
import { renderCodex } from "../../adapters/codex/adapter.mjs";
import { hashBytes } from "../../installers/lib/hash.mjs";
import { withTempRoot } from "../helpers/temp-root.mjs";

async function installFromUnrelatedCwd(root, destination) {
  const unrelated = resolve(root, "unrelated");
  await mkdir(unrelated, { recursive: true });
  const result = spawnSync(process.execPath, [
    resolve(process.cwd(), "scripts", "aaa.mjs"),
    "install", "--surface", "codex", "--profile", "template",
    "--destination-root", destination, "--apply", "--format", "json"
  ], { cwd: unrelated, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout);
}

async function assertOwnedHashes(root, state) {
  for (const entry of state.ownedPaths) {
    const bytes = await readFile(resolve(root, ...entry.relativePath.split("/")));
    assert.equal(hashBytes(bytes), entry.sha256, entry.relativePath);
  }
}

test("Codex clean-profile materializes declared destinations and is idempotent", async () => {
  await withTempRoot(async (root) => {
    const destination = resolve(root, "codex");
    const neighbor = resolve(destination, "unmanaged-neighbor.txt");
    await mkdir(destination, { recursive: true });
    await (await import("node:fs/promises")).writeFile(neighbor, "keep me\n", "utf8");

    const first = await installFromUnrelatedCwd(root, destination);
    assert.equal(first.status, "complete");
    const core = await loadCore(process.cwd());
    assert.equal(core.skills.length, 27);
    assert.equal(core.roles.length, 7);
    assert.equal(core.rules.length, 9);

    for (const skill of core.skills) await access(resolve(destination, ".agents", "skills", skill.id, "SKILL.md"));
    for (const role of core.roles) {
      await access(resolve(destination, ".codex", "agents", `${role.id}.toml`));
      await access(resolve(destination, "agents", `${role.id}.toml`));
    }
    const agents = await readFile(resolve(destination, "AGENTS.md"), "utf8");
    for (const rule of core.rules) assert.ok(agents.includes(`### ${rule.title || rule.id}`), rule.id);

    await access(resolve(destination, ".codex-plugin", "plugin.json"));
    await access(resolve(destination, "config.toml"));
    await access(resolve(destination, "terra-max.config.toml"));
    const config = await readFile(resolve(destination, "config.toml"), "utf8");
    assert.match(config, /model = "gpt-6\.1-sol"/u);
    assert.match(config, /approval_policy = "never"/u);
    assert.match(config, /sandbox_mode = "danger-full-access"/u);
    assert.match(await readFile(resolve(destination, "terra-max.config.toml"), "utf8"), /gpt-5\.6-terra/u);
    for (const hook of [
      "hooks.json", "bootstrap.json", "bootstrap.mjs", "activity-audit.json",
      "activity-audit.mjs", "checkpoint.json", "audit-log.mjs", "pre-compact.mjs"
    ]) await access(resolve(destination, "hooks", hook));
    assert.equal(JSON.parse(await readFile(resolve(destination, "hooks", "hooks.json"), "utf8")).hooks.PreToolUse, undefined);

    const statePath = resolve(destination, ".all-about-agents", "state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    assert.deepEqual(state.surfaces, ["codex"]);
    assert.equal(state.profile, "template");
    assert.ok(state.ownedPaths.length > 0);
    await assertOwnedHashes(destination, state);

    const second = await installFromUnrelatedCwd(root, destination);
    assert.equal(second.status, "complete");
    assert.ok(second.plans[0].actions.every((action) => action.kind === "unchanged"));
    assert.equal(await readFile(neighbor, "utf8"), "keep me\n");
    await assertOwnedHashes(destination, JSON.parse(await readFile(statePath, "utf8")));
  });
});

test("Codex Windows hooks run through PowerShell from an unrelated directory", { skip: process.platform !== "win32" ? "Windows shell routes are unavailable on this platform" : false }, async () => {
  const core = await loadCore(process.cwd());
  await withTempRoot(async (root) => {
    const destination = resolve(root, "Codex ทีม O'Reilly $root");
    const nativeData = resolve(root, "Codex native data");
    const unrelated = resolve(root, "unrelated");
    await mkdir(unrelated, { recursive: true });
    const rendered = renderCodex({ core, profile: "portable", platform: "win32", env: {}, homeDir: root });
    for (const file of rendered.files) {
      if (!file.relativePath.startsWith("hooks/") && file.relativePath !== ".agents/skills/using-all-about-agents/SKILL.md") continue;
      const target = resolve(destination, ...file.relativePath.split("/"));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content);
    }
    const hooks = JSON.parse(await readFile(resolve(destination, "hooks/hooks.json"), "utf8")).hooks;
    const shells = ["pwsh", "powershell.exe"].filter((shell) => spawnSync(shell, ["-NoProfile", "-NonInteractive", "-Command", "exit 0"], { encoding: "utf8" }).status === 0);
    assert.ok(shells.length > 0, "a Windows PowerShell route must be available");
    for (const shell of shells) {
      for (const event of ["SessionStart", "PostToolUse", "PreCompact"]) {
        const child = spawnSync(shell, ["-NoProfile", "-NonInteractive", "-Command", hooks[event][0].hooks[0].commandWindows], {
          cwd: unrelated,
          encoding: "utf8",
          env: { ...process.env, PLUGIN_ROOT: destination, PLUGIN_DATA: nativeData },
          input: JSON.stringify({ hook_event_name: event, source: "startup", tool_name: "Bash", session_id: "hooks-shell-check", trigger: "manual" }),
          timeout: 10000
        });
        assert.equal(child.error, undefined, `${shell} ${event} failed to start`);
        assert.equal(child.status, 0, `${shell} ${event}: ${child.stderr}`);
        assert.equal(child.stderr, "", `${shell} ${event} must not emit errors`);
        if (event === "SessionStart") {
          const output = JSON.parse(child.stdout).hookSpecificOutput;
          assert.equal(output.hookEventName, "SessionStart");
          assert.ok(output.additionalContext.includes("# Bootstrap skill"));
        } else {
          const log = event === "PostToolUse" ? "audit/activity-audit.log" : "checkpoints/checkpoint.jsonl";
          const entries = (await readFile(resolve(nativeData, log), "utf8")).trim().split(/\r?\n/u).map((line) => JSON.parse(line));
          const last = entries.at(-1);
          if (event === "PostToolUse") {
            assert.equal(last.actionId, "bash");
            assert.equal(last.surface, "codex");
          } else {
            assert.equal(last.sessionId, "hooks-shell-check");
            assert.equal(last.trigger, "manual");
          }
        }
      }
    }
  });
});
