import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { loadCore } from "../../installers/lib/load-core.mjs";
import {
  CLAUDE_PREREQUISITES,
  CLAUDE_MODEL_POLICY,
  CLAUDE_SEMANTIC_MAPPINGS,
  renderClaudeStatuslineCommand,
  renderSurface,
  renderClaude,
  resolveClaudeConfigDir
} from "../../adapters/claude/adapter.mjs";
import { AdapterContractError } from "../../adapters/shared/adapter-contract.mjs";
import { renderClaudeGlobalInstructions, renderCodexGlobalInstructions, renderGeminiGlobalInstructions, renderSharedGlobalInstructions } from "../../adapters/shared/global-instructions.mjs";

const requiredOutputs = [
  "adapters/claude/adapter.mjs",
  "adapters/claude/templates/",
  "installers/manifests/claude.json",
  "tests/contracts/claude-adapter.test.mjs",
  "tests/snapshots/claude/"
];

test("T008 creates every owned artifact", async () => {
  assert.ok(requiredOutputs.length > 0);
  for (const relativePath of requiredOutputs) {
    await access(resolve(process.cwd(), relativePath));
  }
});

test("Claude template documentation matches the deferred current core output", async () => {
  const readme = await readFile(resolve(process.cwd(), "adapters/claude/templates/README.md"), "utf8");
  assert.match(readme, /structural Claude plugin fixture/u);
  assert.match(readme, /explicit deferred files/u);
  assert.doesNotMatch(readme, /renders a complete Claude plugin package/u);
});

const core = await loadCore(process.cwd());

function codexBody() {
  return renderCodexGlobalInstructions(core, { canonicalRules: core.rules.slice(0, 1), commands: core.commands.slice(0, 1) });
}

test("shared global renderers use the loaded canonical body and normalize only line endings", () => {
  assert.equal(renderSharedGlobalInstructions(core), core.globalInstructions.content);
  assert.equal(renderGeminiGlobalInstructions(core), core.globalInstructions.content);
  const codex = codexBody();
  assert.match(codex, /^# Global Operating Rules/mu);
  assert.match(codex, /## Canonical repository rules/u);
  assert.match(codex, /## Canonical actions/u);
  assert.equal((codex.match(/# Global Operating Rules/g) || []).length, 1);
});

test("egroup house rules reach Claude Code only while RTK house rules reach every surface", () => {
  const claude = renderClaudeGlobalInstructions(core);
  const gemini = renderGeminiGlobalInstructions(core);
  const codex = codexBody();
  assert.match(claude, /^## egroup house rules \(coding-guidelines\)$/mu);
  assert.match(claude, /^@~\/Workspaces\/coding-guidelines\/Rules\/RULES\.md$/mu);
  for (const rendered of [gemini, codex]) assert.doesNotMatch(rendered, /egroup house rules/u);
  for (const rendered of [claude, gemini, codex]) assert.match(rendered, /^## RTK house rules \(rust-token-killer\)$/mu);
  assert.ok(claude.startsWith(renderSharedGlobalInstructions(core).trimEnd()));
});

function resultFor(profileId = "portable", overrides = {}) {
  return renderClaude({
    core,
    profile: { id: profileId },
    statuslineName: "ทีม Claude",
    env: { CLAUDE_CONFIG_DIR: "C:/disposable/claude-config" },
    platform: "win32",
    homeDir: "C:/Users/tester",
    ...overrides
  });
}

function fileMap(result) {
  return new Map(result.files.map((file) => [file.relativePath, new TextDecoder().decode(file.content)]));
}

test("Claude model policy uses exact documented template fields", () => {
  assert.deepEqual(CLAUDE_MODEL_POLICY.template, {
    model: "claude-opus-5",
    fallbackModel: ["claude-sonnet-5"],
    advisorModel: "claude-fable-5-1",
    env: { CLAUDE_CODE_EFFORT_LEVEL: "xhigh" }
  });
  assert.equal(Object.hasOwn(CLAUDE_MODEL_POLICY.template, "effortLevel"), false);
  assert.equal(CLAUDE_MODEL_POLICY.template.fallbackModel.includes("claude-fable-5"), false);
});

test("Claude config root honors CLAUDE_CONFIG_DIR for CLI and Desktop shared settings", () => {
  assert.equal(
    resolveClaudeConfigDir({ env: { CLAUDE_CONFIG_DIR: "C:/disposable/claude config" }, homeDir: "C:/Users/tester", platform: "win32" }),
    "C:/disposable/claude config"
  );
  assert.equal(
    resolveClaudeConfigDir({ env: {}, homeDir: "/Users/tester", platform: "darwin" }),
    "/Users/tester/.claude"
  );
});

test("Claude semantic mappings use documented Claude tools only", () => {
  assert.deepEqual(CLAUDE_SEMANTIC_MAPPINGS["repository-read"], ["Read", "Glob", "Grep"]);
  assert.deepEqual(CLAUDE_SEMANTIC_MAPPINGS["web-primary-sources"], ["WebSearch", "WebFetch"]);
  const serialized = JSON.stringify(CLAUDE_SEMANTIC_MAPPINGS);
  for (const forbidden of ["spawn_agent", "invoke_subagent", "view_file", "grep_search", "mcp__"]) {
    assert.equal(serialized.includes(forbidden), false, `mapping contains non-Claude tool ${forbidden}`);
  }
});

test("portable Claude render contains every native component and all canonical skills", () => {
  const result = resultFor();
  const files = fileMap(result);
  const missingSkillDiagnostics = result.diagnostics.filter((diagnostic) => diagnostic.code === "missing-skill-source");
  assert.equal(missingSkillDiagnostics.length, core.inventory.skills.length - core.skills.length);
  assert.ok(missingSkillDiagnostics.every((diagnostic) => diagnostic.message.includes("owner: cycle-05-skill-remediation")));
  assert.ok(files.has(".claude-plugin/plugin.json"));
  assert.ok(files.has("config/settings.json"));
  assert.ok(files.has("rules/authority-and-scope.md"));
  assert.ok(files.has("hooks/hooks.json"));
  assert.ok(files.has("statusline/statusline.mjs"));
  assert.ok(files.has("commands/design.md"));
  for (const role of ["researcher", "investigator", "architect", "implementer", "verifier", "reviewer", "security-reviewer"]) {
    assert.ok(files.has(`agents/${role}.md`), `missing native agent ${role}`);
  }
  for (const skill of core.inventory.skills) {
    assert.ok(files.has(`skills/${skill}/SKILL.md`), `missing canonical skill ${skill}`);
    for (const companion of core.skills.find((record) => record.id === skill).companions) assert.ok(files.has(`skills/${skill}/${companion.relativePath}`), `missing companion ${skill}/${companion.relativePath}`);
  }
  assert.ok(files.has("CLAUDE.md"));
  assert.equal(files.has(".claude/CLAUDE.md"), false);
  assert.equal(files.has("AGENTS.md"), false);
});

test("Claude render emits the canonical global file and one presentation contract per visible prompt", () => {
  const result = resultFor();
  const files = fileMap(result);
  assert.equal(files.get("CLAUDE.md"), renderClaudeGlobalInstructions(core));
  assert.equal(files.get("CLAUDE.md").endsWith("\n"), true);
  const presentationRule = files.get("rules/presentation.md");
  assert.match(presentationRule, /brainstorming 🧠/u);
  assert.match(presentationRule, /architect 🏛️/u);
  assert.match(presentationRule, /aaa:build 🏗️/u);
  assert.match(presentationRule, /implement-change 🛠️/u);
  assert.equal((presentationRule.match(/brainstorming 🧠/gu) || []).length, 1);

  const skill = files.get("skills/brainstorming/SKILL.md");
  assert.match(skill, /Using skill \*\*brainstorming 🧠\*\*/u);
  assert.match(skill, /Checklist/u);
  assert.match(skill, /task-specific reason/u);

  const agent = files.get("agents/architect.md");
  assert.match(agent, /^name: architect$/mu);
  assert.match(agent, /Invoking agent \*\*architect 🏛️\*\*/u);
  assert.match(agent, /Checklist/u);

  const command = files.get("commands/build.md");
  assert.match(command, /aaa:build 🏗️/u);
  assert.match(command, /implement-change 🛠️/u);
  assert.equal((command.match(/^Checklist$/gmu) || []).length, 1);
});

test("Claude plugin relies on conventional hook discovery without duplicate manifest registration", () => {
  const files = fileMap(resultFor());
  const manifest = JSON.parse(files.get(".claude-plugin/plugin.json"));
  assert.equal(Object.hasOwn(manifest, "hooks"), false);
  assert.ok(files.has("hooks/hooks.json"));
  const hooks = JSON.parse(files.get("hooks/hooks.json")).hooks;
  assert.ok(hooks.SessionStart?.[0]?.hooks?.length > 0);
});

test("template Claude render emits full-access settings without unsupported effortLevel", () => {
  const files = fileMap(resultFor("template"));
  const settings = JSON.parse(files.get("config/settings.json"));
  assert.equal(settings.model, "claude-opus-5");
  assert.deepEqual(settings.fallbackModel, ["claude-sonnet-5"]);
  assert.equal(settings.advisorModel, "claude-fable-5-1");
  assert.equal(settings.env.CLAUDE_CODE_EFFORT_LEVEL, "xhigh");
  assert.equal(Object.hasOwn(settings, "effortLevel"), false);
  assert.equal(settings.fallbackModel.includes("claude-fable-5"), false);
  assert.equal(settings.permissions.defaultMode, "bypassPermissions");
  assert.ok(settings.permissions.deny.length > 0);
});

test("Claude settings deploy the focus view and auto-memory session defaults for both profiles", () => {
  for (const profile of ["portable", "template"]) {
    const settings = JSON.parse(fileMap(resultFor(profile)).get("config/settings.json"));
    assert.equal(settings.viewMode, "focus");
    assert.equal(settings.autoMemoryEnabled, true);
    assert.equal(settings.autoDreamEnabled, true);
    // autoMemoryDirectory stays unset so each project keeps its own
    // ~/.claude/projects/<sanitized-cwd>/memory/ store.
    assert.equal(Object.hasOwn(settings, "autoMemoryDirectory"), false);
  }
});

test("Claude native settings activate the statusline for both profiles and platforms", () => {
  for (const profile of ["portable", "template"]) {
    const windows = resultFor(profile, {
      platform: "win32",
      env: { CLAUDE_CONFIG_DIR: "C:/disposable/Claude Config/native" },
      homeDir: "C:/Users/tester"
    });
    const winSettings = JSON.parse(fileMap(windows).get("config/settings.json"));
    assert.equal(winSettings.statusLine.type, "command");
    assert.equal(winSettings.statusLine.padding, 0);
    assert.match(winSettings.statusLine.command, /^powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand [A-Za-z0-9+/=]+$/u);
    const decodedWindowsCommand = decodeWindowsStatuslineCommand(winSettings.statusLine.command);
    assert.match(decodedWindowsCommand, /statusline[.]ps1/u);
    assert.match(decodedWindowsCommand, /Claude Config/u);

    const mac = resultFor(profile, {
      platform: "darwin",
      env: { CLAUDE_CONFIG_DIR: "/Users/tester/Claude Config/ทีม 'native'" },
      homeDir: "/Users/tester"
    });
    const macSettings = JSON.parse(fileMap(mac).get("config/settings.json"));
    assert.equal(macSettings.statusLine.type, "command");
    assert.equal(macSettings.statusLine.padding, 0);
    assert.match(macSettings.statusLine.command, /statusline[.]sh/u);
    assert.match(macSettings.statusLine.command, /Claude Config/u);
  }
});

test("Claude native statusline command rejects unsafe custom roots", () => {
  const invalidRoots = [
    "C:/Claude\nunsafe",
    "C:/Claude\"unsafe",
    "C:/Claude<unsafe",
    "C:/Claude>unsafe",
    "C:/Claude|unsafe",
    "C:/Claude?unsafe",
    "C:/Claude*unsafe",
    "C:/Claude:unsafe",
    "C:/Claude/./unsafe",
    "C:/Claude/../unsafe",
    "C:/Claude//unsafe",
    "C:relative",
    "//",
    "///server/share",
    "//server/",
    "//server//share"
  ];
  for (const configRoot of invalidRoots) {
    assert.throws(
      () => renderClaudeStatuslineCommand({ platform: "win32", homeDir: "C:/Users/tester", configRoot }),
      /statusline command|config root|control|segment|absolute|UNC/iu,
      configRoot
    );
  }
  assert.throws(
    () => resultFor("portable", { platform: "darwin", env: { CLAUDE_CONFIG_DIR: "/Users/tester/Claude\0unsafe" } }),
    /statusline command|config root|control/iu
  );
});

function decodeWindowsStatuslineCommand(command) {
  const match = command.match(/^powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ([A-Za-z0-9+/=]+)$/u);
  assert.ok(match, "unexpected Windows statusline command: " + command);
  return Buffer.from(match[1], "base64").toString("utf16le");
}

test("Claude native statusline command uses shell-neutral UTF-16 PowerShell encoding", () => {
  assert.equal(
    decodeWindowsStatuslineCommand(renderClaudeStatuslineCommand({ platform: "win32", homeDir: "C:/Users/tester", configRoot: "C:/Users/tester/.claude" })),
    "$ProgressPreference = 'SilentlyContinue'\n& 'C:/Users/tester/.claude/statusline/statusline.ps1'\nexit $LASTEXITCODE\n"
  );
  const windows = renderClaudeStatuslineCommand({
    platform: "win32",
    homeDir: "C:/Users/tester",
    configRoot: "C:/Claude Config/ทีม/O'Reilly $&;" + String.fromCharCode(96) + "tick"
  });
  assert.match(windows, /^powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand [A-Za-z0-9+/=]+$/u);
  assert.equal(windows.includes("Claude Config"), false);
  assert.equal(windows.includes("O'Reilly"), false);
  assert.equal(windows.includes(String.fromCharCode(96)), false);
  assert.equal(
    decodeWindowsStatuslineCommand(windows),
    "$ProgressPreference = 'SilentlyContinue'\n& 'C:/Claude Config/ทีม/O''Reilly $&;" + String.fromCharCode(96) + "tick/statusline/statusline.ps1'\nexit $LASTEXITCODE\n"
  );
  const driveRoot = renderClaudeStatuslineCommand({ platform: "win32", homeDir: "C:/Users/tester", configRoot: "C:/" });
  assert.equal(decodeWindowsStatuslineCommand(driveRoot), "$ProgressPreference = 'SilentlyContinue'\n& 'C:/statusline/statusline.ps1'\nexit $LASTEXITCODE\n");
  const unc = renderClaudeStatuslineCommand({
    platform: "win32",
    homeDir: "C:/Users/tester",
    configRoot: "\\\\server\\share\\Claude Config\\O'Reilly $&;" + String.fromCharCode(96) + "tick"
  });
  assert.equal(
    decodeWindowsStatuslineCommand(unc),
    "$ProgressPreference = 'SilentlyContinue'\n& '//server/share/Claude Config/O''Reilly $&;" + String.fromCharCode(96) + "tick/statusline/statusline.ps1'\nexit $LASTEXITCODE\n"
  );
  const mac = renderClaudeStatuslineCommand({
    platform: "darwin",
    homeDir: "/Users/tester",
    configRoot: "/Users/tester/Claude Config/ทีม 'native'"
  });
  assert.equal(mac, "'/Users/tester/Claude Config/ทีม '\\\''native'\\\''/statusline/statusline.sh'");
});

test("Claude template Fable diagnostic records documented availability limits", () => {
  const templateDiagnostics = resultFor("template").diagnostics.filter((entry) => entry.code === "fable-advisor-availability");
  assert.deepEqual(templateDiagnostics, [{
    code: "fable-advisor-availability",
    severity: "warning",
    message: "Fable advisor is documented, but account, organization, plan, provider, consent, and product-version conditions can limit access; the primary/fallback chain remains unchanged.",
    sourcePath: "config/settings.json"
  }]);
  assert.doesNotMatch(templateDiagnostics[0].message, /experimental/iu);
  assert.equal(resultFor("portable").diagnostics.some((entry) => entry.code === "fable-advisor-availability"), false);
});

test("Claude statusline uses a shared native lifecycle record", () => {
  const record = resultFor().registrations.find((entry) => entry.kind === "native-integration" && entry.feature === "statusline");
  assert.ok(record, "statusline must expose a native integration record");
  assert.equal(record.surface, "claude");
  assert.equal(record.phases.rendered.status, "pass");
  assert.equal(record.phases.validated.status, "pass");
  assert.equal(record.phases.registered.status, "not-run");
  assert.equal(record.phases.trusted.status, "not-run-unavailable");
  assert.equal(record.phases.active.status, "not-run");
  assert.equal(record.phases.runtimeVerified.status, "not-run");
  assert.match(record.phases.trusted.evidence, /no native trust/iu);
});

test("Claude permission deny policy requires strict validation without claiming runtime enforcement", () => {
  const record = resultFor("template").registrations.find((entry) => entry.kind === "native-integration" && entry.feature === "emergency-protection");
  assert.ok(record);
  assert.deepEqual(
    Object.fromEntries(["rendered", "validated", "registered", "trusted", "active", "runtimeVerified"].map((phase) => [phase, record.phases[phase].status])),
    { rendered: "pass", validated: "not-run", registered: "not-run", trusted: "not-run-unavailable", active: "not-run", runtimeVerified: "not-run" }
  );
  assert.match(record.phases.validated.evidence, /strict plugin validation.*not run/iu);
  assert.match(record.phases.runtimeVerified.evidence, /not exercised/iu);
  assert.ok(record.manualSteps.some((step) => step.includes("bypassPermissions")));
});

test("Claude hooks use exec-form commands with argument arrays and plugin-root paths", () => {
  const hooks = JSON.parse(fileMap(resultFor()).get("hooks/hooks.json")).hooks;
  for (const groups of Object.values(hooks)) {
    for (const group of groups) {
      for (const hook of group.hooks) {
        assert.equal(hook.type, "command");
        assert.equal(typeof hook.command, "string");
        assert.ok(Array.isArray(hook.args));
        assert.ok(hook.args.some((argument) => argument.includes("${CLAUDE_PLUGIN_ROOT}")));
        assert.equal(hook.command.includes("${CLAUDE_PLUGIN_ROOT}"), false);
      }
    }
  }
});

test("Claude renders no PreToolUse hook and no emergency guard runtime", () => {
  const result = resultFor();
  const files = fileMap(result);
  const hooks = JSON.parse(files.get("hooks/hooks.json")).hooks;
  assert.equal(Object.hasOwn(hooks, "PreToolUse"), false);
  for (const relativePath of ["hooks/emergency-guard.json", "hooks/emergency-guard.mjs", "hooks/emergency-policy.mjs"]) {
    assert.equal(files.has(relativePath), false, `${relativePath} must not be rendered`);
  }
});

test("Claude startup hook invokes the rendered canonical runtime", async () => {
  const result = resultFor();
  const files = fileMap(result);
  const hooks = JSON.parse(files.get("hooks/hooks.json")).hooks;
  const startup = hooks.SessionStart.find((entry) => entry.matcher === "startup");
  assert.ok(startup);
  assert.deepEqual(startup.hooks[0].args, [
    "${CLAUDE_PLUGIN_ROOT}/hooks/bootstrap.mjs",
    "--surface",
    "claude",
    "--skill-path",
    "${CLAUDE_PLUGIN_ROOT}/skills/using-all-about-agents/SKILL.md",
    "--config-path",
    "${CLAUDE_PLUGIN_ROOT}/hooks/bootstrap.json"
  ]);
  assert.equal(files.get("hooks/bootstrap.mjs"), await readFile(resolve(process.cwd(), "core/hooks/bootstrap.mjs"), "utf8"));
  assert.equal(files.get("hooks/bootstrap.json"), await readFile(resolve(process.cwd(), "core/hooks/bootstrap.json"), "utf8"));
});

test("Claude settings registration documents one shared CLI/Desktop config root", () => {
  const result = resultFor();
  const registration = result.registrations.find((entry) => entry.kind === "settings");
  assert.deepEqual(registration, {
    kind: "settings",
    relativePath: "config/settings.json",
    rootEnv: "CLAUDE_CONFIG_DIR",
    destination: "settings.json",
    consumers: ["claude-code-cli", "claude-desktop-local-code"]
  });
  const statusline = result.registrations.find((entry) => entry.kind === "statusline-config");
  assert.equal(statusline.rootEnv, "CLAUDE_CONFIG_DIR");
  assert.equal(statusline.destination, "all-about-agents/statusline.json");
  const resolvedRoot = result.registrations.find((entry) => entry.kind === "resolved-config-root");
  assert.deepEqual(resolvedRoot, {
    kind: "resolved-config-root",
    rootEnv: "CLAUDE_CONFIG_DIR",
    path: "C:/disposable/claude-config"
  });
});

test("Claude package renders a self-contained development marketplace and two-step registration", () => {
  const result = resultFor();
  const files = fileMap(result);
  const plugin = JSON.parse(files.get(".claude-plugin/plugin.json"));
  const marketplace = JSON.parse(files.get(".claude-plugin/marketplace.json"));
  assert.equal(marketplace.name, "all-about-agents");
  assert.equal(marketplace.plugins.length, 1);
  assert.equal(marketplace.plugins[0].name, plugin.name);
  assert.equal(marketplace.plugins[0].source, "./");
  assert.equal(marketplace.plugins[0].version, plugin.version);
  const registration = result.registrations.find((entry) => entry.kind === "plugin-registration");
  assert.deepEqual(registration.marketplaceCommand, ["claude", "plugin", "marketplace", "add", "."]);
  assert.deepEqual(registration.command, ["claude", "plugin", "install", "all-about-agents@all-about-agents"]);
  assert.equal(registration.command.join(" "), "claude plugin install all-about-agents@all-about-agents");
});

test("Claude hook prerequisites reject a clean host without Node.js", () => {
  assert.deepEqual(CLAUDE_PREREQUISITES, {
    executable: "node",
    check: ["node", "--version"],
    minimumVersion: "22.12.0",
    onMissing: "reject",
    requiredBy: ["hooks/*.mjs", "statusline/statusline.mjs"]
  });
  const prerequisite = resultFor().registrations.find((entry) => entry.kind === "runtime-prerequisite");
  assert.deepEqual(prerequisite, {
    kind: "runtime-prerequisite",
    ...CLAUDE_PREREQUISITES,
    platforms: ["win32", "darwin", "linux"]
  });
});

test("Claude renders every canonical skill and retains synthetic missing-source diagnostics", () => {
  const complete = resultFor();
  assert.match(fileMap(complete).get("skills/writing-skills/SKILL.md"), /^---\nname: writing-skills\n/u);
  assert.equal(complete.diagnostics.filter((diagnostic) => diagnostic.code === "missing-skill-source").length, 0);
  const incompleteCore = { ...core, skills: core.skills.filter((entry) => entry.id !== "writing-skills") };
  const result = resultFor("portable", { core: incompleteCore });
  const deferredSkill = fileMap(result).get("skills/writing-skills/SKILL.md");
  assert.match(deferredSkill, /DEFERRED: canonical source is missing/u);
  assert.doesNotMatch(deferredSkill, /installed by the All About Agents Claude plugin/u);
  const missing = result.diagnostics.filter((diagnostic) => diagnostic.code === "missing-skill-source");
  assert.equal(missing.length, 1);
  assert.ok(missing.every((diagnostic) => diagnostic.severity === "error"));
  assert.ok(missing.every((diagnostic) => diagnostic.sourcePath === "core/inventory.json"));
  assert.ok(missing.every((diagnostic) => /owner: cycle-05-skill-remediation \(T017-T043\)/u.test(diagnostic.message)));
});

test("Claude read-only roles cannot receive Bash or write tools", () => {
  const files = fileMap(resultFor());
  for (const role of ["investigator", "verifier", "reviewer", "security-reviewer"]) {
    const frontmatter = files.get(`agents/${role}.md`).split("---\n")[1];
    assert.match(frontmatter, /disallowedTools:/u, `${role} must declare native restrictions`);
    const tools = frontmatter.match(/^tools:\n([\s\S]*?)(?:^disallowedTools:|$)/mu)?.[1] || "";
    assert.doesNotMatch(tools, /^\s+- (?:Bash|Write|Edit|Agent)\s*$/mu, `${role} received a mutating native tool`);
  }
});

test("Claude adapter satisfies the shared renderSurface action contract", () => {
  const result = renderSurface({
    core,
    profile: { id: "portable" },
    statuslineName: "",
    env: { CLAUDE_CONFIG_DIR: "C:/disposable/claude-config" },
    platform: "win32",
    homeDir: "C:/Users/tester"
  });
  assert.ok(result.files.length > 0);
  assert.equal(result.diagnostics.filter((diagnostic) => diagnostic.code === "missing-skill-source").length, core.inventory.skills.length - core.skills.length);
  assert.ok(result.registrations.some((entry) => entry.kind === "plugin-registration"));
});

test("Claude adapter rejects an incomplete native action mapping", () => {
  assert.throws(
    () => renderSurface({
      core,
      profile: { id: "portable" },
      statuslineName: "",
      capabilityRecord: { actionMappings: {} }
    }),
    (error) => error instanceof AdapterContractError && error.errors.some((entry) => entry.code === "missing-native-mapping")
  );
});

test("Claude adapter rejects unsafe statusline display names", () => {
  assert.throws(() => resultFor("portable", { statuslineName: `${"a".repeat(65)}` }), /64 Unicode code points/u);
  assert.throws(() => resultFor("portable", { statuslineName: "ok\u001b[31m" }), /control or ANSI/u);
  assert.throws(() => resultFor("portable", { statuslineName: "\nunsafe" }), /control or ANSI/u);
});

test("Claude ownership manifest documents roots, mappings, and native validation", async () => {
  const manifest = JSON.parse(await readFile(resolve(process.cwd(), "installers/manifests/claude.json"), "utf8"));
  assert.equal(manifest.surface, "claude");
  assert.equal(manifest.configRoot.environment, "CLAUDE_CONFIG_DIR");
  assert.equal(manifest.components.globalInstructions, "CLAUDE.md");
  assert.deepEqual(manifest.configRoot.sharedBy, ["claude-code-cli", "claude-desktop-local-code"]);
  assert.deepEqual(manifest.semanticCapabilities["web-primary-sources"], ["WebSearch", "WebFetch"]);
  assert.deepEqual([...manifest.readOnlyRoles.roles].sort(), ["architect", "investigator", "researcher", "reviewer", "security-reviewer", "verifier"]);
  assert.deepEqual(manifest.actions["aaa:design"], "commands/design.md");
  assert.deepEqual(manifest.nativeValidation.command, ["claude", "plugin", "validate", ".", "--strict"]);
  assert.deepEqual(manifest.pluginRegistration.marketplaceCommand, ["claude", "plugin", "marketplace", "add", "."]);
  assert.deepEqual(manifest.pluginRegistration.command, ["claude", "plugin", "install", "all-about-agents@all-about-agents"]);
  assert.ok(manifest.ownedPaths.includes(".claude-plugin/marketplace.json"));
  assert.ok(manifest.ownedPaths.includes("CLAUDE.md"));
  assert.deepEqual(manifest.preflight, CLAUDE_PREREQUISITES);
  assert.deepEqual(manifest.profiles.portable.settings.permissions, {
    defaultMode: "default",
    deny: ["Bash(rm -rf /)", "Bash(rm -rf ~)", "Bash(git push --force*)", "Bash(git reset --hard*)"]
  });
  assert.deepEqual(manifest.profiles.template.settings.permissions, {
    defaultMode: "bypassPermissions",
    deny: ["Bash(rm -rf /)", "Bash(rm -rf ~)", "Bash(git push --force*)", "Bash(git reset --hard*)"]
  });
  for (const profile of Object.values(manifest.profiles)) {
    assert.equal(Object.keys(profile.settings).some((key) => key.includes(".")), false);
  }
  assert.match(manifest.rootInstructionContext, /deployed to <CLAUDE_CONFIG_DIR>\/CLAUDE[.]md/u);
});

test("Claude render is deterministic and matches the checked-in portable snapshot", async () => {
  const first = resultFor();
  const second = resultFor();
  assert.deepEqual(first.files.map((file) => ({ ...file, content: [...file.content] })), second.files.map((file) => ({ ...file, content: [...file.content] })));
  assert.deepEqual(first.registrations, second.registrations);
  assert.deepEqual(first.ownership, second.ownership);
  const snapshot = JSON.parse(await readFile(resolve(process.cwd(), "tests/snapshots/claude/portable.json"), "utf8"));
  assert.deepEqual(snapshot.paths, first.files.map((file) => file.relativePath));
  assert.equal(snapshot.fileCount, first.files.length);
  assert.deepEqual(snapshot.settings, JSON.parse(fileMap(first).get("config/settings.json")));
  assert.deepEqual(snapshot.content, Object.fromEntries([".claude-plugin/marketplace.json", ".claude-plugin/plugin.json", "agents/investigator.md", "config/settings.json", "hooks/hooks.json"].map((path) => [path, fileMap(first).get(path)])));
  assert.deepEqual(snapshot.ownershipHashes, Object.fromEntries(first.ownership.map((entry) => [entry.relativePath, entry.sha256])));
  assert.deepEqual(snapshot.registration, first.registrations.find((entry) => entry.kind === "resolved-config-root"));
});

test("template Claude snapshot keeps the approved model and permission shape", async () => {
  const result = resultFor("template");
  const files = fileMap(result);
  const snapshot = JSON.parse(await readFile(resolve(process.cwd(), "tests/snapshots/claude/template.json"), "utf8"));
  assert.deepEqual(snapshot.settings, JSON.parse(files.get("config/settings.json")));
  assert.deepEqual(snapshot.paths, result.files.map((file) => file.relativePath));
  assert.deepEqual(snapshot.content, Object.fromEntries([".claude-plugin/marketplace.json", ".claude-plugin/plugin.json", "agents/investigator.md", "config/settings.json", "hooks/hooks.json"].map((path) => [path, files.get(path)])));
  assert.deepEqual(snapshot.ownershipHashes, Object.fromEntries(result.ownership.map((entry) => [entry.relativePath, entry.sha256])));
  assert.deepEqual(snapshot.registration, result.registrations.find((entry) => entry.kind === "resolved-config-root"));
});
