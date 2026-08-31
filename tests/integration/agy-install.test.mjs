import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { relative, resolve } from "node:path";
import test from "node:test";

import { loadCore } from "../../installers/lib/load-core.mjs";
import { renderAgy } from "../../adapters/agy/adapter.mjs";
import { withTempRoot } from "../helpers/temp-root.mjs";

const core = await loadCore(process.cwd());
const roles = ["architect", "implementer", "investigator", "researcher", "reviewer", "security-reviewer", "verifier"];
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
    script, "install", "--surface", "agy", "--profile", "template",
    "--destination-root", destination, "--apply", "--format", "json"
  ], { cwd, encoding: "utf8" });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("agy clean-profile apply materializes the complete disposable package", async () => {
  await withTempRoot(async (root) => {
    const unrelated = resolve(root, "unrelated-cwd");
    const destination = resolve(root, "agy");
    await mkdir(unrelated, { recursive: true });
    const firstReport = runInstall(unrelated, destination);
    assert.equal(firstReport.status, "complete");

    assert.equal(core.inventory.skills.length, 28);
    assert.equal(core.roles.length, 7);
    assert.equal(core.rules.length, 9);
    assert.equal(core.workflows.length, 6);
    assert.equal(core.commands.length, 8);
    for (const skill of core.inventory.skills) await access(resolve(destination, "skills", skill, "SKILL.md"));
    for (const role of roles) await access(resolve(destination, "agents", role, "agent.md"));
    for (const rule of core.rules) await access(resolve(destination, "rules", `${rule.id}.md`));
    for (const path of [
      "plugin.json", "README.md", "hooks.json", "activity-audit.json", "checkpoint.json",
      "emergency-guard.json", "settings.overlay.json", "rules/model-selection.md",
      "rules/permission-safety.md", "rules/hook-contract.md", "rules/settings-overlay.md"
    ]) await access(resolve(destination, path));
    assert.deepEqual((await filesUnder(destination)).filter((path) => path.includes(".gemini/") || path.includes("config/")), []);

    const rendered = renderAgy({ core, profile: { id: "template" }, statuslineName: "", platform: process.platform });
    const install = rendered.registrations.find((entry) => entry.kind === "plugin-registration");
    assert.equal(install.manualOnly, true);
    assert.equal(install.disposableOnly, true);
    assert.equal(install.automaticInstall, false);
    for (const command of ["agy plugin install PACKAGE_DIRECTORY", "agy plugin list", "agy agents", "agy models"]) {
      assert.ok(rendered.registrations.some((entry) => entry.command === command));
    }
    const model = rendered.registrations.find((entry) => entry.kind === "model-selection");
    assert.equal(model.model, "gemini-3.7-flash-high");
    assert.equal(model.effort, "high");
    assert.equal(model.manualOnly, true);
    const fullAccess = rendered.registrations.find((entry) => entry.kind === "full-access-per-run");
    assert.equal(fullAccess.manualOnly, true);
    assert.ok(fullAccess.args.includes("--dangerously-skip-permissions"));
    assert.ok(fullAccess.emergencyDeny.includes("command(rm -rf)"));
    assert.ok(fullAccess.emergencyDeny.includes("command(sudo)"));
    const settings = rendered.registrations.find((entry) => entry.kind === "settings-overlay");
    assert.equal(settings.manualOnly, true);
    assert.equal(settings.automaticWrite, false);
    assert.equal(settings.status, "manual-discovery-required");
    assert.deepEqual(settings.destinationCandidates, ["~/.gemini/antigravity-cli/settings.json"]);
    const hook = rendered.registrations.find((entry) => entry.kind === "hook-contract");
    assert.equal(hook.automaticHookExecution, false);
    assert.equal(hook.probeRequired, true);
    assert.equal(hook.probe.status, "not run");
    const emergency = rendered.registrations.find((entry) => entry.kind === "emergency-guard");
    assert.equal(emergency.automatic, false);
    assert.equal(emergency.status, "not run");
    const acceptance = rendered.registrations.find((entry) => entry.kind === "native-acceptance");
    assert.equal(acceptance.status, "partial");
    assert.equal(acceptance.productVersion, "1.1.22");
    assert.equal(acceptance.checks.find((check) => check.id === "plugin-validation").status, "pass");
    assert.equal(acceptance.manualOnly, true);
    assert.ok(rendered.diagnostics.filter((entry) => entry.code === "agy-action-unknown").length >= core.commands.length);

    const hooks = JSON.parse(await readFile(resolve(destination, "hooks.json"), "utf8"));
    assert.equal(hooks["all-about-agents-safety"].enabled, false);
    assert.doesNotMatch(JSON.stringify(hooks), /command|hooks\.mjs/iu);
    const guard = JSON.parse(await readFile(resolve(destination, "emergency-guard.json"), "utf8"));
    assert.equal(guard.automatic, false);
    assert.equal(guard.probeRequired, true);
    assert.equal(guard.probe.status, "not run");

    const state = JSON.parse(await readFile(resolve(destination, ".all-about-agents", "state.json"), "utf8"));
    assert.deepEqual(state.surfaces, ["agy"]);
    assert.equal(state.profile, "template");
    const managedPaths = (await filesUnder(destination)).filter((path) => path !== ".all-about-agents/state.json");
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
