import assert from "node:assert/strict";
import { access, lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { loadCore } from "../../installers/lib/load-core.mjs";
import { AdapterContractError } from "../../adapters/shared/adapter-contract.mjs";

const adapter = await import("../../adapters/codex/adapter.mjs");
const core = await loadCore(process.cwd());

function fileMap(result) {
  return new Map(result.files.map((file) => [file.relativePath, new TextDecoder().decode(file.content)]));
}

function snapshotProjection(result) {
  const files = fileMap(result);
  return {
    fileCount: result.files.length,
    paths: result.files.map((file) => file.relativePath),
    content: Object.fromEntries([".codex-plugin/plugin.json", ".codex/agents/investigator.toml", "config.toml", "docs/manual-desktop.md"].map((path) => [path, files.get(path)])),
    registration: result.registrations.find((entry) => entry.kind === "resolved-config-root")
  };
}

function resultFor(profileId = "portable", overrides = {}) {
  return adapter.renderCodex({
    core,
    profile: { id: profileId },
    statuslineName: "",
    env: { CODEX_HOME: "C:/disposable/codex-home" },
    platform: "win32",
    homeDir: "C:/Users/tester",
    ...overrides
  });
}

const requiredOutputs = [
  "adapters/codex/adapter.mjs",
  "adapters/codex/templates/",
  "installers/manifests/codex.json",
  "tests/contracts/codex-adapter.test.mjs",
  "tests/snapshots/codex/"
];

test("T009 creates every owned artifact", async () => {
  assert.ok(requiredOutputs.length > 0);
  for (const relativePath of requiredOutputs) {
    await access(resolve(process.cwd(), relativePath));
  }
});

test("Codex resolves CODEX_HOME with an explicit override and platform default", async () => {
  assert.equal(
    adapter.resolveCodexHome({ env: { CODEX_HOME: "C:/disposable/codex config" }, homeDir: "C:/Users/tester", platform: "win32" }),
    "C:/disposable/codex config"
  );
  assert.equal(
    adapter.resolveCodexHome({ env: {}, homeDir: "/Users/tester", platform: "darwin" }),
    "/Users/tester/.codex"
  );
});

test("Codex model policy keeps Sol/max primary and Terra/max explicitly selectable", () => {
  assert.deepEqual(adapter.CODEX_MODEL_POLICY.template, {
    model: "gpt-5.6-sol",
    model_reasoning_effort: "max",
    sandbox_mode: "danger-full-access",
    approval_policy: "never"
  });
  assert.deepEqual(adapter.CODEX_MODEL_POLICY.alternate, {
    model: "gpt-5.6-terra",
    model_reasoning_effort: "max"
  });
  assert.equal(Object.keys(adapter.CODEX_MODEL_POLICY).includes("fallback"), false);
});

test("Codex semantic mappings contain only documented native surfaces", () => {
  assert.deepEqual(adapter.CODEX_SEMANTIC_MAPPINGS["repository-read"], ["AGENTS.md"]);
  assert.deepEqual(adapter.CODEX_SEMANTIC_MAPPINGS["web-primary-sources"], ["web_search"]);
  assert.deepEqual(adapter.CODEX_SEMANTIC_MAPPINGS["role-dispatch"], ["agents"]);
  const serialized = JSON.stringify(adapter.CODEX_SEMANTIC_MAPPINGS);
  for (const forbidden of ["spawn_agent", "invoke_subagent", "view_file", "grep_search", "mcp__"]) {
    assert.equal(serialized.includes(forbidden), false, `mapping contains non-Codex capability ${forbidden}`);
  }
});

test("Codex template emits the exact Sol/max primary and Terra/max alternate policy", () => {
  const files = fileMap(resultFor("template"));
  const primary = files.get("config.toml");
  const alternate = files.get("terra-max.config.toml");
  assert.match(primary, /model = "gpt-5\.6-sol"/u);
  assert.match(primary, /model_reasoning_effort = "max"/u);
  assert.match(primary, /sandbox_mode = "danger-full-access"/u);
  assert.match(primary, /approval_policy = "never"/u);
  assert.match(alternate, /model = "gpt-5\.6-terra"/u);
  assert.match(alternate, /model_reasoning_effort = "max"/u);
  assert.deepEqual(adapter.parseCodexToml(alternate), {
    model: "gpt-5.6-terra",
    model_reasoning_effort: "max"
  });
  assert.deepEqual(Object.keys(adapter.parseCodexToml(alternate)).sort(), ["model", "model_reasoning_effort"]);
  assert.doesNotMatch(`${primary}\n${alternate}`, /fallback(?:_model|Model|_models)?/iu);
});

test("Codex render emits a regular AGENTS.md and every canonical skill without repository schedules", () => {
  const result = resultFor();
  const files = fileMap(result);
  const agents = result.files.find((file) => file.relativePath === "AGENTS.md");
  assert.ok(agents);
  assert.equal(agents.mode, null);
  assert.ok(agents.content instanceof Uint8Array);
  assert.match(files.get("AGENTS.md"), /All About Agents/u);
  assert.doesNotMatch(files.get("AGENTS.md"), /(?:scheduled|automation|cron)/iu);
  for (const skill of core.inventory.skills) assert.ok(files.has(`.agents/skills/${skill}/SKILL.md`), `missing canonical skill ${skill}`);
  assert.equal(result.files.some((file) => /(?:automations|cron)/iu.test(file.relativePath)), false);
  assert.doesNotMatch(JSON.stringify(result.registrations), /(?:automations|cron)/iu);
});

test("Codex preserves supplied skill content and marks missing canonical skills deferred", () => {
  const files = fileMap(resultFor());
  const supplied = files.get(".agents/skills/using-all-about-agents/SKILL.md");
  assert.match(supplied, /^---\nname: using-all-about-agents\n/u);
  assert.equal((supplied.match(/^---$/gmu) ?? []).length, 2);
  const deferred = files.get(".agents/skills/brainstorming/SKILL.md");
  assert.match(deferred, /DEFERRED: canonical source is missing/u);
  assert.match(deferred, /Owner: cycle-05-skill-remediation \(T017-T043\)/u);
  assert.doesNotMatch(deferred, /installed by the All About Agents Codex plugin/u);
  const missing = resultFor().diagnostics.filter((diagnostic) => diagnostic.code === "missing-skill-source");
  assert.equal(missing.length, core.inventory.skills.length - core.skills.length);
  assert.ok(missing.every((diagnostic) => diagnostic.severity === "error"));
  assert.ok(missing.every((diagnostic) => diagnostic.sourcePath === "core/inventory.json"));
});

test("Codex AGENTS.md remains a regular file when checkout symlinks are unavailable", async () => {
  const agents = resultFor().files.find((file) => file.relativePath === "AGENTS.md");
  const root = await mkdtemp(join(tmpdir(), "all-about-agents-codex-"));
  try {
    await writeFile(join(root, "AGENTS.md"), agents.content);
    const stat = await lstat(join(root, "AGENTS.md"));
    assert.equal(stat.isFile(), true);
    assert.equal(stat.isSymbolicLink(), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Codex maps each canonical role to a documented standalone TOML agent", () => {
  const result = resultFor();
  const files = fileMap(result);
  for (const role of ["researcher", "investigator", "architect", "implementer", "verifier", "reviewer", "security-reviewer"]) {
    const content = files.get(`.codex/agents/${role}.toml`);
    assert.ok(content, `missing native agent ${role}`);
    assert.match(content, /^name = /mu);
    assert.match(content, /^description = /mu);
    assert.match(content, /^developer_instructions = /mu);
    assert.doesNotMatch(content, /(?:tools|native|spawn_agent|invoke_subagent|mcp__)/iu);
  }
  assert.ok(result.registrations.some((entry) => entry.kind === "agents" && entry.destination === "agents"));
});

test("Codex package manifest and Desktop guidance use only documented surfaces", async () => {
  const files = fileMap(resultFor());
  assert.ok(files.has(".codex-plugin/plugin.json"));
  const plugin = JSON.parse(files.get(".codex-plugin/plugin.json"));
  assert.deepEqual(plugin, {
    description: "Portable all-about-agents skills for Codex CLI and Desktop.",
    name: "all-about-agents",
    skills: "./.agents/skills",
    version: "1.0.0"
  });
  const manual = files.get("docs/manual-desktop.md");
  assert.match(manual, /gpt-5\.6-terra/u);
  assert.match(manual, /max/u);
  assert.match(manual, /Desktop model controls/u);
  assert.doesNotMatch(manual, /(?:--profile|config\.toml)/u);
  const manifest = JSON.parse(await readFile(resolve(process.cwd(), "installers/manifests/codex.json"), "utf8"));
  assert.equal(manifest.surface, "codex");
  assert.equal(manifest.pluginManifest, ".codex-plugin/plugin.json");
  assert.equal(manifest.configRoot.environment, "CODEX_HOME");
  assert.equal(manifest.configRoot.fallback, "~/.codex");
  assert.equal(manifest.components.instructions, "AGENTS.md");
  assert.equal(manifest.components.agents, ".codex/agents/{role}.toml");
  assert.equal(manifest.components.skills, ".agents/skills/{skill}/SKILL.md");
  assert.equal(manifest.components.primaryConfig, "config.toml");
  assert.equal(manifest.components.alternateConfig, "terra-max.config.toml");
  assert.equal(manifest.components.manualDesktop, "docs/manual-desktop.md");
  assert.deepEqual(manifest.nativeValidation, {
    command: ["codex", "doctor", "--json", "--no-color"],
    requiredWhenAvailable: true
  });
});

test("Codex adapter satisfies the shared renderSurface action contract", () => {
  const result = adapter.renderSurface({
    core,
    profile: { id: "portable" },
    statuslineName: "",
    env: { CODEX_HOME: "C:/disposable/codex-home" },
    platform: "win32",
    homeDir: "C:/Users/tester"
  });
  assert.ok(result.files.length > 0);
  assert.ok(result.registrations.some((entry) => entry.kind === "instructions"));
  assert.equal(result.diagnostics.filter((diagnostic) => diagnostic.code === "missing-skill-source").length, core.inventory.skills.length - core.skills.length);
});

test("Codex adapter rejects an incomplete native action mapping", () => {
  assert.throws(
    () => adapter.renderSurface({
      core,
      profile: { id: "portable" },
      statuslineName: "",
      capabilityRecord: { actionMappings: {} }
    }),
    (error) => error instanceof AdapterContractError && error.errors.some((entry) => entry.code === "missing-native-mapping")
  );
});

test("Codex render is deterministic and matches the checked-in portable snapshot", async () => {
  const first = resultFor();
  const second = resultFor();
  assert.deepEqual(first.files.map((file) => ({ ...file, content: [...file.content] })), second.files.map((file) => ({ ...file, content: [...file.content] })));
  assert.deepEqual(first.registrations, second.registrations);
  assert.deepEqual(first.ownership, second.ownership);
  const snapshot = JSON.parse(await readFile(resolve(process.cwd(), "tests/snapshots/codex/portable.json"), "utf8"));
  assert.deepEqual(snapshot, snapshotProjection(first));
});

test("Codex template render is deterministic and matches the checked-in Terra alternate snapshot", async () => {
  const first = resultFor("template");
  const second = resultFor("template");
  assert.deepEqual(first.files.map((file) => ({ ...file, content: [...file.content] })), second.files.map((file) => ({ ...file, content: [...file.content] })));
  const snapshot = JSON.parse(await readFile(resolve(process.cwd(), "tests/snapshots/codex/template.json"), "utf8"));
  assert.deepEqual(snapshot, snapshotProjection(first));
});
