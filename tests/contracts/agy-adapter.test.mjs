import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { loadCore } from "../../installers/lib/load-core.mjs";
import { AdapterContractError } from "../../adapters/shared/adapter-contract.mjs";
import { renderGeminiGlobalInstructions } from "../../adapters/shared/global-instructions.mjs";
import { displayLabel } from "../../installers/lib/presentation-contract.mjs";

const requiredOutputs = [
  "adapters/agy/adapter.mjs",
  "adapters/agy/templates/",
  "installers/manifests/agy.json",
  "tests/contracts/agy-adapter.test.mjs",
  "tests/snapshots/agy/"
];

test("T011 creates every owned artifact", async () => {
  assert.ok(requiredOutputs.length > 0);
  for (const relativePath of requiredOutputs) {
    await access(resolve(process.cwd(), relativePath));
  }
});

const adapter = await import("../../adapters/agy/adapter.mjs");
const core = await loadCore(process.cwd());
const AGY_FIXTURE_CONFIG_ROOT = "C:/fixtures/agy-config";

function resultFor(profile = "portable", overrides = {}) {
  return adapter.renderAgy({
    core,
    profile: { id: profile },
    statuslineName: "",
    platform: "win32",
    configRoot: AGY_FIXTURE_CONFIG_ROOT,
    ...overrides
  });
}

function fileMap(result) {
  return new Map(result.files.map((file) => [file.relativePath, new TextDecoder().decode(file.content)]));
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

test("agy emits the canonical package-root GEMINI.md and the shared presentation contract", () => {
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

  const presentation = portableFiles.get("rules/presentation.md");
  assert.equal((presentation.match(/Presentation catalog/gu) || []).length, 1);
  assert.match(presentation, /brainstorming 🧠/u);
  assert.match(presentation, /architect 🏛️/u);
  assert.match(presentation, /default 🤖/u);
  assert.match(portableFiles.get("rules/adapter-capability-guidance.md"), /Dynamic subagent names stay unchanged/u);
  assert.equal(displayLabel(core.presentation, "subagent", "runtime-worker"), "runtime-worker 🤖");
  assert.match(portableFiles.get("skills/brainstorming/SKILL.md"), /Using skill \*\*brainstorming 🧠\*\* —/u);
  assert.match(portableFiles.get("agents/architect/agent.md"), /Invoking agent \*\*architect 🏛️\*\* —/u);
  assert.equal(portableFiles.has("config/settings.json"), false);
});

test("agy renders a strict documented plugin manifest", () => {
  const manifest = JSON.parse(fileMap(resultFor()).get("plugin.json"));
  assert.deepEqual(Object.keys(manifest).sort(), ["$schema", "description", "name"]);
  assert.equal(manifest.$schema, "https://antigravity.google/schemas/v1/plugin.json");
  assert.equal(manifest.name, "all-about-agents");
  assert.equal(typeof manifest.description, "string");
});

test("Desktop and agy package GEMINI.md bodies are byte-identical for both profiles", async () => {
  const desktop = await import("../../adapters/antigravity-2/adapter.mjs");
  for (const profile of ["portable", "template"]) {
    const desktopFiles = new Map(desktop.renderAntigravity({
      core,
      profile: { id: profile },
      statuslineName: "",
      platform: "win32",
      homeDir: "C:/Users/tester"
    }).files.map((file) => [file.relativePath, file.content]));
    const agyFiles = new Map(resultFor(profile).files.map((file) => [file.relativePath, file.content]));
    assert.deepEqual([...desktopFiles.get("GEMINI.md")], [...agyFiles.get("GEMINI.md")], profile);
  }
});

test("agy renders nested agents and every canonical skill and rule", () => {
  const files = fileMap(resultFor());
  for (const role of ["researcher", "investigator", "architect", "implementer", "verifier", "reviewer", "security-reviewer"]) {
    assert.ok(files.has(`agents/${role}/agent.md`), `missing nested agent ${role}`);
  }
  for (const skill of core.inventory.skills) {
    assert.ok(files.has(`skills/${skill}/SKILL.md`), `missing canonical skill ${skill}`);
    for (const companion of core.skills.find((record) => record.id === skill).companions) assert.ok(files.has(`skills/${skill}/${companion.relativePath}`), `missing companion ${skill}/${companion.relativePath}`);
  }
  for (const rule of core.rules) assert.ok(files.has(`rules/${rule.id}.md`), `missing canonical rule ${rule.id}`);
  for (const path of [
    "rules/adapter-capability-guidance.md",
    "rules/model-selection.md",
    "rules/permission-safety.md",
    "rules/hook-contract.md",
    "rules/settings-overlay.md"
  ]) assert.ok(files.has(path), path);
});

test("agy renders the documented native statusline package and sparse overlay", () => {
  const result = resultFor("template", { statuslineName: "ทีม O'Reilly" });
  const files = fileMap(result);
  for (const path of [
    "statusline/statusline.mjs",
    "statusline/statusline.ps1",
    "statusline/statusline.sh",
    "statusline/statusline.json"
  ]) assert.ok(files.has(path), `missing ${path}`);
  const settings = JSON.parse(files.get("settings.overlay.json"));
  assert.deepEqual(settings.statusLine, {
    type: "command",
    command: settings.statusLine.command,
    enabled: true,
    padding: 0,
    stack_with_default: false
  });
  assert.equal(JSON.parse(files.get("statusline/statusline.json")).displayName, "ทีม O'Reilly");
  assert.equal(settings.statusLine.command.includes("team"), false);
});

test("agy resolves the documented CLI config root and quotes platform launchers", () => {
  assert.equal(adapter.resolveAgyConfigDir({ homeDir: "C:/Users/tester", platform: "win32" }), "C:/Users/tester/.gemini/antigravity-cli");
  assert.equal(adapter.resolveAgyConfigDir({ homeDir: "C:/", platform: "win32" }), "C:/.gemini/antigravity-cli");
  assert.equal(adapter.resolveAgyConfigDir({ homeDir: "/Users/tester", platform: "darwin" }), "/Users/tester/.gemini/antigravity-cli");
  const windows = adapter.renderAgyStatuslineCommand({
    configRoot: "C:/Agy Config/O'Reilly $&;" + String.fromCharCode(96) + "tick",
    platform: "win32"
  });
  assert.match(windows, /^powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand [A-Za-z0-9+/=]+$/u);
  const encoded = windows.match(/ ([A-Za-z0-9+/=]+)$/u)[1];
  const decoded = Buffer.from(encoded, "base64").toString("utf16le");
  assert.equal(decoded, "$ProgressPreference = 'SilentlyContinue'\n& 'C:/Agy Config/O''Reilly $&;" + String.fromCharCode(96) + "tick/plugins/all-about-agents/statusline/statusline.ps1'\nexit $LASTEXITCODE\n");
  const driveRoot = adapter.renderAgyStatuslineCommand({ configRoot: "C:/", platform: "win32" });
  assert.equal(Buffer.from(driveRoot.match(/ ([A-Za-z0-9+/=]+)$/u)[1], "base64").toString("utf16le"), "$ProgressPreference = 'SilentlyContinue'\n& 'C:/plugins/all-about-agents/statusline/statusline.ps1'\nexit $LASTEXITCODE\n");
  assert.equal(adapter.renderAgyStatuslineCommand({ configRoot: "/Users/tester/Agy Config/O'Reilly", platform: "darwin" }), "'/Users/tester/Agy Config/O'\\''Reilly/plugins/all-about-agents/statusline/statusline.sh'");
});

test("agy rejects unsafe Windows statusline roots and preserves safe Unicode roots", () => {
  assert.throws(() => adapter.resolveAgyConfigDir({ homeDir: "C:/safe//child", platform: "win32" }), /empty path segment|config root/iu);
  for (const root of [
    "relative", "C:relative", "C:/Agy\nunsafe", "C:/safe\n", "C:/safe\r", "C:/safe\t",
    "C:/Agy//unsafe", "C:/Agy/../unsafe", "C:/CON", "C:/con.txt", "C:/Agy/PRN.log", "C:/safe ", "C:/Agy/safe. ",
    "C:/Agy/safe.", "C:/Agy<unsafe", "//server", "//server/"
  ]) {
    assert.throws(() => adapter.renderAgyStatuslineCommand({ configRoot: root, platform: "win32" }), /statusline|config root|absolute|segment/iu, root);
  }
  const safeWindows = adapter.renderAgyStatuslineCommand({
    configRoot: "C:/Agy Config/ทีม O'Reilly $&;" + String.fromCharCode(96) + "tick",
    platform: "win32"
  });
  assert.match(Buffer.from(safeWindows.match(/ ([A-Za-z0-9+/=]+)$/u)[1], "base64").toString("utf16le"), /ทีม O''Reilly \$&;/u);
  const unc = adapter.renderAgyStatuslineCommand({ configRoot: "//server/share/ทีม O'Reilly", platform: "win32" });
  assert.match(Buffer.from(unc.match(/ ([A-Za-z0-9+/=]+)$/u)[1], "base64").toString("utf16le"), /server\/share\/ทีม/u);
});

test("agy statusline registration exposes the native lifecycle record", () => {
  const record = resultFor().registrations.find((entry) => entry.kind === "native-integration" && entry.feature === "statusline");
  assert.ok(record, "statusline must expose a native integration record");
  assert.equal(record.surface, "agy");
  assert.equal(record.phases.rendered.status, "pass");
  assert.equal(record.phases.validated.status, "pass");
  assert.equal(record.phases.registered.status, "not-run");
  assert.equal(record.phases.trusted.status, "not-run-unavailable");
  assert.equal(record.phases.active.status, "not-run");
  assert.equal(record.phases.runtimeVerified.status, "not-run");
  assert.match(record.phases.trusted.evidence, /no native trust/iu);
});

test("agy emergency protection records the disabled hook and manual deny merge", () => {
  const result = resultFor("template");
  const record = result.registrations.find((entry) => entry.kind === "native-integration" && entry.feature === "emergency-protection");
  assert.ok(record);
  assert.deepEqual(
    Object.fromEntries(["rendered", "validated", "registered", "trusted", "active", "runtimeVerified"].map((phase) => [phase, record.phases[phase].status])),
    { rendered: "pass", validated: "not-run", registered: "not-run", trusted: "not-run", active: "not-run", runtimeVerified: "not-run" }
  );
  assert.match(record.phases.validated.evidence, /only the rendered settings deny overlay/iu);
  assert.match(record.manualSteps.join(" "), /always-proceed/u);
  assert.match(record.manualSteps.join(" "), /command\(rm -rf\).*command\(sudo\).*write_file\(\.git\/\).*write_file\(\/home\/user\/\.ssh\)/u);
  assert.equal(result.registrations.find((entry) => entry.kind === "emergency-guard").enabled, false);

  const portable = resultFor("portable").registrations.find((entry) => entry.kind === "native-integration" && entry.feature === "emergency-protection");
  assert.doesNotMatch(`${portable.phases.rendered.evidence} ${portable.manualSteps.join(" ")}`, /always-proceed|per-run skip/iu);
});

test("agy agents use only documented frontmatter fields and documented native tools", () => {
  const files = fileMap(resultFor());
  const allowedTools = new Set([
    "view_file", "write_to_file", "replace_file_content", "multi_replace_file_content", "list_dir", "find_by_name",
    "grep_search", "search_web", "read_url_content", "run_command", "invoke_subagent", "define_subagent",
    "send_message", "manage_subagents", "ask_permission", "list_permissions"
  ]);
  assert.deepEqual(new Set(adapter.AGY_DOCUMENTED_AGENT_TOOLS), allowedTools);
  for (const tools of Object.values(adapter.AGY_SEMANTIC_MAPPINGS)) {
    for (const tool of tools) assert.ok(allowedTools.has(tool), `undocumented agy tool ${tool}`);
  }
  for (const role of ["researcher", "investigator", "architect", "implementer", "verifier", "reviewer", "security-reviewer"]) {
    const frontmatter = files.get(`agents/${role}/agent.md`).split("---\n")[1];
    const fields = frontmatter.trim().split("\n").map((line) => line.match(/^([A-Za-z][A-Za-z0-9]*):/u)?.[1]);
    for (const field of fields) assert.ok(adapter.AGY_DOCUMENTED_AGENT_FIELDS.includes(field), `${role} has undocumented field ${field}`);
    assert.match(frontmatter, /^model: inherit$/mu);
    assert.match(frontmatter, /^mcpServers: \[\]$/mu);
    assert.match(frontmatter, /^skills: \[\]$/mu);
    assert.match(frontmatter, /^plugins: \[\]$/mu);
  }
});

test("agy read-only roles cannot execute or mutate", () => {
  const files = fileMap(resultFor());
  const mutationTools = /(?:run_command|write_to_file|replace_file_content|multi_replace_file_content)/u;
  for (const role of ["researcher", "investigator", "architect", "verifier", "reviewer", "security-reviewer"]) {
    const content = files.get(`agents/${role}/agent.md`);
    const frontmatter = content.split("---\n")[1];
    assert.doesNotMatch(frontmatter, mutationTools, `${role} must remain read-only`);
    assert.match(frontmatter, /(?:view_file|grep_search|search_web)/u, `${role} must retain useful read tools`);
    assert.match(frontmatter, /^commandExecutionPolicy: off$/mu);
  }
  const implementer = files.get("agents/implementer/agent.md");
  assert.match(implementer, /run_command/u);
  assert.match(implementer, /write_to_file/u);
  assert.match(implementer, /^commandExecutionPolicy: sandbox$/mu);
});

test("agy hooks are disabled until the explicit lifecycle probe is complete", () => {
  const files = fileMap(resultFor());
  const hooks = JSON.parse(files.get("hooks.json"));
  const safety = hooks["all-about-agents-safety"];
  assert.equal(safety.enabled, false);
  for (const event of ["PreToolUse", "PostToolUse", "PreInvocation", "PostInvocation", "Stop"]) assert.deepEqual(safety[event], []);
  assert.doesNotMatch(JSON.stringify(hooks), /command/iu);
  const guidance = files.get("rules/adapter-capability-guidance.md");
  const hookRule = files.get("rules/hook-contract.md");
  assert.match(guidance, /PostToolUse[\s\S]*toolCall\.name/u);
  assert.match(guidance, /handler path resolution[\s\S]*failure behavior[\s\S]*probe below/iu);
  assert.match(hookRule, /events and JSON input\/output are documented/iu);
  assert.match(hookRule, /failure behavior.*not documented/iu);
  assert.doesNotMatch(hookRule, /PreInvocation\s+contract/u);
  assert.equal(resultFor().registrations.find((entry) => entry.kind === "hook-contract").automaticHookExecution, false);
  assert.equal(resultFor().registrations.find((entry) => entry.kind === "activity-audit").failureMode, "unknown-disabled");
});

test("agy emergency guard is consumed as a disabled probe-only native contract", () => {
  const result = resultFor();
  const files = fileMap(result);
  const guard = JSON.parse(files.get("emergency-guard.json"));
  assert.equal(guard.event, "PreToolUse");
  assert.equal(guard.automatic, false);
  assert.equal(guard.probeRequired, true);
  assert.equal(guard.probe.status, "not run");
  assert.doesNotMatch(JSON.stringify(guard), /"command"\s*:|\.\/hooks|\$PLUGIN_ROOT|%PLUGIN_ROOT%/iu);
  const registration = result.registrations.find((entry) => entry.kind === "emergency-guard");
  assert.equal(registration.enabled, false);
  assert.equal(registration.automatic, false);
  assert.equal(registration.probeRequired, true);
  assert.ok(result.diagnostics.some((entry) => entry.code === "agy-emergency-guard-probe-required"));
});

test("agy emergency normalization uses documented toolCall fields and maps only deny", () => {
  const normalized = adapter.normalizeAgyEmergencyRequest({
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
  assert.deepEqual(adapter.mapAgyEmergencyDecision(adapter.classifyAgyEmergencyRequest({
    toolCall: { name: "run_command", args: { CommandLine: "git push origin main --force" } },
    stepIdx: 1
  })), { decision: "deny", reason: "Denied: force-push would rewrite shared Git history." });
  assert.deepEqual(adapter.mapAgyEmergencyDecision({ decision: "allow", ruleId: null, reason: "Allowed: no emergency rule matched." }), {});
  assert.equal(adapter.normalizeAgyEmergencyRequest({ toolCall: { name: "run_command", args: [] } }), null);
});

test("agy settings overlays use only documented sparse keys and preserve emergency denies", () => {
  const allowed = new Set(["toolPermission", "artifactReviewPolicy", "allowNonWorkspaceAccess", "enableTerminalSandbox", "statusLine", "permissions"]);
  for (const profile of ["portable", "template"]) {
    const settings = JSON.parse(fileMap(resultFor(profile)).get("settings.overlay.json"));
    for (const key of Object.keys(settings)) assert.ok(allowed.has(key), `undocumented settings key ${key}`);
    assert.deepEqual(Object.keys(settings.permissions), ["deny"]);
    assert.ok(settings.permissions.deny.includes("command(rm -rf)"));
    assert.ok(settings.permissions.deny.includes("command(sudo)"));
    assert.equal(Object.hasOwn(settings, "model"), false);
    assert.equal(Object.hasOwn(settings, "modelKey"), false);
  }
  const template = JSON.parse(fileMap(resultFor("template")).get("settings.overlay.json"));
  assert.equal(template.toolPermission, "always-proceed");
  assert.equal(template.artifactReviewPolicy, "always-proceed");
});

test("agy settings registration names only the documented CLI destination", async () => {
  const rendered = resultFor();
  const registration = rendered.registrations.find((entry) => entry.kind === "settings-overlay");
  assert.deepEqual(registration.destinationCandidates, ["~/.gemini/antigravity-cli/settings.json"]);
  assert.equal(registration.status, "apply-after-review");
  assert.match(registration.reason, /sparse overlay|register --apply/iu);
  assert.doesNotMatch(JSON.stringify(rendered), /~\/\.gemini\/config\/config\.json/u);

  const manifest = JSON.parse(await readFile(resolve(process.cwd(), "installers/manifests/agy.json"), "utf8"));
  assert.deepEqual(manifest.components.globalInstructions, {
    package: "GEMINI.md",
    destination: "~/.gemini/GEMINI.md",
    registration: "register --apply",
    automaticWrite: true
  });
  assert.deepEqual(manifest.settingsOverlay.destinationCandidates, ["~/.gemini/antigravity-cli/settings.json"]);
  assert.doesNotMatch(JSON.stringify(manifest), /~\/\.gemini\/config\/config\.json/u);
  assert.doesNotMatch(JSON.stringify(manifest), /~\/\.gemini\/antigravity\//u);
  assert.equal(manifest.settingsOverlay.automaticWrite, true);
  assert.equal(manifest.installedPluginRoot, "~/.gemini/antigravity-cli/plugins/all-about-agents/");
  assert.equal(manifest.settingsOverlay.status, "apply-after-review");
  assert.equal(manifest.components.statusline, "statusline/statusline.mjs");
  assert.equal(manifest.components.statuslineConfig, "statusline/statusline.json");
  assert.equal(manifest.components.statuslineWindowsLauncher, "statusline/statusline.ps1");
  assert.equal(manifest.components.statuslinePosixLauncher, "statusline/statusline.sh");
  assert.deepEqual(manifest.statuslinePrerequisites.requiredBy, ["statusline/statusline.mjs"]);
});

test("agy official contract evidence is tracked and rendered claims no root conflict", async () => {
  const evidencePath = "docs/evaluations/antigravity-contracts-2026-08-31.md";
  const evidence = await readFile(resolve(process.cwd(), evidencePath), "utf8");
  for (const url of [
    "https://antigravity.google/docs/cli/headless/",
    "https://antigravity.google/docs/cli/plugins/",
    "https://antigravity.google/docs/cli/settings",
    "https://antigravity.google/docs/cli/subagents",
    "https://antigravity.google/docs/hooks/"
  ]) assert.match(evidence, new RegExp(url.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"), url);
  assert.match(evidence, /Retrieved:\s*2026-08-31/u);
  const rendered = resultFor();
  const serialized = JSON.stringify(rendered);
  assert.doesNotMatch(serialized, /sources conflict|active (?:plugin|package|settings) roots?[^.]*unknown/iu);
  assert.equal(rendered.registrations.find((entry) => entry.kind === "plugin-registration").stagedDestination, "~/.gemini/antigravity-cli/plugins/all-about-agents/");
  assert.ok(rendered.diagnostics.every((entry) => entry.sourcePath !== "research-agy-2.md"));
});

test("agy model and permission operations use the exact documented CLI controls", async () => {
  const result = resultFor("template");
  const files = fileMap(result);
  const model = result.registrations.find((entry) => entry.kind === "model-selection");
  const fullAccess = result.registrations.find((entry) => entry.kind === "full-access-per-run");
  assert.equal(model.model, "gemini-3.7-flash-high");
  assert.equal(model.effort, "high");
  assert.deepEqual(model.args, ["agy", "-p", "<prompt>", "--model", "gemini-3.7-flash-high", "--effort", "high"]);
  assert.deepEqual(fullAccess.args, ["agy", "-p", "<prompt>", "--model", "gemini-3.7-flash-high", "--effort", "high", "--dangerously-skip-permissions"]);
  assert.equal(Object.hasOwn(model, "command"), false);
  assert.equal(Object.hasOwn(fullAccess, "command"), false);
  const manifest = JSON.parse(await readFile(resolve(process.cwd(), "installers/manifests/agy.json"), "utf8"));
  assert.deepEqual(manifest.modelPolicy.args, model.args);
  assert.deepEqual(manifest.profiles.template.fullAccessArgs, fullAccess.args);
  assert.equal(Object.hasOwn(manifest.profiles.template, "fullAccessPerRun"), false);
  assert.match(files.get("rules/permission-safety.md"), /toolPermission: always-proceed/u);
  assert.match(files.get("rules/permission-safety.md"), /Deny has precedence over Ask and Allow/u);
  assert.match(files.get("rules/permission-safety.md"), /--dangerously-skip-permissions/u);
  const serialized = JSON.stringify(result);
  for (const forbidden of ["--thinking", "--reasoning-effort", "--dry-run", "--mode=accept-edits", "modelKey", "model_key"]) {
    assert.equal(serialized.includes(forbidden), false, `forbidden agy term emitted: ${forbidden}`);
  }
});

test("agy generated model docs use a shell-neutral argv representation", () => {
  const files = fileMap(resultFor("template"));
  for (const path of ["README.md", "rules/model-selection.md"]) {
    const body = files.get(path);
    assert.doesNotMatch(body, /(?:^|\s)agy\s+-p\s+[^\n]*/mu, `${path} emitted a shell-form agy -p command`);
    assert.doesNotMatch(body, /<prompt>/u, `${path} emitted the placeholder in prose`);
    assert.match(body, /\[\s*"agy",\s*"-p",\s*"PROMPT_TEXT",\s*"--model",\s*"gemini-3\.7-flash-high",\s*"--effort",\s*"high"\s*\]/su);
    assert.match(body, /process argv|spawn/iu);
    assert.match(body, /agy models/u);
  }
});

test("agy headless operation is an argument vector that preserves arbitrary prompt bytes", () => {
  const prompt = `Say "hi" with spaces, an apostrophe ' plus backtick ${String.fromCharCode(96)}, dollar $HOME, Unicode ไทย 🚀, and a backslash ${String.fromCharCode(92)}`;
  assert.deepEqual(adapter.buildHeadlessArgs({ prompt }), [
    "agy",
    "-p",
    prompt,
    "--model",
    "gemini-3.7-flash-high",
    "--effort",
    "high"
  ]);
  assert.deepEqual(adapter.buildHeadlessArgs({ prompt, dangerouslySkipPermissions: true }).slice(-1), ["--dangerously-skip-permissions"]);
  assert.equal(Object.hasOwn(adapter, "buildHeadlessCommand"), false);
});

test("agy rejects forbidden terms after decoding generated file bodies", () => {
  for (const poison of [
    "Desktop path: ~/.gemini/antigravity/config.json",
    "unsupported flag: --thinking",
    "unsupported flag: --reasoning-effort",
    "unsupported flag: --dry-run",
    "permission bypass: --mode=accept-edits",
    "guessed key: modelKey"
  ]) {
    const poisonedCore = { ...core, skills: [{ id: "brainstorming", content: `---\ndescription: poisoned\n---\n\n${poison}\n` }] };
    assert.throws(() => adapter.renderAgy({ core: poisonedCore, profile: { id: "portable" }, statuslineName: "" }), /agy render rejected/u, poison);
  }
});

test("unknown model selection fails with discovery and explicit retry guidance", () => {
  const diagnostic = adapter.diagnoseModelSelection({ requested: "unknown-model", availableModels: ["another-model"] });
  assert.equal(diagnostic.status, "error");
  assert.match(diagnostic.message, /agy models/u);
  assert.match(diagnostic.message, /exact listed slug/u);
  assert.match(diagnostic.message, /No silent model substitution/u);
  assert.throws(() => adapter.buildHeadlessArgs({ model: "unknown-model" }), /agy models/u);
  assert.equal(adapter.diagnoseModelSelection({ requested: "gemini-3.7-flash-high", availableModels: ["gemini-3.7-flash-high"] }).status, "ready");
});

test("authorized register apply installs and discovers the plugin without making rendering mutating", async () => {
  const result = resultFor();
  const commands = result.registrations.map((entry) => entry.command).filter(Boolean);
  for (const command of ["agy plugin install PACKAGE_DIRECTORY", "agy plugin list", "agy agents", "agy models"]) assert.ok(commands.includes(command), command);
  const install = result.registrations.find((entry) => entry.kind === "plugin-registration");
  assert.equal(install.manualOnly, false);
  assert.equal(install.disposableOnly, true);
  assert.equal(install.automaticInstall, true);
  assert.equal(install.automaticFromRender, false);
  assert.equal(install.status, "register-apply-after-review");
  const discovery = result.registrations.find((entry) => entry.kind === "plugin-discovery");
  assert.equal(discovery.manualOnly, false);
  assert.equal(discovery.automaticAfterAuthority, true);
  assert.equal(result.registrations.find((entry) => entry.kind === "settings-overlay").automaticWrite, true);
  const manifest = JSON.parse(await readFile(resolve(process.cwd(), "installers/manifests/agy.json"), "utf8"));
  assert.equal(manifest.installation.automaticInstall, true);
  assert.equal(manifest.installation.automaticInstallMode, "register-apply-after-review");
  assert.equal(manifest.installation.automaticFromRender, false);
  assert.equal(manifest.installation.liveProfileWrite, true);
  assert.equal(manifest.installation.liveProfileWriteMode, "register-apply-after-review");
  const readme = fileMap(result).get("README.md");
  assert.match(readme, /agy plugin install PACKAGE_DIRECTORY/u);
  assert.match(readme, /agy plugin list/u);
  assert.match(readme, /register --apply/u);
  assert.match(readme, /agy agents/u);
  assert.match(readme, /agy models/u);
  assert.doesNotMatch(readme, /plugin validate|plugin dry-run|plugin version/iu);
});

test("all canonical action mappings are explicit manual-unknown diagnostics", async () => {
  for (const actionId of ["aaa:design", "aaa:build", "aaa:fix", "aaa:review", "aaa:audit", "aaa:improve-skill", "aaa:resume", "aaa:verify"]) {
    const mapping = adapter.AGY_ACTION_MAPPINGS[actionId];
    assert.ok(mapping);
    assert.equal(mapping.supported, false);
    assert.equal(mapping.support, "manual-unknown");
    assert.equal(mapping.status, "unknown");
    assert.match(mapping.manualStep, /manual|verifying/iu);
  }
  const manifest = JSON.parse(await readFile(resolve(process.cwd(), "installers/manifests/agy.json"), "utf8"));
  for (const actionId of Object.keys(adapter.AGY_ACTION_MAPPINGS)) assert.equal(manifest.actions[actionId].status, "unknown");
  const rendered = adapter.renderSurface({ core, profile: { id: "portable" }, statuslineName: "" });
  assert.equal(rendered.diagnostics.filter((entry) => entry.code === "native-mapping-explicitly-unsupported").length, Object.keys(adapter.AGY_ACTION_MAPPINGS).length);
});

test("native acceptance records verified agy 1.1.22 checks without promoting untested behavior", async () => {
  const acceptance = JSON.parse(await readFile(resolve(process.cwd(), "installers/manifests/agy.json"), "utf8")).nativeValidation;
  assert.equal(acceptance.status, "partial");
  assert.equal(acceptance.productVersion, "1.1.22");
  assert.equal(acceptance.executablePath, "%LOCALAPPDATA%/agy/bin/agy.exe");
  assert.equal(acceptance.platform, "win32");
  assert.equal(acceptance.checkedAt, "2026-08-31");
  const checks = new Map(acceptance.checks.map((check) => [check.id, check.status]));
  for (const passed of ["version", "model-discovery", "effort-help", "headless-model", "plugin-validation", "statusline-renderer", "agent-selection"]) assert.equal(checks.get(passed), "pass", passed);
  for (const notRun of ["plugin-install", "skill-runtime-discovery", "hook-execution", "settings-merge", "model-persistence"]) assert.equal(checks.get(notRun), "not run", notRun);
  assert.equal(checks.get("agent-list"), "inconclusive");
  assert.deepEqual(acceptance.manualSequence, ["agy --help", "agy models", "agy agents", "agy plugin list"]);
  assert.equal(acceptance.disposablePackageInstall, "agy plugin install PACKAGE_DIRECTORY");
  const rendered = resultFor().registrations.find((entry) => entry.kind === "native-acceptance");
  assert.equal(rendered.status, "partial");
  assert.equal(rendered.productVersion, "1.1.22");
  assert.equal(rendered.checks.find((check) => check.id === "plugin-validation").status, "pass");
  assert.equal(rendered.platform, "win32");
  const darwinRender = resultFor("portable", { platform: "darwin", configRoot: "/tmp/agy-config" });
  const retainedWindowsEvidence = darwinRender.registrations.find((entry) => entry.kind === "native-acceptance");
  assert.equal(retainedWindowsEvidence.platform, "win32");
  assert.match(retainedWindowsEvidence.reason, /Windows evidence/iu);
  assert.equal(retainedWindowsEvidence.checks.find((check) => check.id === "statusline-renderer").status, "pass");
  assert.match(retainedWindowsEvidence.checks.find((check) => check.id === "statusline-renderer").evidence, /Windows/iu);
});

test("agy renders deterministic ownership hashes matching both snapshots", async () => {
  for (const profile of ["portable", "template"]) {
    const first = resultFor(profile);
    const second = resultFor(profile);
    assert.deepEqual(first.files.map((file) => ({ ...file, content: [...file.content] })), second.files.map((file) => ({ ...file, content: [...file.content] })));
    assert.deepEqual(first.registrations, second.registrations);
    assert.deepEqual(first.diagnostics, second.diagnostics);
    assert.deepEqual(first.ownership, second.ownership);
    const snapshot = JSON.parse(await readFile(resolve(process.cwd(), `tests/snapshots/agy/${profile}.json`), "utf8"));
    assert.doesNotMatch(JSON.stringify(snapshot), /(?:[A-Za-z]:\/Users\/|\/Users\/)/u, "snapshot must not contain an ambient user home");
    assert.equal(snapshot.fileCount, first.files.length);
    assert.deepEqual(snapshot.paths, first.files.map((file) => file.relativePath));
    assert.deepEqual(snapshot.ownership, first.ownership);
    assert.deepEqual(snapshot.registrations, first.registrations);
    assert.deepEqual(snapshot.diagnostics, first.diagnostics);
    assert.ok(snapshot.contentHashes);
    for (const file of first.files) {
      const hash = sha256(file.content);
      assert.equal(snapshot.contentHashes[file.relativePath], hash, file.relativePath);
    }
  }
});
