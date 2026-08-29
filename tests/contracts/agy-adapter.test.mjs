import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { loadCore } from "../../installers/lib/load-core.mjs";
import { AdapterContractError } from "../../adapters/shared/adapter-contract.mjs";

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

function resultFor(profile = "portable", overrides = {}) {
  return adapter.renderAgy({
    core,
    profile: { id: profile },
    statuslineName: "",
    platform: "win32",
    ...overrides
  });
}

function fileMap(result) {
  return new Map(result.files.map((file) => [file.relativePath, new TextDecoder().decode(file.content)]));
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

test("agy renders a strict documented plugin manifest", () => {
  const manifest = JSON.parse(fileMap(resultFor()).get("plugin.json"));
  assert.deepEqual(Object.keys(manifest).sort(), ["$schema", "description", "name"]);
  assert.equal(manifest.$schema, "https://antigravity.google/schemas/v1/plugin.json");
  assert.equal(manifest.name, "all-about-agents");
  assert.equal(typeof manifest.description, "string");
});

test("agy renders nested agents and every canonical skill and rule", () => {
  const files = fileMap(resultFor());
  for (const role of ["researcher", "investigator", "architect", "implementer", "verifier", "reviewer", "security-reviewer"]) {
    assert.ok(files.has(`agents/${role}/agent.md`), `missing nested agent ${role}`);
  }
  for (const skill of core.inventory.skills) assert.ok(files.has(`skills/${skill}/SKILL.md`), `missing canonical skill ${skill}`);
  for (const rule of core.rules) assert.ok(files.has(`rules/${rule.id}.md`), `missing canonical rule ${rule.id}`);
  for (const path of [
    "rules/adapter-capability-guidance.md",
    "rules/model-selection.md",
    "rules/permission-safety.md",
    "rules/hook-contract.md",
    "rules/settings-overlay.md"
  ]) assert.ok(files.has(path), path);
});

test("agy agents use only documented frontmatter fields and no guessed tools", () => {
  const files = fileMap(resultFor());
  for (const role of ["researcher", "investigator", "architect", "implementer", "verifier", "reviewer", "security-reviewer"]) {
    const frontmatter = files.get(`agents/${role}/agent.md`).split("---\n")[1];
    const fields = frontmatter.trim().split("\n").map((line) => line.match(/^([A-Za-z][A-Za-z0-9]*):/u)?.[1]);
    for (const field of fields) assert.ok(adapter.AGY_DOCUMENTED_AGENT_FIELDS.includes(field), `${role} has undocumented field ${field}`);
    assert.match(frontmatter, /^tools: \[\]$/mu);
    assert.match(frontmatter, /^model: inherit$/mu);
    assert.match(frontmatter, /^mcpServers: \[\]$/mu);
    assert.match(frontmatter, /^skills: \[\]$/mu);
    assert.match(frontmatter, /^plugins: \[\]$/mu);
  }
});

test("agy read-only roles cannot execute or mutate", () => {
  const files = fileMap(resultFor());
  for (const role of ["researcher", "investigator", "architect", "verifier", "reviewer", "security-reviewer"]) {
    const content = files.get(`agents/${role}/agent.md`);
    assert.match(content, /^tools: \[\]$/mu);
    assert.match(content, /^commandExecutionPolicy: off$/mu);
  }
  assert.match(files.get("agents/implementer/agent.md"), /^commandExecutionPolicy: sandbox$/mu);
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
  assert.match(guidance, /probe below[\s\S]*lifecycle schema/iu);
  assert.match(hookRule, /probe-required|lifecycle payload parity/iu);
  assert.doesNotMatch(hookRule, /PreInvocation\s+contract/u);
  assert.equal(resultFor().registrations.find((entry) => entry.kind === "hook-contract").automaticHookExecution, false);
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
  const allowed = new Set(["toolPermission", "artifactReviewPolicy", "allowNonWorkspaceAccess", "enableTerminalSandbox", "permissions"]);
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
  assert.equal(registration.status, "manual-discovery-required");
  assert.match(registration.reason, /unknown|version-sensitive/iu);
  assert.doesNotMatch(JSON.stringify(rendered), /~\/\.gemini\/config\/config\.json/u);

  const manifest = JSON.parse(await readFile(resolve(process.cwd(), "installers/manifests/agy.json"), "utf8"));
  assert.deepEqual(manifest.settingsOverlay.destinationCandidates, ["~/.gemini/antigravity-cli/settings.json"]);
  assert.doesNotMatch(JSON.stringify(manifest), /~\/\.gemini\/config\/config\.json/u);
  assert.doesNotMatch(JSON.stringify(manifest), /~\/\.gemini\/antigravity\//u);
  assert.equal(manifest.settingsOverlay.automaticWrite, false);
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
  const files = fileMap(resultFor());
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
  const prompt = `Say "hi" with spaces, an apostrophe ' and a backslash ${String.fromCharCode(92)}`;
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
    const poisonedCore = { ...core, skills: [{ id: "poisoned", content: `---\ndescription: poisoned\n---\n\n${poison}\n` }] };
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

test("manual registrations use documented commands and never write a live profile", () => {
  const result = resultFor();
  const commands = result.registrations.map((entry) => entry.command).filter(Boolean);
  for (const command of ["agy plugin install PACKAGE_DIRECTORY", "agy plugin list", "agy agents", "agy models"]) assert.ok(commands.includes(command), command);
  const install = result.registrations.find((entry) => entry.kind === "plugin-registration");
  assert.equal(install.manualOnly, true);
  assert.equal(install.disposableOnly, true);
  assert.equal(install.automaticInstall, false);
  assert.equal(result.registrations.find((entry) => entry.kind === "settings-overlay").automaticWrite, false);
  const readme = fileMap(result).get("README.md");
  assert.match(readme, /agy plugin install PACKAGE_DIRECTORY/u);
  assert.match(readme, /agy plugin list/u);
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
  assert.throws(() => adapter.renderSurface({ core, profile: { id: "portable" }, statuslineName: "" }), (error) => error instanceof AdapterContractError && error.errors.some((entry) => entry.code === "unsupported-native-mapping"));
});

test("native acceptance is not run and records exact later manual sequence", async () => {
  const acceptance = JSON.parse(await readFile(resolve(process.cwd(), "installers/manifests/agy.json"), "utf8")).nativeValidation;
  assert.equal(acceptance.status, "not run");
  assert.equal(acceptance.productVersion, "unknown");
  assert.equal(acceptance.executablePath, "unknown");
  assert.equal(acceptance.platform, "unknown");
  assert.equal(acceptance.reason, "Native acceptance was not run for this repository render; no native executable was invoked.");
  assert.doesNotMatch(acceptance.reason, /not on PATH|absent.*PATH/iu);
  assert.deepEqual(acceptance.manualSequence, ["agy --help", "agy models", "agy agents", "agy plugin list"]);
  assert.equal(acceptance.disposablePackageInstall, "agy plugin install PACKAGE_DIRECTORY");
  const rendered = resultFor().registrations.find((entry) => entry.kind === "native-acceptance");
  assert.equal(rendered.status, "not run");
  assert.equal(rendered.platform, "win32");
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
