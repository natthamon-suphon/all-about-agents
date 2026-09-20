import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { ANTIGRAVITY_ROOT_ENV, ANTIGRAVITY_SEMANTIC_MAPPINGS, renderAntigravity, resolveGeminiHome } from "../../adapters/antigravity/adapter.mjs";
import { resolveNativeInstructionRoot, resolveNativeProductRoot } from "../../installers/lib/native-registration.mjs";
import { nativeIntegrationStatus } from "../../adapters/shared/native-state.mjs";
import { loadCore } from "../../installers/lib/load-core.mjs";

const core = await loadCore(process.cwd());

// `env` is pinned: resolveGeminiHome reads the root override, so an ambient
// AAA_ANTIGRAVITY_ROOT would otherwise change the rendered config root and make
// these snapshots machine-dependent.
function render(profileId = "portable", targetRuntime = "cli") {
  return renderAntigravity({ core, profile: { id: profileId }, env: {}, homeDir: "C:/Users/tester", platform: "win32", targetRuntime });
}

function fileMap(result) {
  return new Map(result.files.map((file) => [file.relativePath, new TextDecoder().decode(file.content)]));
}

function registrationOfKind(result, kind) {
  return result.registrations.filter((entry) => entry.kind === kind);
}

test("the plugin manifest sits at the package root and declares only documented properties", () => {
  const files = fileMap(render());
  assert.ok(files.has("plugin.json"), "agy plugin validate fails with 'missing plugin.json' unless the manifest is at the root");
  assert.equal(files.has(".claude-plugin/plugin.json"), false);
  assert.equal(files.has(".codex-plugin/plugin.json"), false);
  const manifest = JSON.parse(files.get("plugin.json"));
  assert.deepEqual(Object.keys(manifest).sort(), ["description", "name"]);
  assert.equal(manifest.name, "all-about-agents");
});

test("no hook or status line is rendered", () => {
  for (const profileId of ["portable", "template"]) {
    const paths = [...fileMap(render(profileId)).keys()];
    assert.deepEqual(paths.filter((path) => path.startsWith("hooks/")), []);
    assert.deepEqual(paths.filter((path) => path.startsWith("statusline/")), []);
    assert.equal(paths.includes("hooks.json"), false);
    assert.equal(paths.includes("settings.overlay.json"), false);
  }
});

test("the bootstrap surface list still excludes Antigravity", async () => {
  const source = await readFile(resolve(process.cwd(), "core/hooks/bootstrap.mjs"), "utf8");
  const declaration = /const SESSION_START_SURFACES = new Set\(\[([^\]]*)\]\)/u.exec(source);
  assert.ok(declaration, "bootstrap must keep an explicit session-start surface list");
  assert.equal(declaration[1].includes("antigravity"), false, "Antigravity has no SessionStart event to hook");
});

test("GEMINI.md inlines the routing contract because no hook can inject it", () => {
  const gemini = fileMap(render()).get("GEMINI.md");
  const bootstrap = core.skills.find((record) => (record.id ?? record.name) === "using-all-about-agents");
  assert.ok(bootstrap, "core must provide the bootstrap skill");
  assert.match(gemini, /^# Global Operating Rules/u);
  assert.match(gemini, /## Routing contract/u);
  for (const marker of ["<SUBAGENT-STOP>", "<EXTREMELY-IMPORTANT>", "## Red flags"]) {
    assert.ok(gemini.includes(marker), `GEMINI.md must inline the bootstrap body (${marker})`);
  }
  assert.equal(gemini.includes("---\nname: using-all-about-agents"), false, "the inlined body must not carry skill frontmatter");
  assert.match(gemini, /## Presentation/u);
});

test("the global instruction deploy refuses to clobber an unowned GEMINI.md", () => {
  const [instructions] = registrationOfKind(render(), "instructions");
  assert.equal(instructions.relativePath, "GEMINI.md");
  assert.equal(instructions.destination, "GEMINI.md");
  assert.equal(instructions.guard, "no-clobber", "a live GEMINI.md may hold sections this package does not own");
});

test("skills and roles use the layout agy plugin validate accepts", () => {
  const files = fileMap(render());
  const skills = [...files.keys()].filter((path) => /^skills\/[^/]+\/SKILL\.md$/u.test(path));
  const agents = [...files.keys()].filter((path) => /^agents\/[^/]+\.md$/u.test(path));
  assert.equal(skills.length, core.inventory.skills.length);
  assert.equal(agents.length, core.roles.length);
  for (const skill of core.inventory.skills) assert.ok(files.has(`skills/${skill}/SKILL.md`), skill);
  for (const role of core.roles) assert.match(files.get(`agents/${role.id}.md`), /^---\nname: /u);
  assert.ok(files.has("skills/using-all-about-agents/references/adapter-capability-guidance.md"));
});

test("emergency protection is recorded without writing the operator's permission settings", () => {
  for (const targetRuntime of ["cli", "desktop"]) {
    const result = render("template", targetRuntime);
    const records = result.registrations.filter((entry) => entry.kind === "native-integration" && entry.feature === "emergency-protection");
    assert.equal(records.length, 1);
    assert.notEqual(nativeIntegrationStatus(records[0]), "pass");
    assert.ok(records[0].manualSteps.some((step) => step.includes("command(rm -rf)") && step.includes("write_file(/home/user/.ssh)")));
    assert.equal([...fileMap(result).keys()].some((path) => path.endsWith("settings.json")), false);
  }
});

test("the template profile records the approved model as a manual selection", () => {
  const portable = render("portable").registrations.filter((entry) => entry.kind === "manual-step");
  const template = render("template").registrations.filter((entry) => entry.kind === "manual-step");
  assert.equal(portable.some((entry) => entry.id === "approved-gemini-pro-model"), false);
  const model = template.find((entry) => entry.id === "approved-gemini-pro-model");
  assert.ok(model);
  assert.match(model.instruction, /gemini-3\.1-pro-high/u);
});

test("the config root is the documented Gemini home on both platforms", () => {
  assert.equal(resolveGeminiHome({ env: {}, homeDir: "C:/Users/tester", platform: "win32" }), "C:\\Users\\tester\\.gemini");
  assert.equal(resolveGeminiHome({ env: {}, homeDir: "/home/tester", platform: "linux" }), "/home/tester/.gemini");
  const [root] = registrationOfKind(render(), "resolved-config-root");
  assert.equal(root.rootEnv, null, "Antigravity documents no environment variable for its home");
  assert.equal(root.path, "C:\\Users\\tester\\.gemini");
});

test("the render is deterministic and matches the checked-in snapshots", async () => {
  for (const profileId of ["portable", "template"]) {
    const first = render(profileId);
    const second = render(profileId);
    assert.deepEqual(first, second, `${profileId} render drift`);
    const snapshot = JSON.parse(await readFile(resolve(process.cwd(), `tests/snapshots/antigravity/${profileId}.json`), "utf8"));
    assert.equal(snapshot.fileCount, first.files.length);
    assert.deepEqual(
      snapshot.files.map((file) => [file.relativePath, file.sha256]),
      first.files.map((file) => [file.relativePath, createHash("sha256").update(file.content).digest("hex")])
    );
    assert.deepEqual(snapshot.registrations, JSON.parse(JSON.stringify(first.registrations)));
  }
});

test("the repository override redirects the config root away from the live home", () => {
  const home = { env: {}, homeDir: "/home/tester", platform: "linux" };
  const redirected = { ...home, env: { [ANTIGRAVITY_ROOT_ENV]: "/tmp/disposable-gemini" } };
  assert.equal(resolveGeminiHome(redirected), "/tmp/disposable-gemini");
  // Registration must honor it too, or every qualification run would still
  // resolve to the operator's real directory.
  assert.equal(resolveNativeProductRoot("antigravity", redirected), "/tmp/disposable-gemini");
  assert.equal(resolveNativeInstructionRoot("antigravity", redirected), "/tmp/disposable-gemini");
  for (const blank of ["", "   "]) {
    assert.equal(resolveGeminiHome({ ...home, env: { [ANTIGRAVITY_ROOT_ENV]: blank } }), "/home/tester/.gemini");
  }
});

test("the manifest repeats the adapter's semantic mappings exactly", async () => {
  const manifest = JSON.parse(await readFile(resolve(process.cwd(), "installers/manifests/antigravity.json"), "utf8"));
  assert.deepEqual(
    JSON.parse(JSON.stringify(manifest.semanticCapabilities)),
    JSON.parse(JSON.stringify(ANTIGRAVITY_SEMANTIC_MAPPINGS)),
    "a manifest that drifts from the adapter documents capabilities the render does not grant"
  );
});

test("rendered roles grant no native tools", () => {
  const files = fileMap(render());
  const nativeVocabulary = new Set(Object.values(ANTIGRAVITY_SEMANTIC_MAPPINGS).flat());
  let checked = 0;
  for (const [path, content] of files) {
    if (!/^agents\/[^/]+\.md$/u.test(path)) continue;
    checked += 1;
    const frontmatter = /^---\n([\s\S]*?)\n---/u.exec(content);
    assert.ok(frontmatter, `${path} must open with frontmatter`);
    const keys = frontmatter[1].split("\n").map((line) => line.split(":")[0].trim()).sort();
    assert.deepEqual(keys, ["description", "name"], `${path} must declare only name and description; this surface grants no tools`);
    for (const tool of nativeVocabulary) {
      if (tool.endsWith(".md")) continue;
      assert.equal(frontmatter[1].includes(tool), false, `${path} frontmatter must not name the native tool ${tool}`);
    }
  }
  assert.equal(checked, 7, "every role file must be checked");
});

test("the root override moves the recorded config root but never the package bytes", () => {
  const base = { core, profile: { id: "portable" }, homeDir: "C:/Users/tester", platform: "win32", targetRuntime: "cli" };
  const pinned = renderAntigravity({ ...base, env: {} });
  const hijacked = renderAntigravity({ ...base, env: { [ANTIGRAVITY_ROOT_ENV]: "/tmp/hijacked" } });
  const rootOf = (result) => result.registrations.find((entry) => entry.kind === "resolved-config-root").path;
  assert.equal(rootOf(pinned), "C:\\Users\\tester\\.gemini");
  assert.equal(rootOf(hijacked), "/tmp/hijacked");
  const bytes = (result) => JSON.stringify(result.files.map((file) => [file.relativePath, [...file.content]]));
  assert.equal(bytes(pinned), bytes(hijacked), "the root override must never change rendered file content");
});
