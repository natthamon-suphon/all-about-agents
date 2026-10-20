import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";

import { loadCore } from "../../installers/lib/load-core.mjs";
import { materializeRenderResult, renderForSurface } from "../../installers/lib/render.mjs";
import { planNativeRegistration } from "../../installers/lib/native-registration.mjs";
import { buildManagedState, STATE_RELATIVE_PATH } from "../../installers/lib/state.mjs";
import { withTempRoot } from "../helpers/temp-root.mjs";

test("Antigravity manual consumers retain LICENSE in every package copy list", async () => {
  const core = await loadCore(process.cwd());
  const version = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")).version;
  const guide = await readFile(new URL("../../docs/maintenance/native-registration.md", import.meta.url), "utf8");
  const copyList = /copy LICENSE, plugin\.json, skills\/, and agents\//u;
  for (const profile of ["portable", "template"]) await withTempRoot(async (fixtureRoot) => {
    const rendered = await renderForSurface({ core, surface: "antigravity", profile, env: {}, homeDir: fixtureRoot, platform: process.platform, targetRuntime: "cli" });
    const materialized = materializeRenderResult(rendered);
    const packageRoot = resolve(fixtureRoot, "package");
    for (const file of materialized.files) {
      const target = resolve(packageRoot, file.relativePath);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content);
    }
    const state = buildManagedState({ repositoryVersion: version, profile, surfaces: ["antigravity"], ownedPaths: materialized.ownership });
    const statePath = resolve(packageRoot, STATE_RELATIVE_PATH);
    await mkdir(dirname(statePath), { recursive: true });
    await writeFile(statePath, JSON.stringify(state));
    const productRoot = resolve(fixtureRoot, "product");
    const plan = planNativeRegistration({ surface: "antigravity", profile, packageRoot, productRoot, instructionRoot: productRoot, platform: process.platform, rendered });
    const text = (path) => new TextDecoder().decode(rendered.files.find((file) => file.relativePath === path).content);
    const lists = [
      guide, text("README.md"), text("docs/manual-desktop.md"),
      rendered.registrations.find((entry) => entry.id === "desktop-workspace-slot").instruction,
      plan.actions.find((entry) => entry.id === "antigravity-desktop-slot").message
    ];
    for (const list of lists) assert.match(list.replaceAll("`", "").replace(/\s+/gu, " "), copyList);
    assert.deepEqual(await readFile(resolve(packageRoot, "LICENSE")), await readFile(new URL("../../LICENSE", import.meta.url)));
  });
});

test("every surface declares LICENSE as a managed package asset", async () => {
  for (const surface of ["antigravity", "claude", "codex"]) {
    const manifest = JSON.parse(await readFile(new URL(`../../installers/manifests/${surface}.json`, import.meta.url), "utf8"));
    assert.ok(manifest.ownedPaths.includes("LICENSE"), `${surface} must declare package LICENSE ownership`);
  }
});

test("all managed packages retain canonical license bytes through materialization", async (t) => {
  const core = await loadCore(process.cwd());
  const license = await readFile(new URL("../../LICENSE", import.meta.url));
  assert.match(license.toString("utf8"), /Copyright \(c\) 2025 Jesse Vincent/u);
  assert.match(license.toString("utf8"), /Copyright \(c\) 2026 Matt Pocock/u);
  for (const surface of ["antigravity", "claude", "codex"]) for (const profile of ["portable", "template"]) {
    await t.test(`${surface}:${profile}`, async () => {
      const input = { core, surface, profile, env: {}, homeDir: "C:/Users/tester", platform: "win32", targetRuntime: "cli", statuslineName: "" };
      const first = await renderForSurface(input);
      const second = await renderForSurface(input);
      assert.deepEqual(first, second, "render bytes and ownership must be deterministic");
      for (const result of [first, materializeRenderResult(first)]) {
        const file = result.files.find(({ relativePath }) => relativePath === "LICENSE");
        assert.ok(file, `${surface}:${profile} package must carry LICENSE`);
        assert.deepEqual(Buffer.from(file.content), license);
        assert.deepEqual(result.ownership.find(({ relativePath }) => relativePath === "LICENSE"), {
          relativePath: "LICENSE", sha256: createHash("sha256").update(license).digest("hex")
        });
        assert.equal(result.registrations.some((entry) => entry.relativePath === "LICENSE" || entry.destination === "LICENSE"), false, "notice must not map into global configuration");
      }
    });
  }
});
