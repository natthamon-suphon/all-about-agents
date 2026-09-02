import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { relative, resolve } from "node:path";
import test from "node:test";

import { loadCore } from "../../installers/lib/load-core.mjs";
import { renderAntigravity } from "../../adapters/antigravity-2/adapter.mjs";
import { withTempRoot } from "../helpers/temp-root.mjs";

const core = await loadCore(process.cwd());
const roles = ["architect", "implementer", "investigator", "researcher", "reviewer", "security-reviewer", "verifier"];
const pluginRoot = ".agents/plugins/all-about-agents";
const script = resolve(process.cwd(), "scripts", "aaa.mjs");

async function filesUnder(root) {
  const paths = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else paths.push(relative(root, absolute).replaceAll("\\", "/"));
    }
  }
  await visit(root);
  return paths.sort();
}

async function snapshot(root) {
  const paths = (await filesUnder(root)).filter((path) => path !== ".all-about-agents/state.json");
  return new Map(await Promise.all(paths.map(async (path) => [path, [...await readFile(resolve(root, path))]])));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function runInstall(cwd, destination) {
  const result = spawnSync(process.execPath, [
    script, "install", "--surface", "antigravity-2", "--profile", "template",
    "--destination-root", destination, "--apply", "--format", "json"
  ], { cwd, encoding: "utf8" });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("Antigravity 2 clean-profile apply materializes the complete disposable package", async () => {
  await withTempRoot(async (root) => {
    const unrelated = resolve(root, "unrelated-cwd");
    const destination = resolve(root, "antigravity-2");
    await mkdir(unrelated, { recursive: true });
    const firstReport = runInstall(unrelated, destination);
    assert.equal(firstReport.status, "complete");

    assert.equal(core.inventory.skills.length, 28);
    assert.equal(core.roles.length, 7);
    assert.equal(core.rules.length, 9);
    assert.equal(core.workflows.length, 6);
    assert.equal(core.commands.length, 8);
    for (const skill of core.inventory.skills) await access(resolve(destination, pluginRoot, "skills", skill, "SKILL.md"));
    for (const role of roles) await access(resolve(destination, pluginRoot, "agents", `${role}.md`));
    for (const path of [
      `${pluginRoot}/plugin.json`, `${pluginRoot}/hooks.json`,
      `${pluginRoot}/hooks/activity-audit.json`, `${pluginRoot}/hooks/checkpoint.json`,
      `${pluginRoot}/rules/AGENTS.md`
    ]) await access(resolve(destination, path));
    const generatedRules = (await filesUnder(resolve(destination, pluginRoot, "rules"))).filter((path) => path.endsWith(".md"));
    assert.deepEqual(generatedRules, ["AGENTS.md"]);

    const rendered = renderAntigravity({ core, profile: { id: "template" }, statuslineName: "", platform: process.platform });
    const model = rendered.registrations.find((entry) => entry.kind === "manual-model-selection");
    assert.deepEqual(model, {
      kind: "manual-model-selection",
      surface: "antigravity-2-desktop",
      model: "Gemini 3.7 Flash High",
      status: "verified",
      persistence: "conversation-local",
      applyVia: "Desktop model selector",
      evidence: { productVersion: "2.11.0", platform: "win32", observedAt: "2026-08-31" }
    });
    assert.equal(rendered.registrations.some((entry) => entry.kind === "unsupported-diagnostic"), false);
    const permission = rendered.registrations.find((entry) => entry.kind === "permission-ui");
    assert.equal(permission.preset, "Custom");
    assert.equal(permission.accessIntent, "full");
    assert.equal(permission.turboMode, false);
    assert.equal(permission.manualOnly, true);
    assert.ok(permission.deny.includes("command(rm -rf)"));
    assert.ok(permission.deny.includes("command(sudo)"));
    const plugin = rendered.registrations.find((entry) => entry.kind === "plugin-registration");
    assert.equal(plugin.manualOnly, true);
    const hook = rendered.registrations.find((entry) => entry.kind === "hook-contract");
    assert.equal(hook.automaticHookExecution, false);
    assert.equal(hook.probeRequired, true);
    assert.equal(hook.probe.status, "not run");
    assert.equal(rendered.registrations.some((entry) => entry.kind === "emergency-guard"), false);
    assert.ok(rendered.diagnostics.filter((entry) => entry.code === "desktop-action-unknown").length >= core.commands.length);

    const hooks = JSON.parse(await readFile(resolve(destination, pluginRoot, "hooks.json"), "utf8"));
    assert.equal(hooks["all-about-agents-safety"].enabled, false);
    assert.doesNotMatch(JSON.stringify(hooks), /command|hooks\.mjs/iu);
    assert.equal(existsSync(resolve(destination, pluginRoot, "hooks", "emergency-guard.json")), false);

    const statePath = resolve(destination, ".all-about-agents", "state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    assert.deepEqual(state.surfaces, ["antigravity-2"]);
    assert.equal(state.profile, "template");
    const packagePaths = await filesUnder(destination);
    const managedPaths = packagePaths.filter((path) => path !== ".all-about-agents/state.json");
    assert.equal(state.ownedPaths.length, managedPaths.length);
    for (const owned of state.ownedPaths) {
      assert.equal(owned.sha256, sha256(await readFile(resolve(destination, owned.relativePath))));
    }
    const before = await snapshot(destination);
    const secondReport = runInstall(unrelated, destination);
    assert.equal(secondReport.status, "complete");
    assert.ok(secondReport.plans[0].actions.every((action) => action.kind === "unchanged"));
    assert.deepEqual(await snapshot(destination), before);
  });
});
