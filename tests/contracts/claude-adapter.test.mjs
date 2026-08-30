import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { loadCore } from "../../installers/lib/load-core.mjs";
import {
  CLAUDE_PREREQUISITES,
  CLAUDE_MODEL_POLICY,
  CLAUDE_SEMANTIC_MAPPINGS,
  renderSurface,
  renderClaude,
  resolveClaudeConfigDir
} from "../../adapters/claude/adapter.mjs";
import { AdapterContractError } from "../../adapters/shared/adapter-contract.mjs";

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
    advisorModel: "claude-fable-5",
    env: { CLAUDE_CODE_EFFORT_LEVEL: "max" }
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
  }
  assert.equal(files.has("CLAUDE.md"), false);
  assert.equal(files.has(".claude/CLAUDE.md"), false);
  assert.equal(files.has("AGENTS.md"), false);
});

test("template Claude render emits full-access settings without unsupported effortLevel", () => {
  const files = fileMap(resultFor("template"));
  const settings = JSON.parse(files.get("config/settings.json"));
  assert.equal(settings.model, "claude-opus-5");
  assert.deepEqual(settings.fallbackModel, ["claude-sonnet-5"]);
  assert.equal(settings.advisorModel, "claude-fable-5");
  assert.equal(settings.env.CLAUDE_CODE_EFFORT_LEVEL, "max");
  assert.equal(Object.hasOwn(settings, "effortLevel"), false);
  assert.equal(settings.fallbackModel.includes("claude-fable-5"), false);
  assert.equal(settings.permissions.defaultMode, "bypassPermissions");
  assert.ok(settings.permissions.deny.length > 0);
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

test("Claude emergency guard uses the canonical policy and documented PreToolUse command", async () => {
  const result = resultFor();
  const files = fileMap(result);
  const hooks = JSON.parse(files.get("hooks/hooks.json")).hooks;
  const guard = hooks.PreToolUse[0].hooks[0];
  assert.deepEqual(guard.args.slice(1), ["--surface", "claude", "--policy-path", "${CLAUDE_PLUGIN_ROOT}/hooks/emergency-guard.json"]);
  assert.equal(files.get("hooks/emergency-guard.mjs"), await readFile(resolve(process.cwd(), "core/hooks/emergency-guard.mjs"), "utf8"));
  assert.equal(files.get("hooks/emergency-policy.mjs"), await readFile(resolve(process.cwd(), "installers/lib/emergency-policy.mjs"), "utf8"));
  assert.deepEqual(JSON.parse(files.get("hooks/emergency-guard.json")).orderedRuleIds, [
    "filesystem-root-erasure", "raw-disk-destruction", "git-force-push", "git-history-rewrite",
    "git-discard-uncommitted", "secret-credential-access", "secret-output-or-transmission", "guardrail-bypass"
  ]);
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

test("Claude plugin registration resolves through the checked-in development marketplace", () => {
  const registration = resultFor().registrations.find((entry) => entry.kind === "plugin-registration");
  assert.deepEqual(registration.command, ["claude", "plugin", "install", "all-about-agents@all-about-agents-dev"]);
  assert.equal(registration.command.join(" "), "claude plugin install all-about-agents@all-about-agents-dev");
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

test("Claude reports the next missing canonical skill source with an owning remediation ticket", () => {
  const result = resultFor();
  const deferredSkill = fileMap(result).get("skills/subagent-driven-development/SKILL.md");
  assert.match(deferredSkill, /DEFERRED: canonical source is missing/u);
  assert.doesNotMatch(deferredSkill, /installed by the All About Agents Claude plugin/u);
  const missing = result.diagnostics.filter((diagnostic) => diagnostic.code === "missing-skill-source");
  assert.equal(missing.length, core.inventory.skills.length - core.skills.length);
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
  assert.deepEqual(manifest.configRoot.sharedBy, ["claude-code-cli", "claude-desktop-local-code"]);
  assert.deepEqual(manifest.semanticCapabilities["web-primary-sources"], ["WebSearch", "WebFetch"]);
  assert.deepEqual([...manifest.readOnlyRoles.roles].sort(), ["architect", "investigator", "researcher", "reviewer", "security-reviewer", "verifier"]);
  assert.deepEqual(manifest.actions["aaa:design"], "commands/design.md");
  assert.deepEqual(manifest.nativeValidation.command, ["claude", "plugin", "validate", ".", "--strict"]);
  assert.deepEqual(manifest.pluginRegistration.command, ["claude", "plugin", "install", "all-about-agents@all-about-agents-dev"]);
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
  assert.match(manifest.rootInstructionContext, /not emitted/u);
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
  assert.deepEqual(snapshot.content, Object.fromEntries([".claude-plugin/plugin.json", "agents/investigator.md", "config/settings.json", "hooks/hooks.json"].map((path) => [path, fileMap(first).get(path)])));
  assert.deepEqual(snapshot.ownershipHashes, Object.fromEntries(first.ownership.map((entry) => [entry.relativePath, entry.sha256])));
  assert.deepEqual(snapshot.registration, first.registrations.find((entry) => entry.kind === "resolved-config-root"));
});

test("template Claude snapshot keeps the approved model and permission shape", async () => {
  const result = resultFor("template");
  const files = fileMap(result);
  const snapshot = JSON.parse(await readFile(resolve(process.cwd(), "tests/snapshots/claude/template.json"), "utf8"));
  assert.deepEqual(snapshot.settings, JSON.parse(files.get("config/settings.json")));
  assert.deepEqual(snapshot.paths, result.files.map((file) => file.relativePath));
  assert.deepEqual(snapshot.content, Object.fromEntries([".claude-plugin/plugin.json", "agents/investigator.md", "config/settings.json", "hooks/hooks.json"].map((path) => [path, files.get(path)])));
  assert.deepEqual(snapshot.ownershipHashes, Object.fromEntries(result.ownership.map((entry) => [entry.relativePath, entry.sha256])));
  assert.deepEqual(snapshot.registration, result.registrations.find((entry) => entry.kind === "resolved-config-root"));
});
