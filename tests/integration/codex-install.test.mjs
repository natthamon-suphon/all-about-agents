import assert from "node:assert/strict";
import { access, mkdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

import { loadCore } from "../../installers/lib/load-core.mjs";
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
    assert.equal(core.skills.length, 28);
    assert.equal(core.roles.length, 7);
    assert.equal(core.rules.length, 9);
    assert.equal(core.workflows.length, 6);
    assert.equal(core.commands.length, 8);

    for (const skill of core.skills) await access(resolve(destination, ".agents", "skills", skill.id, "SKILL.md"));
    for (const role of core.roles) {
      await access(resolve(destination, ".codex", "agents", `${role.id}.toml`));
      await access(resolve(destination, "agents", `${role.id}.toml`));
    }
    const agents = await readFile(resolve(destination, "AGENTS.md"), "utf8");
    for (const rule of core.rules) assert.ok(agents.includes(`### ${rule.title || rule.id}`), rule.id);
    for (const command of core.commands) assert.ok(agents.includes(command.actionId), command.actionId);
    for (const workflow of core.workflows) assert.ok(agents.includes(workflow.id), workflow.id);

    await access(resolve(destination, ".codex-plugin", "plugin.json"));
    await access(resolve(destination, "config.toml"));
    await access(resolve(destination, "terra-max.config.toml"));
    const config = await readFile(resolve(destination, "config.toml"), "utf8");
    assert.match(config, /model = "gpt-5\.6-sol"/u);
    assert.match(config, /approval_policy = "never"/u);
    assert.match(config, /sandbox_mode = "danger-full-access"/u);
    assert.match(await readFile(resolve(destination, "terra-max.config.toml"), "utf8"), /gpt-5\.6-terra/u);
    for (const hook of [
      "hooks.json", "bootstrap.json", "bootstrap.mjs", "activity-audit.json",
      "activity-audit.mjs", "checkpoint.json", "audit-log.mjs", "pre-compact.mjs",
      "emergency-guard.json", "emergency-guard.mjs", "emergency-policy.mjs"
    ]) await access(resolve(destination, "hooks", hook));
    assert.match(await readFile(resolve(destination, "hooks", "emergency-policy.mjs"), "utf8"), /filesystem-root-erasure/u);

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
