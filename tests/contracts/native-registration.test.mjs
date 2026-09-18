import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, relative } from "node:path";
import test, { after } from "node:test";

import { planNativeRegistration, runNativeRegistration, resolveNativeInstructionRoot } from "../../installers/lib/native-registration.mjs";
import { renderClaudeStatuslineCommand } from "../../adapters/claude/adapter.mjs";
import { hashBytes } from "../../installers/lib/hash.mjs";

const GENERATED_TEMP_ROOTS = new Set();

async function generatedTempRoot(prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  GENERATED_TEMP_ROOTS.add(root);
  return root;
}

after(async () => {
  for (const root of [...GENERATED_TEMP_ROOTS]) {
    if (resolve(dirname(root)) !== resolve(tmpdir()) || !basename(root).startsWith("aaa-t06-")) throw new Error("refusing unsafe native-registration fixture cleanup");
    await rm(root, { recursive: true, force: true });
  }
});

async function fixture(profile = "template") {
  const root = await generatedTempRoot("aaa-t06-");
  const packageRoot = join(root, "package");
  const productRoot = join(root, "product");
  await mkdir(packageRoot);
  await mkdir(productRoot, { recursive: true });
  await mkdir(join(packageRoot, ".claude-plugin"));
  await mkdir(join(packageRoot, ".codex-plugin"));
  await mkdir(join(packageRoot, ".agents", "plugins"), { recursive: true });
  await mkdir(join(packageRoot, ".agents", "plugins", "all-about-agents"), { recursive: true });
  await mkdir(join(packageRoot, "all-about-agents"), { recursive: true });
  await mkdir(join(packageRoot, "agents"), { recursive: true });
  await mkdir(join(packageRoot, "statusline"), { recursive: true });
  await writeFile(join(packageRoot, ".claude-plugin", "plugin.json"), "{}\n");
  await writeFile(join(packageRoot, ".claude-plugin", "marketplace.json"), "{}\n");
  await writeFile(join(packageRoot, ".codex-plugin", "plugin.json"), "{}\n");
  await writeFile(join(packageRoot, ".agents", "plugins", "marketplace.json"), "{}\n");
  await writeFile(join(packageRoot, ".agents", "plugins", "all-about-agents", "plugin.json"), "{}\n");
  await writeFile(join(packageRoot, "settings.json"), '{"permissions":{"defaultMode":"bypassPermissions"},"statusLine":{"type":"command","command":"stale-package-root-command"}}\n');
  await writeFile(join(packageRoot, "CLAUDE.md"), "# Global instructions\n");
  await writeFile(join(packageRoot, "all-about-agents", "statusline.json"), '{"schemaVersion":1,"displayName":"Test"}\n');
  await writeFile(join(packageRoot, "statusline", "statusline.mjs"), "// renderer\n");
  await writeFile(join(packageRoot, "statusline", "track-tool.mjs"), "// tracker\n");
  await writeFile(join(packageRoot, "statusline", "statusline.ps1"), "# windows launcher\n");
  await writeFile(join(packageRoot, "statusline", "statusline.sh"), "#!/bin/sh\n# posix launcher\n");
  await writeFile(join(packageRoot, "AGENTS.md"), "# Global instructions\n");
  await writeFile(join(packageRoot, "config.toml"), 'model = "gpt-5.6-sol"\n');
  await writeFile(join(packageRoot, "terra-max.config.toml"), 'model = "gpt-5.6-terra"\n');
  for (const role of ["architect", "implementer", "investigator", "researcher", "reviewer", "security-reviewer", "verifier"]) {
    await writeFile(join(packageRoot, "agents", `${role}.toml`), `developer_instructions = "${role}"\n`);
  }
  const ownedPaths = (await treeBytes(packageRoot)).map(([relativePath, content]) => ({
    relativePath: relativePath.replaceAll("\\", "/"),
    sha256: hashBytes(Buffer.from(content, "base64"))
  })).sort((left, right) => left.relativePath === right.relativePath ? 0 : left.relativePath < right.relativePath ? -1 : 1);
  await mkdir(join(packageRoot, ".all-about-agents"), { recursive: true });
  await writeFile(join(packageRoot, ".all-about-agents", "state.json"), `${JSON.stringify({
    schemaVersion: 1,
    repositoryVersion: "test-repository",
    profile,
    surfaces: ["claude", "codex"],
    ownedPaths
  })}\n`);
  return { root, packageRoot, productRoot };
}

async function treeBytes(root) {
  const { readdir } = await import("node:fs/promises");
  const result = [];
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else result.push([relative(root, path), (await readFile(path)).toString("base64")]);
    }
  }
  await visit(root);
  return result.sort((left, right) => left[0].localeCompare(right[0]));
}

function base(input, surface) {
  return planNativeRegistration({
    surface,
    packageRoot: input.packageRoot,
    productRoot: input.productRoot,
    instructionRoot: input.productRoot,
    profile: "template",
    platform: process.platform,
    rendered: { files: [], registrations: [{ executable: "rm", args: ["-rf", "/"] }] }
  });
}

test("planner creates deterministic known actions for every surface", async () => {
  const input = await fixture();
  const expected = {
    claude: ["claude-instructions-deploy", "claude-settings-deploy", "claude-statusline-config-deploy", "claude-statusline-renderer-deploy", "claude-statusline-tracker-deploy", "claude-statusline-windows-launcher-deploy", "claude-statusline-posix-launcher-deploy", "claude-marketplace-add", "claude-plugin-install", "claude-plugin-list", "claude-reload"],
    codex: ["codex-instructions-deploy", "codex-config-deploy", "codex-terra-profile-deploy", "codex-agent-architect-deploy", "codex-agent-implementer-deploy", "codex-agent-investigator-deploy", "codex-agent-researcher-deploy", "codex-agent-reviewer-deploy", "codex-agent-security-reviewer-deploy", "codex-agent-verifier-deploy", "codex-marketplace-add", "codex-plugin-install", "codex-plugin-list", "codex-hooks-trust"]
  };
  for (const [surface, ids] of Object.entries(expected)) {
    const plan = base(input, surface);
    assert.deepEqual(plan.actions.map((action) => action.id), ids);
    assert.equal(plan.schemaVersion, 1);
    assert.equal(plan.surface, surface);
    assert.equal(plan.lifecycle.registered.status, "not-run");
    assert.match(plan.lifecycle.rendered.evidence, /required marker regular files/iu);
  }
});

test("planner records Claude trust as unavailable because no native trust step exists", async () => {
  const input = await fixture();
  const claude = base(input, "claude");
  assert.equal(claude.lifecycle.trusted.status, "not-run-unavailable");
  assert.match(claude.lifecycle.trusted.evidence, /no separate native trust step/iu);
  for (const surface of ["codex"]) {
    assert.equal(base(input, surface).lifecycle.trusted.status, "not-run");
  }
});

test("planner returns an authentic deeply frozen execution plan", async () => {
  const input = await fixture();
  const plan = base(input, "codex");
  assert.ok(Object.isFrozen(plan));
  assert.ok(Object.isFrozen(plan.actions));
  assert.ok(Object.isFrozen(plan.actions[0]));
  const processAction = plan.actions.find((action) => action.kind === "process");
  assert.ok(Object.isFrozen(processAction.args));
  assert.ok(Object.isFrozen(processAction.environmentKeys));
  assert.ok(Object.isFrozen(plan.lifecycle));
  assert.ok(Object.isFrozen(plan.lifecycle.registered));
  assert.throws(() => processAction.args.push("forged"), TypeError);
  assert.throws(() => { plan.lifecycle.registered.status = "pass"; }, TypeError);
  assert.equal(processAction.args.at(-1), "--json");
  assert.equal(plan.lifecycle.registered.status, "not-run");
});

test("executor rejects forged plans without invoking an arbitrary executable", async () => {
  const input = await fixture();
  const marker = join(input.root, "forged-executed.txt");
  const forged = {
    schemaVersion: 1,
    surface: "codex",
    profile: "template",
    packageRoot: input.packageRoot,
    productRoot: input.productRoot,
    actions: [{
      id: "forged-process",
      kind: "process",
      executable: process.execPath,
      args: ["-e", `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "bad")`],
      cwd: input.packageRoot,
      environmentKeys: [],
      expectedProbe: "none",
      required: true,
      mutates: true
    }],
    lifecycle: {}
  };
  let calls = 0;
  await assert.rejects(
    () => runNativeRegistration(forged, { mode: "apply", runProcess: async () => { calls += 1; } }),
    (error) => error.code === "untrusted-plan"
  );
  assert.equal(calls, 0);
  await assert.rejects(() => readFile(marker));
});

test("planner emits exact structured argv and ignores rendered executable metadata", async () => {
  const input = await fixture();
  const codex = base(input, "codex");
  assert.deepEqual(codex.actions.filter((action) => action.kind === "process").map(({ executable, args, cwd, environmentKeys }) => ({ executable, args, cwd, environmentKeys })), [
    { executable: "codex", args: ["plugin", "marketplace", "add", input.packageRoot, "--json"], cwd: input.packageRoot, environmentKeys: ["CODEX_HOME"] },
    { executable: "codex", args: ["plugin", "add", "all-about-agents@all-about-agents", "--json"], cwd: input.packageRoot, environmentKeys: ["CODEX_HOME"] },
    { executable: "codex", args: ["plugin", "list", "--available", "--json"], cwd: input.packageRoot, environmentKeys: ["CODEX_HOME"] }
  ]);
  assert.equal(codex.actions.some((action) => action.executable === "rm"), false);
  const claude = base(input, "claude");
  assert.deepEqual(claude.actions.filter((action) => action.kind === "process").map((action) => action.args), [
    ["plugin", "marketplace", "add", input.packageRoot, "--scope", "user"],
    ["plugin", "install", "all-about-agents@all-about-agents", "--scope", "user"],
    ["plugin", "list", "--json"]
  ]);
});

test("shared product config is merged or refused, never clobbered", async () => {
  const input = await fixture();
  const settings = base(input, "claude").actions.find((action) => action.id === "claude-settings-deploy");
  assert.equal(settings.kind, "settings-overlay");
  assert.equal(settings.targetPath, resolve(input.productRoot, "settings.json"));
  assert.equal(settings.overlayPath, resolve(input.packageRoot, "settings.json"));
  assert.equal(settings.transform, "claude-statusline-product-root");
  assert.equal(settings.automaticWrite, true);

  const config = base(input, "codex").actions.find((action) => action.id === "codex-config-deploy");
  assert.equal(config.kind, "file-copy");
  assert.equal(config.guard, "no-clobber");
});

test("native instruction roots map to the documented surface roots", async () => {
  const home = process.platform === "win32" ? "C:\\Users\\fixture" : "/Users/fixture";
  assert.equal(resolveNativeInstructionRoot("claude", { env: {}, homeDir: home, platform: process.platform }), process.platform === "win32" ? "C:\\Users\\fixture\\.claude" : "/Users/fixture/.claude");
  assert.equal(resolveNativeInstructionRoot("codex", { env: {}, homeDir: home, platform: process.platform }), process.platform === "win32" ? "C:\\Users\\fixture\\.codex" : "/Users/fixture/.codex");
});

test("planner deploys the Claude and Codex runtime config needed by the installed package", async () => {
  const input = await fixture();
  const claudeCopies = base(input, "claude").actions.filter((action) => action.kind === "file-copy");
  assert.deepEqual(claudeCopies.map(({ sourcePath, targetPath, mode, transform }) => [relative(input.packageRoot, sourcePath), relative(input.productRoot, targetPath), mode, transform ?? null]), [
    ["CLAUDE.md", "CLAUDE.md", null, null],
    [join("all-about-agents", "statusline.json"), join("all-about-agents", "statusline.json"), null, null],
    [join("statusline", "statusline.mjs"), join("statusline", "statusline.mjs"), 0o755, null],
    [join("statusline", "track-tool.mjs"), join("statusline", "track-tool.mjs"), 0o755, null],
    [join("statusline", "statusline.ps1"), join("statusline", "statusline.ps1"), null, null],
    [join("statusline", "statusline.sh"), join("statusline", "statusline.sh"), 0o755, null]
  ]);
  const codexCopies = base(input, "codex").actions.filter((action) => action.kind === "file-copy");
  assert.deepEqual(codexCopies.slice(0, 3).map(({ sourcePath, targetPath }) => [relative(input.packageRoot, sourcePath), relative(input.productRoot, targetPath)]), [
    ["AGENTS.md", "AGENTS.md"],
    ["config.toml", "config.toml"],
    ["terra-max.config.toml", "terra-max.config.toml"]
  ]);
  assert.equal(codexCopies.filter((action) => /codex-agent-.+-deploy/u.test(action.id)).length, 7);
});

test("planner rejects unsupported surfaces, profiles, unsafe roots, and symlink roots", async () => {
  const input = await fixture();
  assert.throws(() => planNativeRegistration({ ...input, surface: "unknown", profile: "template" }), (error) => error.code === "unsupported-surface");
  assert.throws(() => planNativeRegistration({ ...input, surface: "codex", profile: "unknown" }), (error) => error.code === "invalid-profile");
  const traversal = `${input.packageRoot}${process.platform === "win32" ? "\\" : "/"}..`;
  assert.throws(() => planNativeRegistration({ ...input, surface: "codex", packageRoot: traversal, profile: "template" }), (error) => error.code === "root-traversal");
  assert.throws(() => planNativeRegistration({ ...input, surface: "codex", packageRoot: "relative-package", profile: "template" }), (error) => error.code === "invalid-root");
  assert.throws(() => planNativeRegistration({ ...input, surface: "codex", productRoot: `${input.productRoot}${process.platform === "win32" ? "\\" : "/"}..`, profile: "template" }), (error) => error.code === "root-traversal");
  const outside = await generatedTempRoot("aaa-t06-outside-");
  const link = join(input.root, "package-link");
  try { await (await import("node:fs/promises")).symlink(outside, link, process.platform === "win32" ? "junction" : "dir"); } catch { return; }
  assert.throws(() => planNativeRegistration({ ...input, surface: "codex", packageRoot: link, profile: "template" }), /symlink|unsafe|root/u);
});

test("planner binds registration to managed surface, profile, and owned hashes", async () => {
  const template = await fixture("template");
  assert.throws(
    () => planNativeRegistration({ surface: "claude", packageRoot: template.packageRoot, productRoot: template.productRoot, profile: "portable" }),
    (error) => error.code === "package-profile-mismatch"
  );
  const portable = await fixture("portable");
  assert.throws(
    () => planNativeRegistration({ surface: "codex", packageRoot: portable.packageRoot, productRoot: portable.productRoot, profile: "template" }),
    (error) => error.code === "package-profile-mismatch"
  );
  await writeFile(join(template.packageRoot, "settings.json"), '{"tampered":true}\n');
  assert.throws(
    () => planNativeRegistration({ surface: "claude", packageRoot: template.packageRoot, productRoot: template.productRoot, profile: "template" }),
    (error) => error.code === "package-owned-hash-mismatch"
  );
  await rm(join(portable.packageRoot, ".all-about-agents", "state.json"));
  assert.throws(
    () => planNativeRegistration({ surface: "codex", packageRoot: portable.packageRoot, productRoot: portable.productRoot, profile: "portable" }),
    (error) => error.code === "package-state-missing"
  );
});

test("planning errors keep local absolute paths out of diagnostics", async () => {
  const input = await fixture();
  const missingPackage = join(input.root, "missing-package");
  assert.throws(
    () => planNativeRegistration({ ...input, surface: "codex", packageRoot: missingPackage, profile: "template" }),
    (error) => error.code === "invalid-root" && !error.message.includes(missingPackage)
  );
});

test("apply stops at the first required process failure and reports a partial result", async () => {
  const input = await fixture();
  const plan = base(input, "codex");
  const calls = [];
  const report = await runNativeRegistration(plan, {
    mode: "apply",
    runProcess: async (request) => {
      calls.push(request);
      return { exitCode: calls.length === 1 ? 0 : 23, stdout: "{}", stderr: "native failure" };
    }
  });
  assert.equal(report.status, "partial");
  assert.equal(report.completed.length, 11);
  assert.equal(report.failed.action.id, "codex-plugin-install");
  assert.deepEqual(report.notAttempted.map((action) => action.id), ["codex-plugin-list", "codex-hooks-trust"]);
  assert.deepEqual(calls[0].args, ["plugin", "marketplace", "add", input.packageRoot, "--json"]);
  assert.deepEqual(calls[0].environmentKeys, ["CODEX_HOME"]);
  assert.equal(calls[0].env, undefined);
  assert.equal(calls[0].envOverrides.CODEX_HOME, input.productRoot);
  assert.equal(calls[0].shell, false);
  assert.equal(report.lifecycle.registered.status, "fail");
});

test("successful native commands remain registered not-run until semantic discovery is observed", async () => {
  const input = await fixture();
  const report = await runNativeRegistration(base(input, "codex"), {
    mode: "apply",
    runProcess: async () => ({ exitCode: 0, stdout: "{}", stderr: "" })
  });
  assert.equal(report.status, "complete");
  assert.equal(report.lifecycle.validated.status, "not-run");
  assert.equal(report.lifecycle.registered.status, "not-run");
  assert.match(report.lifecycle.registered.evidence, /semantic|discovery|observed/iu);
});

test("successful reports keep manual actions out of completed execution", async () => {
  const input = await fixture();
  const cases = [
    ["codex", ["codex-instructions-deploy", "codex-config-deploy", "codex-terra-profile-deploy", "codex-agent-architect-deploy", "codex-agent-implementer-deploy", "codex-agent-investigator-deploy", "codex-agent-researcher-deploy", "codex-agent-reviewer-deploy", "codex-agent-security-reviewer-deploy", "codex-agent-verifier-deploy", "codex-marketplace-add", "codex-plugin-install", "codex-plugin-list"]],
    ["claude", ["claude-instructions-deploy", "claude-settings-deploy", "claude-statusline-config-deploy", "claude-statusline-renderer-deploy", "claude-statusline-tracker-deploy", "claude-statusline-windows-launcher-deploy", "claude-statusline-posix-launcher-deploy", "claude-marketplace-add", "claude-plugin-install", "claude-plugin-list"]]
  ];
  for (const [surface, executedIds] of cases) {
    const report = await runNativeRegistration(base(input, surface), {
      mode: "apply",
      runProcess: async () => ({ exitCode: 0, stdout: "{}", stderr: "" })
    });
    assert.equal(report.status, "complete");
    assert.deepEqual(report.completed.map((action) => action.id), executedIds);
    assert.equal(report.actions.at(-1).status, "manual-required");
    assert.equal(report.completed.some((action) => action.kind === "manual"), false);
  }
});

test("apply revalidates roots and marker ancestors after planning", async () => {
  const input = await fixture();
  const packagePlan = base(input, "codex");
  const outside = await generatedTempRoot("aaa-t06-revalidation-");
  const markerDir = join(input.packageRoot, ".codex-plugin");
  const markerDirMoved = join(input.root, ".codex-plugin-original");
  try {
    await (await import("node:fs/promises")).rename(markerDir, markerDirMoved);
    await (await import("node:fs/promises")).symlink(outside, markerDir, process.platform === "win32" ? "junction" : "dir");
  } catch {
    return;
  }
  let calls = 0;
  const report = await runNativeRegistration(packagePlan, { mode: "apply", runProcess: async () => { calls += 1; return { exitCode: 0, stdout: "{}" }; } });
  assert.equal(calls, 0);
  assert.equal(report.status, "failed");
  assert.match(report.error.code, /unsafe|symlink|package/u);
});

test("apply rejects a later copy source changed after the initial package scan", async () => {
  const input = await fixture();
  const plan = base(input, "claude");
  const firstSource = join(input.packageRoot, "settings.json");
  const laterSource = join(input.packageRoot, "all-about-agents", "statusline.json");
  let mutated = false;
  let processCalls = 0;
  const report = await runNativeRegistration(plan, {
    mode: "apply",
    runProcess: async () => { processCalls += 1; return { exitCode: 0, stdout: "{}", stderr: "" }; },
    fileSystem: {
      async readFile(path) {
        const content = await readFile(path);
        if (path === firstSource && !mutated) {
          mutated = true;
          await writeFile(laterSource, '{"tampered":true}\n');
        }
        return content;
      }
    }
  });
  assert.equal(report.status, "partial");
  assert.equal(report.failed.action.id, "claude-statusline-config-deploy");
  assert.equal(report.error.code, "package-owned-hash-mismatch");
  assert.equal(processCalls, 0);
  await assert.rejects(() => readFile(join(input.productRoot, "all-about-agents", "statusline.json")));
});

test("apply revalidates non-copy package files before the first native process", async () => {
  const input = await fixture();
  const plan = base(input, "claude");
  const firstSource = join(input.packageRoot, "settings.json");
  const pluginMarker = join(input.packageRoot, ".claude-plugin", "plugin.json");
  let mutated = false;
  let processCalls = 0;
  const report = await runNativeRegistration(plan, {
    mode: "apply",
    runProcess: async () => { processCalls += 1; return { exitCode: 0, stdout: "{}", stderr: "" }; },
    fileSystem: {
      async readFile(path) {
        const content = await readFile(path);
        if (path === firstSource && !mutated) {
          mutated = true;
          await writeFile(pluginMarker, '{"tampered":true}\n');
        }
        return content;
      }
    }
  });
  assert.equal(report.status, "partial");
  assert.equal(report.failed.action.id, "claude-marketplace-add");
  assert.equal(report.error.code, "package-owned-hash-mismatch");
  assert.equal(processCalls, 0);
});

test("apply rejects a product root junction created after planning", async () => {
  const input = await fixture();
  const plan = base(input, "codex");
  const outside = await generatedTempRoot("aaa-t06-product-outside-");
  const moved = join(input.root, "product-original");
  try {
    await (await import("node:fs/promises")).rename(input.productRoot, moved);
    await (await import("node:fs/promises")).symlink(outside, input.productRoot, process.platform === "win32" ? "junction" : "dir");
  } catch {
    return;
  }
  let calls = 0;
  const report = await runNativeRegistration(plan, { mode: "apply", runProcess: async () => { calls += 1; return { exitCode: 0, stdout: "{}" }; } });
  assert.equal(calls, 0);
  assert.equal(report.status, "failed");
  assert.match(report.error.code, /unsafe|root/u);
});

test("registration reports retain argv structure without leaking local roots", async () => {
  const input = await fixture();
  const report = await runNativeRegistration(base(input, "codex"), { mode: "dry-run" });
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes(input.packageRoot), false);
  assert.equal(serialized.includes(input.productRoot), false);
  const marketplace = report.actions.find((action) => action.id === "codex-marketplace-add");
  assert.equal(marketplace.args.length, 5);
  assert.equal(marketplace.args[3], "<PACKAGE_ROOT>");
  assert.equal(report.packageRoot, "<PACKAGE_ROOT>");
  assert.equal(report.productRoot, "<PRODUCT_ROOT>");
});

test("native execution keeps ambient secrets out of requests and reports", async () => {
  const input = await fixture();
  const key = "T06_HOSTILE_AMBIENT_SECRET";
  const secret = "t06-secret-must-not-escape";
  const previous = process.env[key];
  process.env[key] = secret;
  try {
    const requests = [];
    const report = await runNativeRegistration(base(input, "claude"), {
      mode: "apply",
      runProcess: async (request) => {
        requests.push(request);
        return { exitCode: 0, stdout: "{}", stderr: secret };
      }
    });
    assert.equal(report.status, "complete");
    assert.equal(JSON.stringify(requests).includes(secret), false);
    assert.equal(JSON.stringify(report).includes(secret), false);
    assert.equal(requests[0].env, undefined);
    assert.deepEqual(Object.keys(requests[0].envOverrides), ["CLAUDE_CONFIG_DIR"]);
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
});

test("native reports redact Windows path case and separator variants", async () => {
  const input = await fixture();
  const variants = [input.packageRoot, input.productRoot, process.env.USERPROFILE]
    .filter((value) => typeof value === "string" && value.length > 0)
    .map((value) => process.platform === "win32" ? value.replaceAll("\\", "/").toUpperCase() : value);
  const report = await runNativeRegistration(base(input, "claude"), {
    mode: "apply",
    runProcess: async () => { throw new Error(`injected paths: ${variants.join(" | ")}`); }
  });
  const serialized = JSON.stringify(report);
  for (const variant of variants) assert.equal(serialized.includes(variant), false);
  assert.match(serialized, /<PACKAGE_ROOT>|<PRODUCT_ROOT>|<HOME>/u);
});

test("apply reports unavailable and malformed probe output without leaking stdout", async () => {
  const input = await fixture();
  const unavailable = await runNativeRegistration(base(input, "claude"), { mode: "apply", runProcess: async () => ({ unavailable: true, exitCode: null, stdout: "secret", stderr: "ENOENT" }) });
  assert.equal(unavailable.status, "partial");
  assert.equal(unavailable.error.code, "native-executable-unavailable");
  assert.doesNotMatch(JSON.stringify(unavailable), /secret/u);
  const malformed = await runNativeRegistration(base(input, "codex"), { mode: "apply", runProcess: async () => ({ exitCode: 0, stdout: "not-json", stderr: "" }) });
  assert.equal(malformed.status, "partial");
  assert.equal(malformed.failed.action.id, "codex-marketplace-add");
  assert.match(malformed.failed.reason, /JSON/u);
  const empty = await runNativeRegistration(base(input, "codex"), { mode: "apply", runProcess: async () => ({ exitCode: 0, stdout: "", stderr: "" }) });
  assert.equal(empty.failed.error.code, "malformed-native-json");
});

test("apply stops on a timed-out native process and does not run later actions", async () => {
  const input = await fixture();
  const calls = [];
  const report = await runNativeRegistration(base(input, "codex"), { mode: "apply", runProcess: async (request) => { calls.push(request); return { timedOut: true, exitCode: null, stdout: "", stderr: "" }; } });
  assert.equal(report.status, "partial");
  assert.equal(report.failed.error.code, "native-process-timeout");
  assert.equal(calls.length, 1);
  assert.deepEqual(report.notAttempted.map((action) => action.id), ["codex-plugin-install", "codex-plugin-list", "codex-hooks-trust"]);
});

test("apply atomically overwrites approved Claude and Codex config destinations", async () => {
  const input = await fixture();
  await writeFile(join(input.productRoot, "CLAUDE.md"), "old instructions\n");
  await writeFile(join(input.productRoot, "settings.json"), '{"old":true}\n');
  const claude = await runNativeRegistration(base(input, "claude"), {
    mode: "apply",
    runProcess: async () => ({ exitCode: 0, stdout: "{}", stderr: "" })
  });
  assert.equal(claude.status, "complete");
  assert.equal(await readFile(join(input.productRoot, "CLAUDE.md"), "utf8"), "# Global instructions\n");
  const productEntries = await (await import("node:fs/promises")).readdir(input.productRoot);
  assert.equal(productEntries.some((entry) => entry.includes("backup")), false);
  const installedClaudeSettings = JSON.parse(await readFile(join(input.productRoot, "settings.json"), "utf8"));
  assert.deepEqual(installedClaudeSettings.permissions, { defaultMode: "bypassPermissions" });
  assert.equal(installedClaudeSettings.statusLine.command, renderClaudeStatuslineCommand({ configRoot: input.productRoot, platform: process.platform }));
  assert.notEqual(installedClaudeSettings.statusLine.command, "stale-package-root-command");
  assert.equal(await readFile(join(input.productRoot, "all-about-agents", "statusline.json"), "utf8"), '{"schemaVersion":1,"displayName":"Test"}\n');
  assert.equal(await readFile(join(input.productRoot, "statusline", "statusline.mjs"), "utf8"), "// renderer\n");
  assert.equal(await readFile(join(input.productRoot, "statusline", "track-tool.mjs"), "utf8"), "// tracker\n");
  assert.equal(await readFile(join(input.productRoot, "statusline", "statusline.ps1"), "utf8"), "# windows launcher\n");
  assert.equal(await readFile(join(input.productRoot, "statusline", "statusline.sh"), "utf8"), "#!/bin/sh\n# posix launcher\n");

  const codex = await runNativeRegistration(base(input, "codex"), {
    mode: "apply",
    runProcess: async () => ({ exitCode: 0, stdout: "{}", stderr: "" })
  });
  assert.equal(codex.status, "complete");
  assert.equal(await readFile(join(input.productRoot, "config.toml"), "utf8"), 'model = "gpt-5.6-sol"\n');
  assert.equal(await readFile(join(input.productRoot, "terra-max.config.toml"), "utf8"), 'model = "gpt-5.6-terra"\n');
  assert.equal(await readFile(join(input.productRoot, "agents", "reviewer.toml"), "utf8"), 'developer_instructions = "reviewer"\n');
});
