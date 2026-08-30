import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, posix, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { promisify } from "node:util";

import { loadCore } from "../../installers/lib/load-core.mjs";
import { AdapterContractError } from "../../adapters/shared/adapter-contract.mjs";

const adapter = await import("../../adapters/codex/adapter.mjs");
const core = await loadCore(process.cwd());
const execFileAsync = promisify(execFile);

function fileMap(result) {
  return new Map(result.files.map((file) => [file.relativePath, new TextDecoder().decode(file.content)]));
}

function snapshotProjection(result) {
  return {
    fileCount: result.files.length,
    files: result.files.map((file) => ({
      relativePath: file.relativePath,
      sha256: createHash("sha256").update(file.content).digest("hex"),
      mode: file.mode
    })),
    ownership: result.ownership,
    registrations: result.registrations,
    diagnostics: result.diagnostics
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
  assert.equal(
    adapter.resolveCodexHome({ env: {}, homeDir: "C:\\Users\\tester", platform: "win32" }),
    "C:\\Users\\tester\\.codex"
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
  const alternateConfig = adapter.parseCodexToml(alternate);
  assert.deepEqual({ model: alternateConfig.model, model_reasoning_effort: alternateConfig.model_reasoning_effort }, {
    model: "gpt-5.6-terra",
    model_reasoning_effort: "max"
  });
  assert.deepEqual(Object.keys(alternateConfig).sort(), ["agents", "model", "model_reasoning_effort"]);
  assert.equal(Object.hasOwn(alternateConfig, "approval_policy"), false);
  assert.equal(Object.hasOwn(alternateConfig, "sandbox_mode"), false);
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

test("Codex preserves supplied skill content and marks the next missing canonical skill deferred", () => {
  const files = fileMap(resultFor());
  const supplied = files.get(".agents/skills/using-all-about-agents/SKILL.md");
  assert.match(supplied, /^---\nname: using-all-about-agents\n/u);
  assert.equal((supplied.match(/^---$/gmu) ?? []).length, 2);
  const deferred = files.get(".agents/skills/zero-downtime-migrations/SKILL.md");
  assert.match(deferred, /DEFERRED: canonical source is missing/u);
  assert.match(deferred, /Owner: cycle-05-skill-remediation \(T017-T043\)/u);
  assert.doesNotMatch(deferred, /installed by the All About Agents Codex plugin/u);
  const missing = resultFor().diagnostics.filter((diagnostic) => diagnostic.code === "missing-skill-source");
  assert.equal(missing.length, core.inventory.skills.length - core.skills.length);
  assert.ok(missing.every((diagnostic) => diagnostic.severity === "error"));
  assert.ok(missing.every((diagnostic) => diagnostic.sourcePath === "core/inventory.json"));
});

test("Codex reports absent and whitespace canonical skill sources separately", () => {
  const absent = resultFor();
  assert.ok(absent.diagnostics.some((diagnostic) => /zero-downtime-migrations/u.test(diagnostic.message) && /no source record/u.test(diagnostic.message)));
  const whitespaceCore = {
    ...core,
    skills: [...core.skills, { id: "zero-downtime-migrations", description: "Whitespace source", content: " \r\n\t " }]
  };
  const whitespace = resultFor("portable", { core: whitespaceCore });
  const diagnostics = whitespace.diagnostics.filter((diagnostic) => /zero-downtime-migrations/u.test(diagnostic.message));
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "missing-skill-source");
  assert.match(diagnostics[0].message, /no usable source content/u);
  assert.match(fileMap(whitespace).get(".agents/skills/zero-downtime-migrations/SKILL.md"), /DEFERRED: canonical source is missing/u);
});

test("Codex bootstrap skill links to a resolvable factual capability guide", () => {
  const files = fileMap(resultFor());
  const skillPath = ".agents/skills/using-all-about-agents/SKILL.md";
  const guidancePath = ".agents/skills/using-all-about-agents/references/adapter-capability-guidance.md";
  const skill = files.get(skillPath);
  const link = skill.match(/\[Codex adapter capability guidance\]\(([^)]+)\)/u)?.[1];
  assert.ok(link);
  assert.equal(posix.normalize(posix.join(posix.dirname(skillPath), link)), guidancePath);
  const guidance = files.get(guidancePath);
  assert.ok(guidance);
  assert.match(guidance, /CODEX_HOME/u);
  assert.match(guidance, /AGENTS\.md/u);
  assert.match(guidance, /standalone custom-agent TOML/u);
  assert.match(guidance, /Desktop.*manual/u);
  assert.doesNotMatch(guidance, /Claude|spawn_agent|mcp__/iu);
});

test("Codex AGENTS.md maps every canonical action to its workflow and description", () => {
  const agents = fileMap(resultFor()).get("AGENTS.md");
  for (const command of core.commands) {
    assert.match(agents, new RegExp(`- action: ${command.actionId}\\n- workflowId: ${command.workflowId}\\n- description: ${command.presentation.help}`, "u"));
  }
});

test("Codex rejects malformed canonical command presentation metadata", () => {
  const malformedCases = [
    {
      name: "missing presentation",
      field: "presentation",
      message: "presentation hints are required",
      mutate: ({ presentation: _presentation, ...command }) => command
    },
    {
      name: "missing presentation.label",
      field: "presentation.label",
      message: "presentation.label must be a non-empty string",
      mutate: ({ presentation, ...command }) => ({ ...command, presentation: { help: presentation.help } })
    },
    {
      name: "missing presentation.help",
      field: "presentation.help",
      message: "presentation.help must be a non-empty string",
      mutate: ({ presentation, ...command }) => ({ ...command, presentation: { label: presentation.label } })
    },
    {
      name: "empty label",
      field: "presentation.label",
      message: "presentation.label must be a non-empty string",
      mutate: (command) => ({ ...command, presentation: { ...command.presentation, label: "" } })
    },
    {
      name: "empty help",
      field: "presentation.help",
      message: "presentation.help must be a non-empty string",
      mutate: (command) => ({ ...command, presentation: { ...command.presentation, help: "" } })
    },
    {
      name: "whitespace label",
      field: "presentation.label",
      message: "presentation.label must be a non-empty string",
      mutate: (command) => ({ ...command, presentation: { ...command.presentation, label: String.fromCharCode(32, 9, 13, 10, 32) } })
    },
    {
      name: "whitespace help",
      field: "presentation.help",
      message: "presentation.help must be a non-empty string",
      mutate: (command) => ({ ...command, presentation: { ...command.presentation, help: String.fromCharCode(32, 9, 13, 10, 32) } })
    },
    {
      name: "non-string label",
      field: "presentation.label",
      message: "presentation.label must be a non-empty string",
      mutate: (command) => ({ ...command, presentation: { ...command.presentation, label: false } })
    },
    {
      name: "non-string help",
      field: "presentation.help",
      message: "presentation.help must be a non-empty string",
      mutate: (command) => ({ ...command, presentation: { ...command.presentation, help: 42 } })
    }
  ];

  for (const { name, field, message, mutate } of malformedCases) {
    const malformedCore = {
      ...core,
      commands: core.commands.map((command, index) => index === 0 ? mutate(command) : command)
    };
    let thrown;
    try {
      resultFor("portable", { core: malformedCore });
    } catch (error) {
      thrown = error;
    }
    assert.ok(thrown, name);
    assert.ok(thrown instanceof AdapterContractError, name);
    assert.ok(thrown.errors.some((entry) => entry.path === `/commands/0/${field.replace(".", "/")}` && entry.message === message), name);
  }
});

test("Codex rejects a canonical command set with a missing action mapping", () => {
  const incompleteCore = { ...core, commands: core.commands.slice(1) };
  assert.throws(
    () => resultFor("portable", { core: incompleteCore }),
    /missing canonical action|missing native action mapping|invalid command/iu
  );
});

test("Codex AGENTS.md remains a regular file in a Windows checkout with core.symlinks=false", async (t) => {
  const agents = resultFor().files.find((file) => file.relativePath === "AGENTS.md");
  const root = await mkdtemp(join(tmpdir(), "all-about-agents-codex-"));
  try {
    try {
      await execFileAsync("git", ["init", "--quiet"], { cwd: root });
      await execFileAsync("git", ["config", "core.symlinks", "false"], { cwd: root });
    } catch (error) {
      if (error?.code === "ENOENT") {
        t.skip("Git executable unavailable");
        return;
      }
      throw error;
    }
    const { stdout } = await execFileAsync("git", ["config", "--get", "core.symlinks"], { cwd: root });
    assert.equal(stdout.trim(), "false");
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
    assert.doesNotMatch(content, /(?:^|\n)\s*(?:tools|nativeTool|spawn_agent|invoke_subagent|mcp__)\b/imu);
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
  assert.equal(Object.hasOwn(manifest.components, "roleConfigs"), false);
  assert.equal(manifest.components.skills, ".agents/skills/{skill}/SKILL.md");
  assert.equal(manifest.components.primaryConfig, "config.toml");
  assert.equal(manifest.components.alternateConfig, "terra-max.config.toml");
  assert.equal(manifest.components.manualDesktop, "docs/manual-desktop.md");
  assert.equal(manifest.ownedPaths.includes(".codex/agents/{role}.config.toml"), false);
  assert.deepEqual(manifest.nativeValidation, {
    command: ["codex", "doctor", "--json", "--no-color"],
    requiredWhenAvailable: true
  });
});

test("Codex plugin hooks invoke the rendered runtime and require trust plus Node preflight", async () => {
  const result = resultFor();
  const files = fileMap(result);
  const hooks = JSON.parse(files.get("hooks/hooks.json"));
  const startup = hooks.hooks.SessionStart[0];
  assert.equal(startup.matcher, "^startup$");
  assert.equal(startup.hooks[0].type, "command");
  assert.match(startup.hooks[0].command, /\$PLUGIN_ROOT\/hooks\/bootstrap\.mjs/u);
  assert.match(startup.hooks[0].commandWindows, /%PLUGIN_ROOT%\/hooks\/bootstrap\.mjs/u);
  assert.equal(files.get("hooks/bootstrap.mjs"), await readFile(resolve(process.cwd(), "core/hooks/bootstrap.mjs"), "utf8"));
  assert.equal(files.get("hooks/bootstrap.json"), await readFile(resolve(process.cwd(), "core/hooks/bootstrap.json"), "utf8"));
  const hookRegistration = result.registrations.find((entry) => entry.kind === "hook-contract");
  assert.equal(hookRegistration.trustRequired, true);
  assert.equal(hookRegistration.desktopManualOnly, true);
  assert.ok(result.registrations.some((entry) => entry.kind === "runtime-prerequisite" && entry.onMissing === "unavailable"));
});

test("Codex emergency guard uses documented CLI command forms and canonical policy", async () => {
  const result = resultFor();
  const files = fileMap(result);
  const hooks = JSON.parse(files.get("hooks/hooks.json")).hooks;
  const guard = hooks.PreToolUse[0].hooks[0];
  assert.ok(guard.command.includes('"$PLUGIN_ROOT/hooks/emergency-guard.mjs" --surface codex'));
  assert.ok(guard.command.includes('--policy-path "$PLUGIN_ROOT/hooks/emergency-guard.json"'));
  assert.ok(guard.commandWindows.includes('"%PLUGIN_ROOT%/hooks/emergency-guard.mjs" --surface codex'));
  assert.equal(files.get("hooks/emergency-guard.mjs"), await readFile(resolve(process.cwd(), "core/hooks/emergency-guard.mjs"), "utf8"));
  assert.equal(files.get("hooks/emergency-policy.mjs"), await readFile(resolve(process.cwd(), "installers/lib/emergency-policy.mjs"), "utf8"));
  assert.deepEqual(JSON.parse(files.get("hooks/emergency-guard.json")).orderedRuleIds, [
    "filesystem-root-erasure", "raw-disk-destruction", "git-force-push", "git-history-rewrite",
    "git-discard-uncommitted", "secret-credential-access", "secret-output-or-transmission", "guardrail-bypass"
  ]);
});

test("Codex target runtime keeps CLI guard automatic but makes Desktop probe-only without runtime copies", () => {
  const cli = resultFor("portable", { targetRuntime: "cli" });
  const cliFiles = fileMap(cli);
  const cliHooks = JSON.parse(cliFiles.get("hooks/hooks.json")).hooks;
  assert.ok(cliHooks.PreToolUse?.[0]?.hooks?.[0]?.command);
  assert.ok(cliFiles.has("hooks/emergency-guard.mjs"));
  assert.ok(cliFiles.has("hooks/emergency-policy.mjs"));
  assert.ok(cliFiles.has("hooks/emergency-guard.json"));
  assert.ok(cli.registrations.some((entry) => entry.kind === "emergency-guard" && entry.targetRuntime === "cli" && entry.automatic === true));

  const desktop = resultFor("portable", { targetRuntime: "desktop" });
  const desktopFiles = fileMap(desktop);
  const desktopHooks = JSON.parse(desktopFiles.get("hooks/hooks.json")).hooks;
  assert.equal(desktopHooks.PreToolUse, undefined);
  assert.equal(desktopFiles.has("hooks/emergency-guard.mjs"), false);
  assert.equal(desktopFiles.has("hooks/emergency-policy.mjs"), false);
  assert.equal(desktopFiles.has("hooks/emergency-guard.json"), false);
  const desktopRegistration = desktop.registrations.find((entry) => entry.kind === "emergency-guard");
  assert.deepEqual({ targetRuntime: desktopRegistration.targetRuntime, automatic: desktopRegistration.automatic, probeRequired: desktopRegistration.probeRequired, status: desktopRegistration.status }, { targetRuntime: "desktop", automatic: false, probeRequired: true, status: "not run" });
  assert.ok(desktop.diagnostics.some((entry) => entry.code === "codex-desktop-emergency-guard-probe-required"));
  const desktopAgain = resultFor("portable", { targetRuntime: "desktop" });
  const fileProjection = (result) => result.files.map((file) => ({ relativePath: file.relativePath, mode: file.mode, content: [...file.content] }));
  assert.deepEqual(fileProjection(desktop), fileProjection(desktopAgain));
  assert.deepEqual(desktop.registrations, desktopAgain.registrations);
  assert.deepEqual(desktop.diagnostics, desktopAgain.diagnostics);
  assert.throws(() => resultFor("portable", { targetRuntime: "unknown" }), /targetRuntime/u);
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
