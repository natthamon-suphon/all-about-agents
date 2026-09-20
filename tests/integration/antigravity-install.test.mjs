import assert from "node:assert/strict";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

import { renderAntigravity } from "../../adapters/antigravity/adapter.mjs";
import { loadCore } from "../../installers/lib/load-core.mjs";
import { hashBytes } from "../../installers/lib/hash.mjs";
import { readManagedState, serializeManagedState } from "../../installers/lib/state.mjs";
import { planNativeRegistration } from "../../installers/lib/native-registration.mjs";
import { withTempRoot } from "../helpers/temp-root.mjs";

const CLI = resolve(process.cwd(), "scripts", "aaa.mjs");

function runCli(args, cwd) {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
  return result;
}

async function installAntigravity(root, destination, { profile = "portable", surface = "antigravity" } = {}) {
  const unrelated = resolve(root, "unrelated");
  await mkdir(unrelated, { recursive: true });
  const result = runCli([
    "install", "--surface", surface, "--profile", profile,
    "--destination-root", destination, "--apply", "--format", "json"
  ], unrelated);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout);
}

test("Antigravity install materializes the layout agy reads and is idempotent", async () => {
  await withTempRoot(async (root) => {
    const destination = resolve(root, "antigravity");
    const neighbor = resolve(destination, "unmanaged-neighbor.txt");
    await mkdir(destination, { recursive: true });
    await writeFile(neighbor, "keep me\n", "utf8");

    const first = await installAntigravity(root, destination);
    assert.equal(first.status, "complete");

    const core = await loadCore(process.cwd());
    await access(resolve(destination, "plugin.json"));
    await access(resolve(destination, "GEMINI.md"));
    for (const skill of core.skills) await access(resolve(destination, "skills", skill.id, "SKILL.md"));
    for (const role of core.roles) await access(resolve(destination, "agents", `${role.id}.md`));

    // The manifest must be readable at the root: agy plugin validate fails with
    // "missing plugin.json" otherwise.
    const manifest = JSON.parse(await readFile(resolve(destination, "plugin.json"), "utf8"));
    assert.equal(manifest.name, "all-about-agents");

    const state = await readManagedState(destination);
    assert.deepEqual(state.surfaces, ["antigravity"]);
    for (const entry of state.ownedPaths) {
      const bytes = await readFile(resolve(destination, ...entry.relativePath.split("/")));
      assert.equal(hashBytes(bytes), entry.sha256, entry.relativePath);
    }

    const second = await installAntigravity(root, destination);
    assert.equal(second.status, "complete");
    assert.equal(await readFile(neighbor, "utf8"), "keep me\n", "an unmanaged neighbor must survive a refresh");
  });
});

test("a two-surface managed root gains Antigravity without disturbing the other surfaces", async () => {
  await withTempRoot(async (root) => {
    const destination = resolve(root, "shared");
    const unrelated = resolve(root, "unrelated");
    await mkdir(unrelated, { recursive: true });

    // Reproduce what an existing machine holds: a root rendered before this
    // surface existed, whose managed state names only claude and codex.
    for (const surface of ["claude", "codex"]) {
      const result = runCli([
        "install", "--surface", surface, "--profile", "portable",
        "--destination-root", resolve(destination, surface), "--apply", "--format", "json",
        ...(surface === "claude" ? ["--statusline-name", "tester"] : [])
      ], unrelated);
      assert.equal(result.status, 0, result.stderr);
    }
    const beforeClaude = await readManagedState(resolve(destination, "claude"));
    assert.deepEqual(beforeClaude.surfaces, ["claude"]);

    const added = await installAntigravity(root, resolve(destination, "antigravity"));
    assert.equal(added.status, "complete");

    const afterClaude = await readManagedState(resolve(destination, "claude"));
    assert.deepEqual(afterClaude.ownedPaths, beforeClaude.ownedPaths, "adding a surface must not rewrite a sibling package");
    await access(resolve(destination, "codex", "AGENTS.md"));
    await access(resolve(destination, "antigravity", "GEMINI.md"));
  });
});

test("registration refuses to overwrite an existing GEMINI.md it does not own", async () => {
  await withTempRoot(async (root) => {
    const destination = resolve(root, "antigravity");
    const productRoot = resolve(root, "gemini-home");
    await mkdir(productRoot, { recursive: true });
    await installAntigravity(root, destination);

    const operatorContent = "# Global Operating Rules\n\n## Caveman mode (always on)\n\nkeep me\n";
    await writeFile(resolve(productRoot, "GEMINI.md"), operatorContent, "utf8");

    const plan = planNativeRegistration({
      surface: "antigravity",
      packageRoot: destination,
      productRoot,
      instructionRoot: productRoot,
      profile: "portable",
      platform: process.platform,
      rendered: null
    });

    const deploy = plan.actions.find((action) => action.id === "antigravity-instructions-deploy");
    assert.ok(deploy, "the plan must deploy GEMINI.md");
    assert.equal(deploy.guard, "no-clobber");
    assert.equal(deploy.expectedProbe, "hash-verified-write-or-refuse");

    // The adapter declares the guard and the registration planner enforces it.
    // They are separate code paths, so assert they agree: dropping the guard in
    // one place must not leave the other advertising protection it lost.
    const core = await loadCore(process.cwd());
    const declared = renderAntigravity({ core, profile: { id: "portable" }, homeDir: "C:/Users/tester", platform: "win32", targetRuntime: "cli" })
      .registrations.find((entry) => entry.kind === "instructions");
    assert.equal(declared.guard, deploy.guard, "the declared guard and the planned guard must match");
    assert.equal(declared.relativePath, deploy.sourceRelativePath);

    const install = plan.actions.find((action) => action.id === "antigravity-plugin-install");
    assert.ok(install, "the plan must install the plugin");
    assert.equal(install.executable, "agy");
    assert.deepEqual(install.args, ["plugin", "install", destination]);

    // The planner never writes. The operator file must still be untouched.
    assert.equal(await readFile(resolve(productRoot, "GEMINI.md"), "utf8"), operatorContent);
  });
});

test("a shared all-surface root rendered before this surface existed gains it cleanly", async () => {
  await withTempRoot(async (root) => {
    const destination = resolve(root, "package");
    const unrelated = resolve(root, "unrelated");
    await mkdir(unrelated, { recursive: true });

    const install = () => runCli([
      "install", "--surface", "all", "--profile", "portable",
      "--destination-root", destination, "--statusline-name", "tester",
      "--apply", "--format", "json"
    ], unrelated);

    assert.equal(install().status, 0);

    // Rewind the root to what a 2.1.x machine holds: one top-level managed
    // state naming only claude and codex, and no antigravity namespace.
    const statePath = resolve(destination, ".all-about-agents", "state.json");
    const rendered = JSON.parse(await readFile(statePath, "utf8"));
    const claudeAndCodex = {
      ...rendered,
      surfaces: ["claude", "codex"],
      ownedPaths: rendered.ownedPaths.filter((entry) => !entry.relativePath.startsWith("antigravity/"))
    };
    assert.ok(claudeAndCodex.ownedPaths.length < rendered.ownedPaths.length, "the fixture must actually drop antigravity paths");
    // The apply path compares the on-disk bytes with serializeManagedState, so
    // the fixture must be written through the same serializer.
    await writeFile(statePath, serializeManagedState(claudeAndCodex), "utf8");
    await rm(resolve(destination, "antigravity"), { recursive: true, force: true });

    const before = new Map();
    for (const entry of claudeAndCodex.ownedPaths) {
      before.set(entry.relativePath, hashBytes(await readFile(resolve(destination, ...entry.relativePath.split("/")))));
    }

    const upgrade = install();
    assert.equal(upgrade.status, 0, upgrade.stderr);
    const report = JSON.parse(upgrade.stdout);
    assert.equal(report.status, "complete");
    assert.equal(JSON.stringify(report).includes("invalid-previous-state"), false, "adding a surface is not an unreadable state");

    const after = await readManagedState(destination);
    assert.deepEqual(after.surfaces, ["antigravity", "claude", "codex"]);
    await access(resolve(destination, "antigravity", "GEMINI.md"));
    await access(resolve(destination, "antigravity", "plugin.json"));

    for (const [relativePath, sha256] of before) {
      const bytes = await readFile(resolve(destination, ...relativePath.split("/")));
      assert.equal(hashBytes(bytes), sha256, `${relativePath} must survive the upgrade unchanged`);
    }
  });
});
