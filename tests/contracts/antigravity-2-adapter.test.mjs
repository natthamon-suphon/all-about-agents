import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { loadCore } from "../../installers/lib/load-core.mjs";
import { AdapterContractError } from "../../adapters/shared/adapter-contract.mjs";

const requiredOutputs = [
  "adapters/antigravity-2/adapter.mjs",
  "adapters/antigravity-2/templates/",
  "installers/manifests/antigravity-2.json",
  "tests/contracts/antigravity-2-adapter.test.mjs",
  "tests/snapshots/antigravity-2/"
];

test("T010 creates every owned artifact", async () => {
  assert.ok(requiredOutputs.length > 0);
  for (const relativePath of requiredOutputs) {
    await access(resolve(process.cwd(), relativePath));
  }
});

const adapter = await import("../../adapters/antigravity-2/adapter.mjs");
const core = await loadCore(process.cwd());

function fileMap(result) {
  return new Map(result.files.map((file) => [file.relativePath, new TextDecoder().decode(file.content)]));
}

function resultFor(profileId = "portable", overrides = {}) {
  return adapter.renderAntigravity({
    core,
    profile: { id: profileId },
    statuslineName: "",
    platform: "win32",
    homeDir: "C:/Users/tester",
    ...overrides
  });
}

test("Antigravity mappings use documented Desktop tools and no other surface vocabulary", () => {
  const allowed = new Set([
    "view_file", "write_to_file", "replace_file_content", "multi_replace_file_content", "list_dir", "find_by_name",
    "grep_search", "search_web", "read_url_content", "run_command", "invoke_subagent", "define_subagent",
    "send_message", "manage_subagents", "ask_permission", "list_permissions"
  ]);
  for (const tools of Object.values(adapter.ANTIGRAVITY_SEMANTIC_MAPPINGS)) {
    for (const tool of tools) assert.ok(allowed.has(tool), `undocumented Desktop tool ${tool}`);
  }
  const serialized = JSON.stringify(adapter.ANTIGRAVITY_SEMANTIC_MAPPINGS);
  for (const forbidden of ["spawn_agent", "mcp__", "Bash", "Read", "Write", "gemini-3.7-flash-high", "--effort", "--model", "antigravity-cli", ".claude"]) {
    assert.equal(serialized.includes(forbidden), false, `mapping reused another surface: ${forbidden}`);
  }
});

test("portable Desktop render contains documented plugin components and every canonical skill", () => {
  const result = resultFor();
  const files = fileMap(result);
  assert.ok(files.has(".agents/plugins/all-about-agents/plugin.json"));
  assert.ok(files.has(".agents/plugins/all-about-agents/hooks.json"));
  assert.ok(files.has(".agents/plugins/all-about-agents/rules/authority-and-scope.md"));
  assert.ok(files.has(".agents/plugins/all-about-agents/rules/model-selection.md"));
  assert.ok(files.has(".agents/plugins/all-about-agents/rules/permission-safety.md"));
  for (const role of ["researcher", "investigator", "architect", "implementer", "verifier", "reviewer", "security-reviewer"]) {
    assert.ok(files.has(`.agents/plugins/all-about-agents/agents/${role}.md`), `missing native agent ${role}`);
  }
  for (const skill of core.inventory.skills) {
    assert.ok(files.has(`.agents/plugins/all-about-agents/skills/${skill}/SKILL.md`), `missing canonical skill ${skill}`);
  }
  assert.equal(files.has("settings.json"), false);
  assert.equal(files.has("config/settings.json"), false);
  assert.equal(files.has("AGENTS.md"), false);
  assert.equal(files.has("CLAUDE.md"), false);
  assert.equal(files.has(".agents/workflows/design-change.md"), false);
  assert.equal(result.diagnostics.some((entry) => entry.code === "missing-skill-source"), true);
});

test("Desktop agent templates use only the published frontmatter fields", () => {
  const files = fileMap(resultFor());
  const fields = new Set(["name", "description", "tools", "mainAgent", "subagent", "model", "commandExecutionPolicy", "mcpServers", "skills", "plugins"]);
  for (const role of ["researcher", "investigator", "architect", "implementer", "verifier", "reviewer", "security-reviewer"]) {
    const content = files.get(`.agents/plugins/all-about-agents/agents/${role}.md`);
    const frontmatter = content.split("---\n")[1];
    assert.ok(frontmatter, role);
    for (const line of frontmatter.trim().split("\n")) {
      const key = line.match(/^([A-Za-z][A-Za-z0-9]*):/u)?.[1];
      assert.ok(key && fields.has(key), `${role} has undocumented frontmatter field ${line}`);
    }
    assert.match(frontmatter, /^name: /mu);
    assert.match(frontmatter, /^description: /mu);
    assert.match(frontmatter, /^model: inherit$/mu);
    assert.doesNotMatch(frontmatter, /(?:disallowedTools|permissionMode|modelKey|settings)/iu);
  }
});

test("Desktop model output is a manual Medium selection with an explicit unsupported High diagnostic", () => {
  const result = resultFor();
  const model = result.registrations.find((entry) => entry.kind === "manual-model-selection");
  assert.deepEqual(model, {
    kind: "manual-model-selection",
    surface: "antigravity-2-desktop",
    model: "Gemini 3.7 Flash Medium",
    status: "verified",
    persistence: "conversation-local",
    applyVia: "Desktop model selector"
  });
  const unsupported = result.registrations.find((entry) => entry.kind === "unsupported-diagnostic" && entry.claim === "Gemini 3.7 Flash High");
  assert.deepEqual(unsupported, {
    kind: "unsupported-diagnostic",
    surface: "antigravity-2-desktop",
    claim: "Gemini 3.7 Flash High",
    status: "unsupported",
    source: "research-antigravity-2.md",
    manual_step: "Open the Desktop model selector and choose the currently offered Gemini 3.7 Flash Medium; do not enter a model key or persist the choice outside the conversation."
  });
  const modelRule = fileMap(result).get(".agents/plugins/all-about-agents/rules/model-selection.md");
  assert.match(modelRule, /Gemini 3\.7 Flash Medium/u);
  assert.match(modelRule, /Gemini 3\.7 Flash High/u);
  assert.doesNotMatch(modelRule, /gemini-3\.7-flash-high/u);
  assert.doesNotMatch(JSON.stringify(result), /modelKey|persistenceKey|settings\.json|--effort|--model/iu);
});

test("Desktop full-access profile is a manual Unrestricted UI preset with documented emergency denies", () => {
  const portable = resultFor("portable");
  const template = resultFor("template");
  const portablePermission = portable.registrations.find((entry) => entry.kind === "permission-ui");
  const templatePermission = template.registrations.find((entry) => entry.kind === "permission-ui");
  assert.equal(portablePermission.preset, "Default");
  assert.equal(templatePermission.preset, "Unrestricted");
  assert.equal(templatePermission.manualOnly, true);
  assert.ok(templatePermission.deny.includes("command(rm -rf)"));
  assert.ok(templatePermission.deny.includes("command(sudo)"));
  const rule = fileMap(template).get(".agents/plugins/all-about-agents/rules/permission-safety.md");
  assert.match(rule, /Deny > Ask > Allow/u);
  assert.match(rule, /decision: deny/u);
  assert.match(rule, /Full machine|Unrestricted/u);
});

test("Desktop hooks are inert documented contracts and never auto-execute a command", () => {
  const hooks = JSON.parse(fileMap(resultFor()).get(".agents/plugins/all-about-agents/hooks.json"));
  const hook = hooks["all-about-agents-safety"];
  assert.equal(hook.enabled, false);
  for (const event of ["PreToolUse", "PostToolUse", "PreInvocation", "PostInvocation", "Stop"]) {
    assert.deepEqual(hook[event], []);
  }
  assert.equal(JSON.stringify(hooks).includes("command"), false);
  assert.equal(resultFor().files.some((file) => /(?:hooks|\.mjs|\.ps1|\.sh)/u.test(file.relativePath) && file.relativePath.endsWith(".json") === false), false);
});

test("Desktop manifest documents workspace/global discovery and no serialized settings or CLI registration", async () => {
  const manifest = JSON.parse(await readFile(resolve(process.cwd(), "installers/manifests/antigravity-2.json"), "utf8"));
  assert.equal(manifest.surface, "antigravity-2");
  assert.equal(manifest.pluginManifest, ".agents/plugins/all-about-agents/plugin.json");
  assert.equal(manifest.discovery.workspace, ".agents/plugins/<plugin>/");
  assert.equal(manifest.discovery.global, "~/.gemini/config/plugins/<plugin>/");
  assert.equal(manifest.components.hooks, ".agents/plugins/<plugin>/hooks.json");
  assert.equal(manifest.components.agents, ".agents/plugins/<plugin>/agents/{role}.md");
  assert.equal(manifest.nativeValidation.status, "not run");
  assert.equal(Object.hasOwn(manifest, "settings"), false);
  assert.equal(JSON.stringify(manifest).includes("gemini-3.7-flash-high"), false);
  assert.equal(JSON.stringify(manifest).includes("--effort"), false);
  const plugin = JSON.parse(fileMap(resultFor()).get(".agents/plugins/all-about-agents/plugin.json"));
  assert.deepEqual(plugin, { name: "all-about-agents" });
});

test("Desktop capability evidence records the current Medium/manual policy and unsupported Flash tier", async () => {
  const evidence = JSON.parse(await readFile(resolve(process.cwd(), "adapters/antigravity-2/capabilities.json"), "utf8"));
  assert.equal(evidence.checkedAt, "2026-08-29");
  assert.equal(evidence.productVersion, "unknown");
  const model = evidence.capabilities.find((entry) => entry.feature === "model.desktop");
  assert.ok(model);
  assert.equal(model.source, "research-antigravity-2.md");
  assert.equal(model.support, "manual");
  assert.deepEqual(model.value, {
    displayName: "Gemini 3.7 Flash Medium",
    selection: "manual",
    persistence: "conversation-local",
    applyVia: "Desktop model selector"
  });
  const effort = evidence.capabilities.find((entry) => entry.feature === "effort.desktop");
  assert.ok(effort);
  assert.equal(effort.source, "research-antigravity-2.md");
  assert.equal(effort.support, "unsupported");
  assert.equal(effort.stability, "unsupported");
  assert.equal(effort.value, null);
  assert.match(effort.notes, /Gemini 3\.7 Flash High.*unsupported/u);
  assert.equal(Object.hasOwn(model.value, "thinkingLevel"), false);
  assert.equal(Object.hasOwn(effort.value || {}, "effort"), false);
  const persistence = evidence.capabilities.find((entry) => entry.feature === "desktop.model-persistence");
  assert.ok(persistence);
  assert.equal(persistence.source, "research-antigravity-2.md");
  assert.equal(persistence.support, "unknown");
  assert.equal(persistence.stability, "unknown");
  assert.deepEqual(persistence.value, { nativeConfigKey: null, persistence: "unknown" });
  const desktopPolicy = evidence.capabilities.filter((entry) => entry.feature.endsWith(".desktop") || entry.feature === "desktop.model-persistence");
  for (const entry of desktopPolicy) {
    assert.notEqual(entry.value, "High");
    assert.notEqual(entry.value?.thinkingLevel, "High");
    assert.notEqual(entry.value?.effort, "High");
  }
  const currentPolicy = JSON.stringify(desktopPolicy);
  assert.doesNotMatch(currentPolicy, /gemini-3\.7-flash-high/iu);
  assert.doesNotMatch(currentPolicy, /["']high["']/u);
});

test("Antigravity adapter satisfies the shared action contract and rejects incomplete mappings", () => {
  const result = adapter.renderSurface({ core, profile: { id: "portable" }, statuslineName: "" });
  assert.ok(result.files.length > 0);
  assert.ok(result.registrations.some((entry) => entry.kind === "plugin-registration"));
  assert.throws(
    () => adapter.renderSurface({ core, profile: { id: "portable" }, statuslineName: "", capabilityRecord: { actionMappings: {} } }),
    (error) => error instanceof AdapterContractError && error.errors.some((entry) => entry.code === "missing-native-mapping")
  );
});

test("Desktop render is deterministic and matches both checked-in snapshots", async () => {
  for (const profile of ["portable", "template"]) {
    const first = resultFor(profile);
    const second = resultFor(profile);
    assert.deepEqual(first.files.map((file) => ({ ...file, content: [...file.content] })), second.files.map((file) => ({ ...file, content: [...file.content] })));
    assert.deepEqual(first.registrations, second.registrations);
    assert.deepEqual(first.diagnostics, second.diagnostics);
    assert.deepEqual(first.ownership, second.ownership);
    const snapshot = JSON.parse(await readFile(resolve(process.cwd(), `tests/snapshots/antigravity-2/${profile}.json`), "utf8"));
    assert.deepEqual(snapshot.paths, first.files.map((file) => file.relativePath));
    assert.equal(snapshot.fileCount, first.files.length);
    assert.deepEqual(snapshot.model, first.registrations.find((entry) => entry.kind === "manual-model-selection"));
    assert.deepEqual(snapshot.permission, first.registrations.find((entry) => entry.kind === "permission-ui"));
    assert.deepEqual(snapshot.diagnostics, first.registrations.filter((entry) => entry.kind === "unsupported-diagnostic"));
  }
});
