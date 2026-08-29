import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import test from "node:test";

import { classifyEmergencyAction, DEFAULT_RULE_IDS } from "../../installers/lib/emergency-policy.mjs";
import { loadCore } from "../../installers/lib/load-core.mjs";
import { renderClaude } from "../../adapters/claude/adapter.mjs";
import { renderCodex } from "../../adapters/codex/adapter.mjs";
import { renderAntigravity } from "../../adapters/antigravity-2/adapter.mjs";
import { renderAgy } from "../../adapters/agy/adapter.mjs";

const requiredOutputs = [
  "core/hooks/emergency-guard.json",
  "core/hooks/emergency-guard.mjs",
  "installers/lib/emergency-policy.mjs",
  "adapters/claude/templates/hooks/emergency-guard.json",
  "adapters/codex/templates/hooks/emergency-guard.json",
  "adapters/antigravity-2/templates/hooks/emergency-guard.json",
  "adapters/agy/templates/hooks/emergency-guard.json",
  "tests/contracts/emergency-guard.test.mjs",
  "tests/fixtures/emergency-actions.json"
];

test("T014 creates every owned artifact", async () => {
  assert.ok(requiredOutputs.length > 0);
  for (const relativePath of requiredOutputs) {
    await access(resolve(process.cwd(), relativePath));
  }
});

const fixture = JSON.parse(await readFile(resolve(process.cwd(), "tests/fixtures/emergency-actions.json"), "utf8"));

test("emergency policy keeps canonical rule order and classifies every fixture", async () => {
  const policy = JSON.parse(await readFile(resolve(process.cwd(), "core/hooks/emergency-guard.json"), "utf8"));
  assert.deepEqual(policy.orderedRuleIds, DEFAULT_RULE_IDS);
  assert.deepEqual(policy.rules.map((rule) => rule.id), DEFAULT_RULE_IDS);
  for (const entry of fixture.cases) {
    const result = classifyEmergencyAction({ ...entry.action, policy });
    assert.equal(result.decision, entry.expected.decision, entry.id);
    assert.equal(result.ruleId, entry.expected.ruleId, entry.id);
    assert.ok(typeof result.reason === "string" && result.reason.length > 0, entry.id);
    assert.ok([...result.reason].length <= policy.reasonLimit, entry.id);
    assert.doesNotMatch(result.reason, /API_TOKEN|id_ed25519|example\.invalid|tester/iu, entry.id);
  }
});

test("emergency policy does not grant containment from malformed or incomplete proof", () => {
  const base = { capability: "filesystem-delete", command: "rm -rf /tmp/aaa-disposable/generated-fixture", paths: ["/tmp/aaa-disposable/generated-fixture"] };
  for (const verifiedDisposableRoot of [undefined, null, {}, { resolvedPath: "/tmp/aaa-disposable" }, { resolvedPath: "/tmp/aaa-disposable", resolved: true }, { resolvedPath: "relative", resolved: true, allTargetsContained: true }]) {
    const result = classifyEmergencyAction({ ...base, verifiedDisposableRoot });
    assert.deepEqual({ decision: result.decision, ruleId: result.ruleId }, { decision: "deny", ruleId: "filesystem-root-erasure" });
  }
});

test("emergency policy rejects traversal even when a containment proof is marked resolved", () => {
  const result = classifyEmergencyAction({
    capability: "filesystem-delete",
    command: "rm -rf /tmp/aaa-disposable/../outside",
    paths: ["/tmp/aaa-disposable/../outside"],
    verifiedDisposableRoot: {
      resolvedPath: "/tmp/aaa-disposable",
      resolved: true,
      allTargetsContained: true,
      targets: ["/tmp/aaa-disposable/../outside"]
    }
  });
  assert.deepEqual({ decision: result.decision, ruleId: result.ruleId }, { decision: "deny", ruleId: "filesystem-root-erasure" });
});

test("emergency policy remains bounded and total for hostile path data", () => {
  const hostile = [
    `rm -rf "/tmp/quoted ${String.fromCodePoint(0x1f680)}"`,
    "rm -rf \\?\\C:\\Users\\tester\\fixture:stream",
    "rm -rf /tmp/../tmp/fixture",
    "printf \\u001b[31m$TOKEN\\u001b[0m"
  ];
  for (const command of hostile) {
    const result = classifyEmergencyAction({ capability: "command-execution", command, paths: ["/tmp/fixture"] });
    assert.ok(["allow", "deny"].includes(result.decision));
    assert.ok(result.ruleId === null || DEFAULT_RULE_IDS.includes(result.ruleId));
    assert.ok([...result.reason].length <= 160);
    assert.doesNotMatch(result.reason, /TOKEN|tester|fixture/iu);
  }
});

function fileMap(result) {
  return new Map(result.files.map((file) => [file.relativePath, new TextDecoder().decode(file.content)]));
}

async function materialize(result, packageRoot) {
  for (const file of result.files) {
    const target = join(packageRoot, ...file.relativePath.split("/"));
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, file.content);
  }
}

function runHandler(executable, args, input) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(executable, args, { cwd: tmpdir() });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`emergency handler exited ${code}: ${Buffer.concat(stderr).toString("utf8")}`));
      else resolveResult(JSON.parse(Buffer.concat(stdout).toString("utf8")));
    });
    child.stdin.end(`${JSON.stringify(input)}\n`);
  });
}

const core = await loadCore(process.cwd());

test("automatic adapters consume the emergency template and copy the production policy wrapper", () => {
  const claude = renderClaude({ core, profile: { id: "portable" }, statuslineName: "" });
  const claudeFiles = fileMap(claude);
  const claudeHooks = JSON.parse(claudeFiles.get("hooks/hooks.json"));
  const claudeGuard = claudeHooks.hooks.PreToolUse[0].hooks[0];
  assert.equal(claudeGuard.type, "command");
  assert.deepEqual(claudeGuard.args.slice(1), ["--surface", "claude", "--policy-path", "${CLAUDE_PLUGIN_ROOT}/hooks/emergency-guard.json"]);
  assert.ok(claudeFiles.has("hooks/emergency-policy.mjs"));
  assert.ok(claudeFiles.has("hooks/emergency-guard.mjs"));
  assert.deepEqual(JSON.parse(claudeFiles.get("hooks/emergency-guard.json")).orderedRuleIds, DEFAULT_RULE_IDS);

  const codex = renderCodex({ core, profile: { id: "portable" } });
  const codexFiles = fileMap(codex);
  const codexHooks = JSON.parse(codexFiles.get("hooks/hooks.json"));
  const codexGuard = codexHooks.hooks.PreToolUse[0].hooks[0];
  assert.match(codexGuard.command, /\$PLUGIN_ROOT\/hooks\/emergency-guard\.mjs/u);
  assert.match(codexGuard.commandWindows, /%PLUGIN_ROOT%\/hooks\/emergency-guard\.mjs/u);
  assert.ok(codexFiles.has("hooks/emergency-policy.mjs"));
  assert.ok(codexFiles.has("hooks/emergency-guard.mjs"));
  assert.deepEqual(JSON.parse(codexFiles.get("hooks/emergency-guard.json")).orderedRuleIds, DEFAULT_RULE_IDS);
});

test("rendered Claude and Codex guard wrappers deny emergency commands and defer allowed commands", async () => {
  const packages = [
    { surface: "claude", result: renderClaude({ core, profile: { id: "portable" }, statuslineName: "" }) },
    { surface: "codex", result: renderCodex({ core, profile: { id: "portable" } }) }
  ];
  for (const { surface, result } of packages) {
    const packageRoot = await mkdtemp(join(tmpdir(), `t014-${surface}-`));
    try {
      await materialize(result, packageRoot);
      const wrapper = join(packageRoot, "hooks", "emergency-guard.mjs");
      const policy = join(packageRoot, "hooks", "emergency-guard.json");
      const denied = await runHandler(process.execPath, [wrapper, "--surface", surface, "--policy-path", policy], { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "git push origin main --force" }, tool_use_id: "opaque-id" });
      assert.deepEqual(denied, { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "Denied: force-push would rewrite shared Git history." } });
      const allowed = await runHandler(process.execPath, [wrapper, "--surface", surface, "--policy-path", policy], { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "git status --short" } });
      assert.deepEqual(allowed, {});
      const malformed = await runHandler(process.execPath, [wrapper, "--surface", surface, "--policy-path", policy], { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: `printf \"quoted ${String.fromCodePoint(0x1f680)}\"` } });
      assert.deepEqual(malformed, {});
      const bareRoot = await runHandler(process.execPath, [wrapper, "--surface", surface, "--policy-path", policy, "--verified-disposable-root", "/tmp/aaa-disposable"], { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "rm -rf /tmp/aaa-disposable/generated-fixture" } });
      assert.deepEqual(bareRoot, { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "Denied: broad or unresolved filesystem erasure is an emergency action." } });
    } finally {
      await rm(packageRoot, { recursive: true, force: true });
    }
  }
});

test("Desktop and agy adapters consume native emergency templates as explicit probe-only diagnostics", async () => {
  const cases = [
    { result: renderAntigravity({ core, profile: { id: "portable" }, statuslineName: "" }), path: ".agents/plugins/all-about-agents/hooks/emergency-guard.json", template: "adapters/antigravity-2/templates/hooks/emergency-guard.json", registrationSurface: "antigravity-2" },
    { result: renderAgy({ core, profile: { id: "portable" }, statuslineName: "" }), path: "emergency-guard.json", template: "adapters/agy/templates/hooks/emergency-guard.json", registrationSurface: "agy" }
  ];
  for (const item of cases) {
    const output = JSON.parse(fileMap(item.result).get(item.path));
    const expected = JSON.parse(await readFile(resolve(process.cwd(), item.template), "utf8"));
    assert.equal(output.surface, item.registrationSurface);
    assert.equal(output.automatic, false);
    assert.equal(output.probeRequired, true);
    assert.deepEqual(output.probe, expected.probe);
    assert.doesNotMatch(JSON.stringify(output), /"command"\s*:|\.\/hooks|%PLUGIN_ROOT%|\$PLUGIN_ROOT/iu);
    const registration = item.result.registrations.find((entry) => entry.kind === "hook-contract");
    assert.equal(registration.automaticHookExecution, false);
    assert.equal(registration.probeRequired, true);
    assert.equal(registration.enabled, false);
  }
});
