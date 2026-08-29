import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import test from "node:test";

import { classifyEmergencyAction, DEFAULT_RULE_IDS } from "../../installers/lib/emergency-policy.mjs";
import { buildNativeDecision, normalizeNativeRequest } from "../../core/hooks/emergency-guard.mjs";
import { loadCore } from "../../installers/lib/load-core.mjs";
import { renderClaude } from "../../adapters/claude/adapter.mjs";
import { renderCodex } from "../../adapters/codex/adapter.mjs";
import { mapAntigravityEmergencyDecision, normalizeAntigravityEmergencyRequest, renderAntigravity } from "../../adapters/antigravity-2/adapter.mjs";
import { mapAgyEmergencyDecision, normalizeAgyEmergencyRequest, renderAgy } from "../../adapters/agy/adapter.mjs";

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
const emergencyPolicy = JSON.parse(await readFile(resolve(process.cwd(), "core/hooks/emergency-guard.json"), "utf8"));

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

test("emergency policy never accepts incomplete, reordered, duplicated, or unknown rule policies", () => {
  const forcePush = { capability: "command-execution", command: "git push origin main --force" };
  const invalidPolicies = [
    { orderedRuleIds: ["git-discard-uncommitted"] },
    { orderedRuleIds: ["unknown-rule"] },
    { orderedRuleIds: [...DEFAULT_RULE_IDS.slice(0, 2), ...DEFAULT_RULE_IDS.slice(3), "guardrail-bypass"] },
    { orderedRuleIds: [...DEFAULT_RULE_IDS, "duplicate-rule"] }
  ];
  for (const policy of invalidPolicies) {
    const result = classifyEmergencyAction({ ...forcePush, policy });
    assert.deepEqual({ decision: result.decision, ruleId: result.ruleId }, { decision: "deny", ruleId: "git-force-push" });
  }
  const reordered = classifyEmergencyAction({
    capability: "filesystem-delete",
    command: "rm -rf / && git push origin main --force",
    paths: ["/"],
    policy: { orderedRuleIds: [...DEFAULT_RULE_IDS.slice(1), DEFAULT_RULE_IDS[0]] }
  });
  assert.deepEqual({ decision: reordered.decision, ruleId: reordered.ruleId }, { decision: "deny", ruleId: "filesystem-root-erasure" });
});

test("emergency policy rejects broad, device, UNC, and namespace roots despite containment proof", () => {
  const roots = [
    ["/tmp", "/tmp/generated"],
    ["C:/", "C:/generated"],
    ["/home/tester/disposable", "/home/tester/disposable/generated"],
    ["/workspace/project", "/workspace/project/generated"],
    ["//server/share/disposable", "//server/share/disposable/generated"],
    ["//?/C:/tmp/disposable", "//?/C:/tmp/disposable/generated"],
    ["//./PhysicalDrive0", "//./PhysicalDrive0/generated"]
  ];
  for (const [resolvedPath, target] of roots) {
    const result = classifyEmergencyAction({
      capability: "filesystem-delete",
      command: `rm -rf ${target}`,
      paths: [{ path: target, kind: "generated" }],
      verifiedDisposableRoot: { resolvedPath, resolved: true, allTargetsContained: true, designation: "disposable", targets: [target] }
    });
    assert.deepEqual({ decision: result.decision, ruleId: result.ruleId }, { decision: "deny", ruleId: "filesystem-root-erasure" }, resolvedPath);
  }
});

test("emergency policy rejects root-relative Windows disposable proofs", () => {
  const result = classifyEmergencyAction({
    capability: "filesystem-delete",
    command: "rm -rf \\disposable\\generated",
    paths: ["\\disposable\\generated"],
    verifiedDisposableRoot: {
      resolvedPath: "\\disposable",
      resolved: true,
      allTargetsContained: true,
      designation: "disposable",
      targets: ["\\disposable\\generated"]
    }
  });
  assert.deepEqual({ decision: result.decision, ruleId: result.ruleId }, { decision: "deny", ruleId: "filesystem-root-erasure" });
});

test("emergency policy does not exempt a benign format segment from later raw-disk destruction", () => {
  for (const command of ["format text; diskpart delete partition", "format json; Remove-Partition -DiskNumber 0"]) {
    const result = classifyEmergencyAction({ command });
    assert.deepEqual({ decision: result.decision, ruleId: result.ruleId }, { decision: "deny", ruleId: "raw-disk-destruction" }, command);
  }
});

test("emergency policy recursively inspects shell interpreter payloads without executing them", () => {
  const cases = [
    ["sh -c 'rm -rf /'", "filesystem-root-erasure"],
    ["sh -c 'git push origin main --force'", "git-force-push"],
    ["sh -c 'git restore .'", "git-discard-uncommitted"],
    ["bash -c 'env'", "secret-output-or-transmission"]
  ];
  for (const [command, ruleId] of cases) {
    const result = classifyEmergencyAction({ command });
    assert.deepEqual({ decision: result.decision, ruleId: result.ruleId }, { decision: "deny", ruleId }, command);
  }
});

test("emergency policy does not treat format-like arguments as raw-disk operations", () => {
  for (const command of ['echo "format text"', 'git commit -m "format text"', "npm run format"]) {
    const result = classifyEmergencyAction({ command });
    assert.deepEqual({ decision: result.decision, ruleId: result.ruleId }, { decision: "allow", ruleId: null }, command);
  }
  const destructive = classifyEmergencyAction({ command: "format C:" });
  assert.deepEqual({ decision: destructive.decision, ruleId: destructive.ruleId }, { decision: "deny", ruleId: "raw-disk-destruction" });
});

test("emergency policy classifies structured Git operation metadata", () => {
  const forcePush = classifyEmergencyAction({ command: "git status", gitOperation: { push: { args: ["--force"] } } });
  assert.deepEqual({ decision: forcePush.decision, ruleId: forcePush.ruleId }, { decision: "deny", ruleId: "git-force-push" });
  const rebase = classifyEmergencyAction({ command: "git status", gitOperation: { rebase: { args: ["main"] } } });
  assert.deepEqual({ decision: rebase.decision, ruleId: rebase.ruleId }, { decision: "deny", ruleId: "git-history-rewrite" });
  const discard = classifyEmergencyAction({ command: "git status", gitOperation: { checkout: { args: ["README"] } } });
  assert.deepEqual({ decision: discard.decision, ruleId: discard.ruleId }, { decision: "deny", ruleId: "git-discard-uncommitted" });
  for (const [command, ruleId] of [
    ["git clean -fdx", "git-discard-uncommitted"],
    ["git reset --hard", "git-discard-uncommitted"],
    ["git stash clear", "git-discard-uncommitted"],
    ["git reflog expire --all", "git-history-rewrite"],
    ["git commit --amend", "git-history-rewrite"]
  ]) {
    const result = classifyEmergencyAction({ command: "git status", gitOperation: { command } });
    assert.deepEqual({ decision: result.decision, ruleId: result.ruleId }, { decision: "deny", ruleId }, command);
  }
  const benign = classifyEmergencyAction({ command: "git status", gitOperation: { command: "git status", args: ["--short"] } });
  assert.deepEqual({ decision: benign.decision, ruleId: benign.ruleId }, { decision: "allow", ruleId: null });
  const splitCommand = classifyEmergencyAction({ command: "git status", gitOperation: { command: "git", args: ["push", "origin", "main", "--force"] } });
  assert.deepEqual({ decision: splitCommand.decision, ruleId: splitCommand.ruleId }, { decision: "deny", ruleId: "git-force-push" });
});

test("emergency policy classifies structured secret operation resources", () => {
  const resourceUrl = classifyEmergencyAction({ command: "read", secretOperation: { operation: "read", resource: { url: "/tmp/.env" } } });
  assert.deepEqual({ decision: resourceUrl.decision, ruleId: resourceUrl.ruleId }, { decision: "deny", ruleId: "secret-credential-access" });
  const resourceName = classifyEmergencyAction({ command: "print", secretOperation: { operation: "print", resource: { name: "API_TOKEN" } } });
  assert.deepEqual({ decision: resourceName.decision, ruleId: resourceName.ruleId }, { decision: "deny", ruleId: "secret-output-or-transmission" });
});

function firstFixturePath(action) {
  const first = Array.isArray(action.paths) ? action.paths[0] : null;
  return typeof first === "string" ? first : first && typeof first === "object" ? first.resolvedPath || first.path || first.filePath || "" : "";
}

function fixtureCommand(action) {
  if (typeof action.gitOperation === "string") return action.gitOperation;
  if (typeof action.secretOperation === "string") return action.secretOperation;
  if (typeof action.command === "string") return action.command;
  if (action.gitOperation && typeof action.gitOperation.operation === "string") return action.gitOperation.operation;
  if (action.secretOperation && typeof action.secretOperation.operation === "string") return action.secretOperation.operation;
  return "";
}

test("all emergency fixtures agree across canonical and four documented adapter decision seams", () => {
  for (const entry of fixture.cases) {
    const action = entry.action;
    const command = fixtureCommand(action);
    const path = firstFixturePath(action);
    const claudeRequest = {
      hook_event_name: "PreToolUse",
      tool_name: command ? "Bash" : "Read",
      tool_input: { ...(command ? { command } : {}), ...(path ? { file_path: path } : {}) }
    };
    const claudeNormalized = normalizeNativeRequest("claude", claudeRequest);
    const codexNormalized = normalizeNativeRequest("codex", claudeRequest);
    const antigravityRequest = {
      toolCall: { name: command ? "run_command" : "read_file", args: { ...(command ? { CommandLine: command } : {}), ...(path ? { filePath: path } : {}) } },
      stepIdx: 1
    };
    const antigravityNormalized = normalizeAntigravityEmergencyRequest(antigravityRequest);
    const agyNormalized = normalizeAgyEmergencyRequest(antigravityRequest);
    assert.ok(claudeNormalized && codexNormalized && antigravityNormalized && agyNormalized, entry.id);
    const canonical = classifyEmergencyAction({ ...action, policy: emergencyPolicy });
    assert.deepEqual({ decision: canonical.decision, ruleId: canonical.ruleId }, entry.expected, entry.id);
    const normalizedInputs = [claudeNormalized, codexNormalized, antigravityNormalized, agyNormalized];
    for (const normalized of normalizedInputs) {
      const classification = classifyEmergencyAction({
        ...normalized,
        paths: action.paths || normalized.paths,
        gitOperation: action.gitOperation ?? normalized.gitOperation,
        secretOperation: action.secretOperation ?? normalized.secretOperation,
        verifiedDisposableRoot: action.verifiedDisposableRoot,
        policy: emergencyPolicy
      });
      assert.deepEqual({ decision: classification.decision, ruleId: classification.ruleId }, entry.expected, `${entry.id} normalized`);
    }
    const nativeClaude = buildNativeDecision("claude", canonical);
    const nativeCodex = buildNativeDecision("codex", canonical);
    const nativeAntigravity = mapAntigravityEmergencyDecision(canonical);
    const nativeAgy = mapAgyEmergencyDecision(canonical);
    if (entry.expected.decision === "deny") {
      assert.equal(nativeClaude.hookSpecificOutput.permissionDecision, "deny", entry.id);
      assert.equal(nativeCodex.hookSpecificOutput.permissionDecision, "deny", entry.id);
      assert.deepEqual(nativeAntigravity, { decision: "deny", reason: canonical.reason }, entry.id);
      assert.deepEqual(nativeAgy, { decision: "deny", reason: canonical.reason }, entry.id);
    } else {
      assert.deepEqual(nativeClaude, {}, entry.id);
      assert.deepEqual(nativeCodex, {}, entry.id);
      assert.deepEqual(nativeAntigravity, {}, entry.id);
      assert.deepEqual(nativeAgy, {}, entry.id);
    }
  }
});

test("native decision mappers derive bounded reasons from canonical rule IDs", () => {
  const forged = { decision: "deny", ruleId: "git-force-push", reason: "attacker-controlled secret path" };
  const expectedReason = "Denied: force-push would rewrite shared Git history.";
  assert.equal(buildNativeDecision("claude", forged).hookSpecificOutput.permissionDecisionReason, expectedReason);
  assert.equal(buildNativeDecision("codex", forged).hookSpecificOutput.permissionDecisionReason, expectedReason);
  assert.deepEqual(mapAntigravityEmergencyDecision(forged), { decision: "deny", reason: expectedReason });
  assert.deepEqual(mapAgyEmergencyDecision(forged), { decision: "deny", reason: expectedReason });
  const unknown = { decision: "deny", ruleId: "unrecognized-rule", reason: "arbitrary" };
  assert.deepEqual(buildNativeDecision("claude", unknown), {});
  assert.deepEqual(buildNativeDecision("codex", unknown), {});
  assert.deepEqual(mapAntigravityEmergencyDecision(unknown), {});
  assert.deepEqual(mapAgyEmergencyDecision(unknown), {});
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
      const tamperedPolicy = JSON.parse(await readFile(policy, "utf8"));
      tamperedPolicy.orderedRuleIds = ["git-discard-uncommitted"];
      await writeFile(policy, JSON.stringify(tamperedPolicy));
      const tampered = await runHandler(process.execPath, [wrapper, "--surface", surface, "--policy-path", policy], { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "git push origin main --force" } });
      assert.deepEqual(tampered, { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "Denied: force-push would rewrite shared Git history." } });
      await writeFile(policy, fileMap(result).get("hooks/emergency-guard.json"));
      for (const entry of fixture.cases) {
        const action = entry.action;
        const command = fixtureCommand(action);
        const path = firstFixturePath(action);
        const wrapperArgs = [wrapper, "--surface", surface, "--policy-path", policy];
        if (action.verifiedDisposableRoot) wrapperArgs.push("--verified-disposable-root", JSON.stringify(action.verifiedDisposableRoot));
        const native = await runHandler(process.execPath, wrapperArgs, { hook_event_name: "PreToolUse", tool_name: command ? "Bash" : "Read", tool_input: { ...(command ? { command } : {}), ...(path ? { file_path: path } : {}) } });
        if (entry.expected.decision === "deny") {
          assert.equal(native.hookSpecificOutput?.permissionDecision, "deny", `${surface}:${entry.id}`);
          assert.equal(native.hookSpecificOutput?.permissionDecisionReason, classifyEmergencyAction({ ...action, policy: emergencyPolicy }).reason, `${surface}:${entry.id}`);
        } else {
          assert.deepEqual(native, {}, `${surface}:${entry.id}`);
        }
      }
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
    assert.equal(item.result.files.some((file) => /(?:^|\/)emergency-(?:guard|policy)\.mjs$/u.test(file.relativePath)), false);
    const registration = item.result.registrations.find((entry) => entry.kind === "hook-contract");
    assert.equal(registration.automaticHookExecution, false);
    assert.equal(registration.probeRequired, true);
    assert.equal(registration.enabled, false);
  }
});
