import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { loadCore } from "../../installers/lib/load-core.mjs";
import { AdapterContractError } from "../../adapters/shared/adapter-contract.mjs";
import { renderGeminiGlobalInstructions } from "../../adapters/shared/global-instructions.mjs";
import { displayLabel } from "../../installers/lib/presentation-contract.mjs";
import { materializeRenderResult } from "../../installers/lib/render.mjs";

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

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

test("Desktop emits the canonical package-root GEMINI.md with shared presentation guidance", () => {
  const portable = resultFor("portable");
  const template = resultFor("template");
  const portableFiles = fileMap(portable);
  const templateFiles = fileMap(template);
  const expected = renderGeminiGlobalInstructions(core);
  assert.equal(portableFiles.get("GEMINI.md"), expected);
  assert.equal(templateFiles.get("GEMINI.md"), expected);
  assert.equal(sha256(portableFiles.get("GEMINI.md")), sha256(templateFiles.get("GEMINI.md")));
  assert.equal([...expected].length < 12000, true);
  assert.match(expected, /[^\n]\n$/u);
  assert.doesNotMatch(expected, /<\/?[A-Za-z][^>]*>|@keyframes|animation\s*:/iu);
  assert.doesNotMatch(expected, /\u001b/u);

  const rules = portableFiles.get(".agents/plugins/all-about-agents/rules/AGENTS.md");
  assert.equal((rules.match(/Presentation catalog/gu) || []).length, 1);
  assert.match(rules, /brainstorming 🧠/u);
  assert.match(rules, /architect 🏛️/u);
  assert.match(rules, /default 🤖/u);
  assert.match(rules, /Dynamic subagent names stay unchanged/u);
  assert.equal(displayLabel(core.presentation, "subagent", "runtime-worker"), "runtime-worker 🤖");
  assert.match(portableFiles.get(".agents/plugins/all-about-agents/skills/brainstorming/SKILL.md"), /Using skill \*\*brainstorming 🧠\*\* —/u);
  assert.match(portableFiles.get(".agents/plugins/all-about-agents/agents/architect.md"), /Invoking agent \*\*architect 🏛️\*\* —/u);
  assert.equal(portableFiles.has("settings.json"), false);
  assert.equal(portableFiles.has("config/settings.json"), false);
});

test("Desktop manual global instructions stay at the package root until an authorized native copy", () => {
  const rendered = resultFor("portable");
  const registration = rendered.registrations.find((entry) => entry.kind === "instructions" && entry.surface === "antigravity-2-desktop");
  assert.ok(registration);
  assert.equal(registration.manualDestination, "~/.gemini/GEMINI.md");
  assert.equal(Object.hasOwn(registration, "destination"), false, "manual Desktop metadata must not trigger package materialization");

  const materialized = materializeRenderResult(rendered);
  const paths = materialized.files.map((file) => file.relativePath);
  assert.ok(paths.includes("GEMINI.md"), "the installable package must retain its canonical root GEMINI.md");
  assert.equal(paths.some((relativePath) => relativePath === "~" || relativePath.startsWith("~/")), false, "a portable package must never contain a literal home-marker directory");
});

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

test("canonical Desktop actions are explicit unknown/manual diagnostics", async () => {
  const actionIds = ["aaa:design", "aaa:build", "aaa:fix", "aaa:review", "aaa:audit", "aaa:improve-skill", "aaa:resume", "aaa:verify"];
  for (const actionId of actionIds) {
    const mapping = adapter.ANTIGRAVITY_ACTION_MAPPINGS[actionId];
    assert.ok(mapping, actionId);
    assert.equal(mapping.supported, false);
    assert.equal(mapping.support, "manual-unknown");
    assert.equal(mapping.status, "unknown");
    assert.equal(mapping.source, "docs/evaluations/antigravity-contracts-2026-08-31.md");
    assert.match(mapping.reason, /no documented Desktop prompt|workflow mapping/iu);
    assert.match(mapping.manualStep, /Desktop/iu);
  }
  const manifest = JSON.parse(await readFile(resolve(process.cwd(), "installers/manifests/antigravity-2.json"), "utf8"));
  for (const actionId of actionIds) {
    assert.equal(manifest.actions[actionId].status, "unknown");
    assert.equal(manifest.actions[actionId].support, "manual-unknown");
    assert.match(manifest.actions[actionId].manualStep, /Desktop/iu);
  }
  const result = adapter.renderAntigravity({ core, profile: { id: "portable" }, statuslineName: "" });
  for (const actionId of actionIds) {
    assert.ok(result.diagnostics.some((entry) => entry.code === "desktop-action-unknown" && entry.message.includes(actionId)), actionId);
  }
  const publicResult = adapter.renderSurface({ core, profile: { id: "portable" }, statuslineName: "" });
  assert.equal(publicResult.diagnostics.filter((entry) => entry.code === "native-mapping-explicitly-unsupported").length, actionIds.length);
});

test("Desktop render rejects CLI paths and effort flags in decoded file bodies", () => {
  for (const forbiddenBody of [
    "CLI path leak: ~/.gemini/antigravity-cli/settings.json",
    "CLI flag leak: --effort high"
  ]) {
    const poisonedCore = JSON.parse(JSON.stringify(core));
    poisonedCore.skills = [{ id: "brainstorming", content: `---\ndescription: poisoned\n---\n\n${forbiddenBody}\n` }];
    assert.throws(
      () => adapter.renderAntigravity({ core: poisonedCore, profile: { id: "portable" }, statuslineName: "" }),
      /forbidden Desktop content/iu
    );
  }
});

test("portable Desktop render contains documented plugin components and every canonical skill", () => {
  const result = resultFor();
  const files = fileMap(result);
  assert.ok(files.has(".agents/plugins/all-about-agents/plugin.json"));
  assert.ok(files.has(".agents/plugins/all-about-agents/hooks.json"));
  const rulesPath = ".agents/plugins/all-about-agents/rules/AGENTS.md";
  assert.ok(files.has(rulesPath));
  assert.deepEqual(
    [...files.keys()].filter((path) => path.startsWith(".agents/plugins/all-about-agents/rules/")),
    [rulesPath],
    "Desktop plugin rules must have one native AGENTS.md entrypoint"
  );
  const rules = files.get(rulesPath);
  let previousRuleOffset = -1;
  for (const rule of [...core.rules].sort((left, right) => String(left.id) < String(right.id) ? -1 : String(left.id) > String(right.id) ? 1 : 0)) {
    const offset = rules.indexOf(`## ${rule.title || rule.id}`);
    assert.ok(offset > previousRuleOffset, `missing or unordered canonical rule ${rule.id}`);
    previousRuleOffset = offset;
  }
  for (const role of ["researcher", "investigator", "architect", "implementer", "verifier", "reviewer", "security-reviewer"]) {
    assert.ok(files.has(`.agents/plugins/all-about-agents/agents/${role}.md`), `missing native agent ${role}`);
  }
  for (const skill of core.inventory.skills) {
    assert.ok(files.has(`.agents/plugins/all-about-agents/skills/${skill}/SKILL.md`), `missing canonical skill ${skill}`);
    for (const companion of core.skills.find((record) => record.id === skill).companions) assert.ok(files.has(`.agents/plugins/all-about-agents/skills/${skill}/${companion.relativePath}`), `missing companion ${skill}/${companion.relativePath}`);
  }
  assert.equal(files.has("settings.json"), false);
  assert.equal(files.has("config/settings.json"), false);
  assert.equal(files.has("AGENTS.md"), false);
  assert.equal(files.has("CLAUDE.md"), false);
  assert.equal(files.has(".agents/workflows/design-change.md"), false);
  assert.equal(result.diagnostics.some((entry) => entry.code === "missing-skill-source"), false);
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

test("read-only Desktop agents cannot execute commands", () => {
  const files = fileMap(resultFor());
  const mutationTools = /(?:run_command|write_to_file|replace_file_content|multi_replace_file_content)/u;
  for (const role of ["investigator", "architect", "verifier", "reviewer", "security-reviewer"]) {
    const content = files.get(`.agents/plugins/all-about-agents/agents/${role}.md`);
    assert.ok(content, role);
    assert.doesNotMatch(content, /run_command/u, `${role} must not receive command execution`);
    assert.doesNotMatch(content, mutationTools, `${role} must not receive mutation-capable tools`);
    assert.match(content, /^commandExecutionPolicy: off$/mu, `${role} must disable command execution`);
  }
  const implementer = files.get(".agents/plugins/all-about-agents/agents/implementer.md");
  assert.match(implementer, /run_command/u, "non-read-only implementer retains test command access");
  assert.match(implementer, /^commandExecutionPolicy: sandbox$/mu);
});

test("plugin-agent packaging records the documentation split and verified Windows discovery", async () => {
  const files = fileMap(resultFor());
  const guidance = files.get(".agents/plugins/all-about-agents/rules/AGENTS.md");
  const readme = await readFile(resolve(process.cwd(), "adapters/antigravity-2/templates/README.md"), "utf8");
  const manifest = JSON.parse(await readFile(resolve(process.cwd(), "installers/manifests/antigravity-2.json"), "utf8"));
  for (const content of [guidance, readme]) {
    assert.match(content, /Plugins page[\s\S]*omits[\s\S]*agents\//iu);
    assert.match(content, /Subagents page[\s\S]*separately documents[\s\S]*agents\//iu);
    assert.match(content, /Windows[\s\S]*2\.11\.0[\s\S]*(?:seven|7)[\s\S]*(?:agents|roles)/iu);
  }
  assert.equal(manifest.components.agents.status, "verified");
  assert.equal(manifest.components.agents.verifiedOn, "Windows Desktop 2.11.0");
  assert.match(manifest.components.agents.documentation, /Plugins page.*omits.*agents\//iu);
});

test("Desktop model output selects the natively observed Flash High display name without inventing effort settings", () => {
  const result = resultFor("template");
  const model = result.registrations.find((entry) => entry.kind === "manual-model-selection");
  assert.deepEqual(model, {
    kind: "manual-model-selection",
    surface: "antigravity-2-desktop",
    model: "Gemini 3.7 Flash High",
    status: "verified",
    persistence: "conversation-local",
    applyVia: "Desktop model selector",
    evidence: {
      productVersion: "2.11.0",
      platform: "win32",
      observedAt: "2026-08-31"
    }
  });
  assert.equal(result.registrations.some((entry) => entry.kind === "unsupported-diagnostic"), false);
  assert.equal(result.diagnostics.some((entry) => entry.code === "desktop-model-high-unsupported"), false);
  const modelRule = fileMap(result).get(".agents/plugins/all-about-agents/rules/AGENTS.md");
  assert.match(modelRule, /Gemini 3\.7 Flash High/u);
  assert.match(modelRule, /no separate Desktop effort control was observed/iu);
  assert.doesNotMatch(modelRule, /Gemini 3\.7 Flash Medium/u);
  assert.doesNotMatch(modelRule, /gemini-3\.7-flash-high/u);
  assert.doesNotMatch(JSON.stringify(result), /modelKey|persistenceKey|settings\.json|--effort|--model/iu);
});

test("Desktop full-access profile uses Custom instead of Turbo so emergency denies remain explicit", () => {
  const portable = resultFor("portable");
  const template = resultFor("template");
  const portablePermission = portable.registrations.find((entry) => entry.kind === "permission-ui");
  const templatePermission = template.registrations.find((entry) => entry.kind === "permission-ui");
  assert.equal(portablePermission.preset, "Default");
  assert.equal(templatePermission.preset, "Custom");
  assert.equal(templatePermission.accessIntent, "full");
  assert.equal(templatePermission.turboMode, false);
  assert.equal(templatePermission.manualOnly, true);
  assert.ok(templatePermission.deny.includes("command(rm -rf)"));
  assert.ok(templatePermission.deny.includes("command(sudo)"));
  const rule = fileMap(template).get(".agents/plugins/all-about-agents/rules/AGENTS.md");
  assert.match(rule, /Deny > Ask > Allow/u);
  assert.match(rule, /decision: deny/u);
  assert.match(rule, /Custom/u);
  assert.match(rule, /Turbo mode.*not selected/iu);
  assert.doesNotMatch(rule, /Unrestricted/u);
});

test("Desktop hooks remain probe-required without an automatic command", () => {
  const hooks = JSON.parse(fileMap(resultFor()).get(".agents/plugins/all-about-agents/hooks.json"));
  const hook = hooks["all-about-agents-safety"];
  assert.equal(hook.enabled, false);
  for (const event of ["PreToolUse", "PostToolUse", "PreInvocation", "PostInvocation", "Stop"]) assert.deepEqual(hook[event], []);
  assert.doesNotMatch(JSON.stringify(hooks), /command|\.\//iu);
  assert.equal(fileMap(resultFor()).has(".agents/plugins/all-about-agents/hooks/bootstrap.mjs"), false);
  const registration = resultFor().registrations.find((entry) => entry.kind === "hook-contract");
  assert.equal(registration.enabled, false);
  assert.equal(registration.manualOnly, true);
  assert.equal(registration.automaticHookExecution, false);
  assert.equal(registration.probeRequired, true);
  assert.equal(registration.probe.status, "not run");
  const rules = fileMap(resultFor()).get(".agents/plugins/all-about-agents/rules/AGENTS.md");
  assert.match(rules, /events and JSON input\/output are documented/iu);
  assert.match(rules, /failure behavior.*not documented/iu);
  assert.equal(resultFor().registrations.find((entry) => entry.kind === "activity-audit").failureMode, "unknown-disabled");
});

test("Desktop emergency guard is consumed as a disabled probe-only native contract", () => {
  const result = resultFor();
  const files = fileMap(result);
  const guard = JSON.parse(files.get(".agents/plugins/all-about-agents/hooks/emergency-guard.json"));
  assert.equal(guard.event, "PreToolUse");
  assert.equal(guard.automatic, false);
  assert.equal(guard.probeRequired, true);
  assert.equal(guard.probe.status, "not run");
  assert.doesNotMatch(JSON.stringify(guard), /"command"\s*:|\.\/hooks|\$PLUGIN_ROOT|%PLUGIN_ROOT%/iu);
  const registration = result.registrations.find((entry) => entry.kind === "emergency-guard");
  assert.equal(registration.enabled, false);
  assert.equal(registration.automatic, false);
  assert.equal(registration.probeRequired, true);
  assert.ok(result.diagnostics.some((entry) => entry.code === "desktop-emergency-guard-probe-required"));
  const templateNative = resultFor("template").registrations.find((entry) => entry.kind === "native-integration" && entry.feature === "emergency-protection");
  const native = templateNative;
  assert.ok(native);
  assert.deepEqual(
    Object.fromEntries(["rendered", "validated", "registered", "trusted", "active", "runtimeVerified"].map((phase) => [phase, native.phases[phase].status])),
    { rendered: "pass", validated: "not-run", registered: "not-run", trusted: "not-run", active: "not-run", runtimeVerified: "not-run" }
  );
  assert.match(native.manualSteps.join(" "), /Custom.*command\(rm -rf\).*command\(sudo\).*write_file\(\.git\/\).*write_file\(\/home\/user\/\.ssh\)/u);
  assert.doesNotMatch(JSON.stringify(native), /"(?:enabled|automatic|active|ready|trusted|runtimeVerified)"\s*:\s*true/iu);
});

test("Desktop emergency normalization uses documented toolCall fields and maps only deny", () => {
  const normalized = adapter.normalizeAntigravityEmergencyRequest({
    toolCall: { name: "run_command", args: { CommandLine: "git push origin main --force", Cwd: "C:/disposable" } },
    stepIdx: 1
  });
  assert.deepEqual(normalized, {
    capability: "command-execution",
    command: "git push origin main --force",
    paths: [],
    gitOperation: "git push origin main --force",
    secretOperation: null
  });
  assert.deepEqual(adapter.mapAntigravityEmergencyDecision(adapter.classifyAntigravityEmergencyRequest({
    toolCall: { name: "run_command", args: { CommandLine: "git push origin main --force" } },
    stepIdx: 1
  })), { decision: "deny", reason: "Denied: force-push would rewrite shared Git history." });
  assert.deepEqual(adapter.mapAntigravityEmergencyDecision({ decision: "allow", ruleId: null, reason: "Allowed: no emergency rule matched." }), {});
  assert.equal(adapter.normalizeAntigravityEmergencyRequest({ toolCall: { name: "run_command", args: [] } }), null);
});

test("Desktop manifest documents workspace/global discovery and no serialized settings or CLI registration", async () => {
  const manifest = JSON.parse(await readFile(resolve(process.cwd(), "installers/manifests/antigravity-2.json"), "utf8"));
  assert.equal(manifest.surface, "antigravity-2");
  assert.equal(manifest.pluginManifest, ".agents/plugins/all-about-agents/plugin.json");
  assert.equal(manifest.discovery.workspace, ".agents/plugins/<plugin>/");
  assert.equal(manifest.discovery.global, "~/.gemini/config/plugins/<plugin>/");
  assert.equal(manifest.components.rules, ".agents/plugins/<plugin>/rules/AGENTS.md");
  assert.equal(manifest.components.hooks, ".agents/plugins/<plugin>/hooks.json");
  assert.deepEqual(manifest.components.globalInstructions, {
    package: "GEMINI.md",
    destination: "~/.gemini/GEMINI.md",
    registration: "manual-copy",
    automaticWrite: false
  });
  assert.ok(manifest.ownedPaths.includes("GEMINI.md"));
  assert.equal(manifest.components.agents.path, ".agents/plugins/<plugin>/agents/{role}.md");
  assert.equal(manifest.nativeValidation.status, "partial");
  assert.equal(manifest.nativeValidation.productVersion, "2.11.0");
  assert.equal(manifest.nativeValidation.platform, "win32");
  assert.equal(Object.hasOwn(manifest, "settings"), false);
  assert.equal(JSON.stringify(manifest).includes("gemini-3.7-flash-high"), false);
  assert.equal(JSON.stringify(manifest).includes("--effort"), false);
  const plugin = JSON.parse(fileMap(resultFor()).get(".agents/plugins/all-about-agents/plugin.json"));
  assert.deepEqual(plugin, { name: "all-about-agents" });
});

test("native acceptance records Windows observations per check and leaves untested behavior open", async () => {
  const manifest = JSON.parse(await readFile(resolve(process.cwd(), "installers/manifests/antigravity-2.json"), "utf8"));
  const acceptance = manifest.nativeValidation;
  assert.equal(acceptance.status, "partial");
  assert.equal(acceptance.product, "Antigravity 2.0 Desktop");
  assert.equal(acceptance.productVersion, "2.11.0");
  assert.equal(acceptance.platform, "win32");
  assert.equal(acceptance.checkedAt, "2026-08-31");
  assert.match(acceptance.reason, /partial|per[ -]check/iu);
  assert.ok(Array.isArray(acceptance.checks));
  const checks = new Map(acceptance.checks.map((check) => [check.id, check]));
  for (const passed of ["launch-and-discovery", "skill-discovery", "agent-discovery", "model-policy", "rule-discovery"]) {
    assert.equal(checks.get(passed)?.status, "pass", passed);
  }
  for (const notRun of ["agent-tool-safety", "permission-deny", "hooks-contract", "cross-session-persistence"]) {
    assert.equal(checks.get(notRun)?.status, "not run", notRun);
  }
  assert.ok(Array.isArray(acceptance.manualAcceptanceChecklist));
  for (const check of acceptance.manualAcceptanceChecklist) {
    assert.match(check.id, /^[a-z0-9-]+$/u);
    assert.match(check.command, /Desktop/iu);
    assert.ok(check.expected.length > 0);
  }
  const ids = new Set(acceptance.manualAcceptanceChecklist.map((check) => check.id));
  for (const required of ["launch-and-discovery", "skill-and-rule-discovery", "agent-tool-safety", "model-policy", "permission-deny", "hooks-contract"]) {
    assert.ok(ids.has(required), required);
  }
  const readme = await readFile(resolve(process.cwd(), "adapters/antigravity-2/templates/README.md"), "utf8");
  assert.match(readme, /Native acceptance \(partial\)/iu);
  assert.match(readme, /product version:\s*`2\.11\.0`/iu);
  assert.match(readme, /platform:\s*`win32`/iu);
  for (const required of ids) assert.match(readme, new RegExp(required, "u"));
});

test("Desktop capability evidence records the observed High selector and no separate effort control", async () => {
  const evidence = JSON.parse(await readFile(resolve(process.cwd(), "adapters/antigravity-2/capabilities.json"), "utf8"));
  assert.equal(evidence.checkedAt, "2026-08-31");
  assert.equal(evidence.productVersion, "2.11.0");
  const model = evidence.capabilities.find((entry) => entry.feature === "model.desktop");
  assert.ok(model);
  assert.equal(model.source, "tests/integration/manual-desktop-checklist.json");
  assert.equal(model.support, "manual");
  assert.deepEqual(model.value, {
    displayName: "Gemini 3.7 Flash High",
    selection: "manual",
    persistence: "conversation-local",
    applyVia: "Desktop model selector"
  });
  const effort = evidence.capabilities.find((entry) => entry.feature === "effort.desktop");
  assert.ok(effort);
  assert.equal(effort.source, "tests/integration/manual-desktop-checklist.json");
  assert.equal(effort.support, "unsupported");
  assert.equal(effort.stability, "unsupported");
  assert.equal(effort.value, null);
  assert.match(effort.notes, /no separate.*effort/iu);
  assert.equal(Object.hasOwn(model.value, "thinkingLevel"), false);
  assert.equal(Object.hasOwn(effort.value || {}, "effort"), false);
  const persistence = evidence.capabilities.find((entry) => entry.feature === "desktop.model-persistence");
  assert.ok(persistence);
  assert.equal(persistence.source, "docs/evaluations/antigravity-contracts-2026-08-31.md");
  assert.equal(persistence.support, "unknown");
  assert.equal(persistence.stability, "unknown");
  assert.deepEqual(persistence.value, { nativeConfigKey: null, persistence: "unknown" });
  const desktopPolicy = evidence.capabilities.filter((entry) => entry.feature.endsWith(".desktop") || entry.feature === "desktop.model-persistence");
  for (const entry of desktopPolicy) {
    assert.notEqual(entry.value?.thinkingLevel, "High");
    assert.notEqual(entry.value?.effort, "High");
  }
  const currentPolicy = JSON.stringify(desktopPolicy);
  assert.doesNotMatch(currentPolicy, /gemini-3\.7-flash-high/iu);
  assert.doesNotMatch(currentPolicy, /"(?:effort|thinkingLevel)":"high"/iu);
});

test("Antigravity adapter satisfies the shared action contract and rejects incomplete mappings", () => {
  const result = adapter.renderAntigravity({ core, profile: { id: "portable" }, statuslineName: "" });
  assert.ok(result.files.length > 0);
  assert.ok(result.registrations.some((entry) => entry.kind === "plugin-registration"));
  const publicResult = adapter.renderSurface({ core, profile: { id: "portable" }, statuslineName: "" });
  assert.equal(publicResult.diagnostics.filter((entry) => entry.code === "native-mapping-explicitly-unsupported").length, 8);
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
    assert.deepEqual(snapshot.actionDiagnostics, first.diagnostics.filter((entry) => entry.code === "desktop-action-unknown"));
    assert.ok(snapshot.contentHashes, `${profile} snapshot must pin rendered body hashes`);
    assert.deepEqual(
      Object.keys(snapshot.contentHashes).sort(),
      first.ownership.map((entry) => entry.relativePath).sort(),
      `${profile} snapshot must pin every generated file hash`
    );
    const bodyExpectations = new Map([
      [".agents/plugins/all-about-agents/rules/AGENTS.md", profile === "template"
        ? /Gemini 3\.7 Flash High[\s\S]*Custom[\s\S]*Deny > Ask > Allow/iu
        : /keeps the current Desktop model[\s\S]*No model key[\s\S]*Deny > Ask > Allow/iu],
      [".agents/plugins/all-about-agents/agents/architect.md", /commandExecutionPolicy: off/iu]
    ]);
    for (const [path, expected] of bodyExpectations) {
      const file = first.files.find((entry) => entry.relativePath === path);
      const ownership = first.ownership.find((entry) => entry.relativePath === path);
      assert.ok(file, path);
      assert.ok(ownership, path);
      assert.equal(snapshot.contentHashes[path], ownership.sha256, `${profile} snapshot hash drift for ${path}`);
      assert.equal(sha256(file.content), ownership.sha256, `${profile} ownership hash drift for ${path}`);
      assert.match(new TextDecoder().decode(file.content), expected, `${profile} body contract drift for ${path}`);
    }
    for (const ownership of first.ownership) {
      const file = first.files.find((entry) => entry.relativePath === ownership.relativePath);
      assert.equal(snapshot.contentHashes[ownership.relativePath], ownership.sha256, `${profile} snapshot hash drift for ${ownership.relativePath}`);
      assert.equal(sha256(file.content), snapshot.contentHashes[ownership.relativePath], `${profile} rendered body drift for ${ownership.relativePath}`);
    }
  }
});
