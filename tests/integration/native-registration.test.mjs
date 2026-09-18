import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { access, lstat, mkdir, mkdtemp, readdir, readFile, readlink, realpath, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import test from "node:test";

import { planNativeRegistration, runNativeRegistration } from "../../installers/lib/native-registration.mjs";
import { runProcess } from "../../scripts/lib/process-runner.mjs";
import { main } from "../../scripts/aaa.mjs";

const REPOSITORY_ROOT = resolve(process.cwd());
const CLAUDE_FIXTURE = await readFile(resolve(REPOSITORY_ROOT, "tests/fixtures/native-statusline/claude.json"), "utf8");
const CLAUDE_MARKERS = ["CLAUDE.md", ".claude-plugin/plugin.json", ".claude-plugin/marketplace.json", "statusline/statusline.mjs", "statusline/statusline.ps1", "statusline/statusline.sh", "all-about-agents/statusline.json"];
const CODEX_MARKERS = [".codex-plugin/plugin.json", ".agents/plugins/marketplace.json", "hooks/hooks.json", "hooks/bootstrap.mjs"];
const CODEX_HOOK_FILES = ["hooks/hooks.json", "hooks/bootstrap.mjs", "hooks/activity-audit.mjs", "hooks/pre-compact.mjs", "hooks/audit-log.mjs"];

function contained(root, target) {
  const canonicalize = process.platform === "win32" && typeof realpathSync.native === "function" ? realpathSync.native : realpathSync;
  const canonical = (value) => {
    try { return canonicalize(value); } catch { return resolve(value); }
  };
  const rootPath = canonical(root);
  const targetPath = canonical(target);
  const suffix = relative(process.platform === "win32" ? rootPath.toLowerCase() : rootPath, process.platform === "win32" ? targetPath.toLowerCase() : targetPath);
  return suffix === "" || (isAbsolute(suffix) === false && suffix !== ".." && !suffix.startsWith(`..${sep}`));
}

function assertContained(root, target, label) {
  assert.equal(contained(root, target), true, `${label} must stay inside the disposable root`);
}

async function pathExists(path) {
  return access(path).then(() => true, () => false);
}

async function auditTreeContainment(root, directory = root) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = join(directory, entry.name);
    assertContained(root, target, `cleanup entry ${entry.name}`);
    const metadata = await lstat(target);
    if (metadata.isSymbolicLink()) {
      const linkTarget = resolve(dirname(target), await readlink(target));
      assertContained(root, linkTarget, `cleanup symlink target ${entry.name}`);
    } else if (metadata.isDirectory()) {
      await auditTreeContainment(root, target);
    }
  }
}

async function removeDisposableRoot(target, { remove = rm } = {}) {
  await remove(target, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100
  });
}

async function withDisposableRoot(callback) {
  const createdRoot = await mkdtemp(join(tmpdir(), "aaa-t07-native-"));
  const root = await realpath(createdRoot);
  const canonicalTemp = await realpath(tmpdir());
  assertContained(canonicalTemp, root, "OS temporary root");
  try {
    return await callback(root);
  } finally {
    const metadata = await lstat(createdRoot);
    assert.equal(metadata.isSymbolicLink(), false, "cleanup target must not be a symlink");
    const canonicalRoot = await realpath(createdRoot);
    assertContained(canonicalTemp, canonicalRoot, "canonical cleanup target");
    await auditTreeContainment(canonicalRoot);
    await removeDisposableRoot(createdRoot);
    assert.equal(await pathExists(createdRoot), false, "disposable root must be removed after the check");
  }
}

test("T10 disposable native cleanup retries transient Windows lock errors", async () => {
  let observed = null;
  await removeDisposableRoot("disposable-root", {
    remove: async (target, options) => {
      observed = { target, options };
    }
  });
  assert.deepEqual(observed, {
    target: "disposable-root",
    options: { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }
  });
});

async function captureAaa(args, runtime = {}) {
  let stdout = "";
  let stderr = "";
  const code = await main(args, { write: (value) => { stdout += value; } }, { write: (value) => { stderr += value; } }, runtime);
  return { code, stdout, stderr };
}

async function renderPackage(surface, profile, destinationRoot) {
  assertContained(resolve(destinationRoot, ".."), destinationRoot, `${surface} package root`);
  const args = ["install", "--surface", surface, "--profile", profile];
  if (surface === "claude") args.push("--statusline-name", `T07 ${surface} fixture`);
  args.push("--destination-root", destinationRoot, "--apply", "--format", "json");
  const result = await captureAaa(args);
  assert.equal(result.code, 0, `${surface}/${profile} render failed: ${safeStatus(result.stderr, [destinationRoot])}`);
  assert.equal(result.stderr, "");
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "complete");
  return report;
}

async function assertMarkers(root, markers) {
  for (const marker of markers) {
    const target = resolve(root, ...marker.split("/"));
    assertContained(root, target, marker);
    await access(target);
  }
}

async function listFiles(root) {
  const result = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = join(directory, entry.name);
      assertContained(root, target, entry.name);
      if (entry.isSymbolicLink()) {
        const linkTarget = resolve(dirname(target), await readlink(target));
        assertContained(root, linkTarget, `symlink target for ${entry.name}`);
        continue;
      }
      if (entry.isDirectory()) await visit(target);
      else result.push(relative(root, target).replaceAll("\\", "/"));
    }
  }
  await visit(root);
  return result.sort();
}

const PASSTHROUGH_ENVIRONMENT_KEYS = ["PATH", "Path", "PATHEXT", "SystemRoot", "ComSpec", "WINDIR", "ProgramFiles", "ProgramFiles(x86)"];
const ROOT_ENVIRONMENT_KEYS = ["HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "XDG_CONFIG_HOME", "TEMP", "TMP", "TMPDIR"];
const NATIVE_ROOT_ENVIRONMENT_KEYS = new Set(["CLAUDE_CONFIG_DIR", "CODEX_HOME"]);

function isolatedEnvironment(root, overrides = {}) {
  assert.equal(typeof root, "string");
  assert.equal(isAbsolute(root), true, "isolated environment root must be absolute");
  assertContained(tmpdir(), root, "isolated environment root");
  const environment = {};
  for (const key of PASSTHROUGH_ENVIRONMENT_KEYS) {
    if (typeof process.env[key] === "string") environment[key] = process.env[key];
  }
  for (const key of ROOT_ENVIRONMENT_KEYS) environment[key] = root;
  if (overrides === null || typeof overrides !== "object" || Array.isArray(overrides)) throw new TypeError("isolated environment overrides must be an object");
  for (const [key, value] of Object.entries(overrides)) {
    if (![...ROOT_ENVIRONMENT_KEYS, ...NATIVE_ROOT_ENVIRONMENT_KEYS].includes(key)) throw new TypeError(`environment key is not allowed: ${key}`);
    if (typeof value !== "string" || value.includes("\0")) throw new TypeError(`environment value is invalid: ${key}`);
    if (NATIVE_ROOT_ENVIRONMENT_KEYS.has(key) || ROOT_ENVIRONMENT_KEYS.includes(key)) assertContained(root, value, key);
    environment[key] = value;
  }
  environment.GIT_CONFIG_NOSYSTEM = "1";
  environment.GIT_TERMINAL_PROMPT = "0";
  return environment;
}

function minimalEnvironment(root, overrides = {}) {
  return isolatedEnvironment(root, overrides);
}

function literalPattern(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function redactSensitive(value, roots = []) {
  let output = String(value ?? "");
  output = output.replace(/Bearer\s+[^\s,;]+/giu, "Bearer <REDACTED>");
  output = output.replace(/(?:api[_-]?key|token|secret|password|authorization)\s*[:=]\s*[^\s,;]+/giu, "$1=<REDACTED>");
  output = output.replace(/\b(?:sk|ghp|github_pat|xox[baprs])-?[A-Za-z0-9_-]{12,}\b/gu, "<REDACTED_TOKEN>");
  output = output.replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/gu, "<REDACTED_PRIVATE_KEY>");
  const userPaths = [homedir(), process.env.USERPROFILE, process.env.HOMEDRIVE && process.env.HOMEPATH ? join(process.env.HOMEDRIVE, process.env.HOMEPATH) : null, ...roots];
  for (const path of userPaths.filter((candidate) => typeof candidate === "string" && candidate.length > 0).sort((left, right) => right.length - left.length)) {
    output = output.replace(new RegExp(literalPattern(path), "giu"), "<USER_PATH>");
  }
  return output;
}

function sanitizedText(value, roots = [], maxChars = 64 * 1024) {
  return redactSensitive(value, roots)
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maxChars);
}

function safeStatus(value, roots = []) {
  return sanitizedText(value, roots, 160);
}

function safeStatuslineOutput(value) {
  return redactSensitive(value)
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu, "")
    .replace(/\r\n?/gu, "\n")
    .trim();
}

function versionText(output) {
  return safeStatus(String(output).split(/\r?\n/u, 1)[0]);
}

function authRequired(result) {
  return result?.exitCode !== undefined && result.exitCode !== null && result.exitCode !== 0
    && /(?:authenticate|authentication|login|credential|unauthori[sz]ed|sign[ -]?in)/iu.test(`${result.stdout}\n${result.stderr}`);
}

const PLUGIN_SELECTOR = "all-about-agents@all-about-agents";

function parseInstalledPluginList(stdout, product) {
  let payload;
  try { payload = JSON.parse(String(stdout)); } catch { return null; }
  const entries = product === "claude"
    ? payload
    : payload && typeof payload === "object" && !Array.isArray(payload) ? payload.installed : null;
  if (!Array.isArray(entries)) return null;
  const entry = entries.find((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
    if (product === "claude") {
      return candidate.id === PLUGIN_SELECTOR
        && candidate.scope === "user"
        && candidate.enabled === true
        && typeof candidate.installPath === "string";
    }
    return candidate.pluginId === PLUGIN_SELECTOR
      && candidate.name === "all-about-agents"
      && candidate.installed === true
      && candidate.enabled === true;
  });
  if (!entry) return null;
  return {
    selector: product === "claude" ? entry.id : entry.pluginId,
    name: product === "claude" ? entry.id.split("@", 1)[0] : entry.name,
    installed: product === "claude" ? true : entry.installed,
    enabled: entry.enabled,
    installedPath: product === "claude" ? entry.installPath : null
  };
}

function parseCodexInstall(stdout) {
  let payload;
  try { payload = JSON.parse(String(stdout)); } catch { return null; }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  if (payload.pluginId !== PLUGIN_SELECTOR || payload.name !== "all-about-agents" || typeof payload.installedPath !== "string") return null;
  return { selector: payload.pluginId, name: payload.name, installedPath: payload.installedPath };
}

function installedPluginRoot(productRoot, discovery) {
  if (!discovery || typeof discovery.installedPath !== "string") return null;
  const target = isAbsolute(discovery.installedPath)
    ? resolve(discovery.installedPath)
    : resolve(productRoot, discovery.installedPath);
  assertContained(productRoot, target, "discovered plugin path");
  return target;
}

async function skipSubtest(parent, name, reason) {
  await parent.test(name, async (subtest) => {
    const message = `status=NOT_RUN_UNAVAILABLE reason=${reason}`;
    subtest.diagnostic(message);
    subtest.skip(message);
  });
}

async function runCheckedCommand(parent, name, request, { product, roots = [], parseJson = false } = {}) {
  let outcome = { status: "NOT_RUN_UNAVAILABLE", result: null, reason: "not observed" };
  await parent.test(name, async (subtest) => {
    const result = await runProcess({ ...request, maxOutputBytes: request.maxOutputBytes ?? 256 * 1024 });
    outcome = { status: result.unavailable ? "NOT_RUN_UNAVAILABLE" : "FAIL", result, reason: "command failed" };
    if (result.unavailable) {
      const reason = `${product} executable is unavailable`;
      subtest.diagnostic(`status=NOT_RUN_UNAVAILABLE product=${product} operation=${name}`);
      subtest.skip(reason);
      outcome.reason = reason;
      return;
    }
    assert.equal(result.timedOut, false, `${product} ${name} timed out`);
    assert.equal(result.outputTooLarge, false, `${product} ${name} exceeded the bounded output limit`);
    if (result.exitCode !== 0 && authRequired(result)) {
      const reason = `${product} requested authentication; no login was attempted`;
      subtest.diagnostic(`status=NOT_RUN_UNAVAILABLE product=${product} operation=${name} reason=authentication-required`);
      subtest.skip(reason);
      outcome.reason = reason;
      return;
    }
    assert.ok(Buffer.byteLength(result.stdout ?? "", "utf8") <= 256 * 1024, `${product} ${name} stdout exceeded the retained-output boundary`);
    assert.ok(Buffer.byteLength(result.stderr ?? "", "utf8") <= 256 * 1024, `${product} ${name} stderr exceeded the retained-output boundary`);
    assert.equal(result.exitCode, 0, `${product} ${name} failed: ${safeStatus(result.stderr, roots)}`);
    if (parseJson) assert.doesNotThrow(() => JSON.parse(result.stdout), `${product} ${name} must return JSON`);
    outcome = { status: "PASS", result, reason: "" };
  });
  return outcome;
}

function launcherForPlatform(platform) {
  if (platform === "win32") return "statusline/statusline.ps1";
  if (platform === "darwin" || platform === "linux") return "statusline/statusline.sh";
  throw new TypeError(`unsupported native launcher platform: ${String(platform)}`);
}

async function spawnWithInput({ executable, args, cwd, env, input, maxOutputBytes = 64 * 1024, timeoutMs = 30_000 }) {
  if (!Number.isInteger(maxOutputBytes) || maxOutputBytes <= 0) throw new TypeError("maxOutputBytes must be a positive integer");
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError("timeoutMs must be a positive integer");
  return new Promise((resolveResult, reject) => {
    let child;
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let outputTooLarge = false;
    let timedOut = false;
    let settled = false;
    let forceTimer;
    let settleTimer;
    let terminating = false;
    const terminate = () => {
      if (settled || terminating) return;
      terminating = true;
      child?.kill();
      forceTimer = setTimeout(() => {
        if (settled) return;
        child?.kill("SIGKILL");
        settleTimer = setTimeout(() => finish({ exitCode: null, signal: "SIGKILL" }), 1_000);
        settleTimer.unref?.();
      }, 500);
      forceTimer.unref?.();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(forceTimer);
      clearTimeout(settleTimer);
      resolveResult({ unavailable: false, ...result, stdout, stderr, timedOut, outputTooLarge });
    };
    try {
      child = spawn(executable, args, { cwd, env, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) {
      clearTimeout(timer);
      clearTimeout(forceTimer);
      clearTimeout(settleTimer);
      reject(error);
      return;
    }
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      const bytes = Buffer.byteLength(chunk, "utf8");
      stdoutBytes += bytes;
      if (stdoutBytes > maxOutputBytes) {
        outputTooLarge = true;
        terminate();
      } else stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      const bytes = Buffer.byteLength(chunk, "utf8");
      stderrBytes += bytes;
      if (stderrBytes > maxOutputBytes) {
        outputTooLarge = true;
        terminate();
      } else stderr += chunk;
    });
    child.stdin.on("error", () => {});
    child.once("error", (error) => {
      if (error?.code === "ENOENT") finish({ exitCode: null, unavailable: true });
      else if (!settled) {
        settled = true;
        clearTimeout(timer);
        clearTimeout(forceTimer);
        clearTimeout(settleTimer);
        reject(error);
      }
    });
    child.once("close", (exitCode, signal) => finish({ exitCode, signal }));
    child.stdin.end(input);
  });
}

async function runStatuslineLauncher(root, launcher, input, t, environmentOverrides = {}) {
  const launcherPath = resolve(root, ...launcher.split("/"));
  assertContained(root, launcherPath, "statusline launcher");
  const environment = isolatedEnvironment(root, environmentOverrides);
  const shell = process.platform === "win32" ? await firstAvailable(["pwsh", "powershell"], root, environment) : await firstAvailable(["sh"], root, environment);
  if (!shell) {
    const reason = `status=NOT_RUN_UNAVAILABLE reason=statusline shell is unavailable launcher=${launcher}`;
    t.diagnostic(reason);
    t.skip(reason);
    return null;
  }
  const args = process.platform === "win32"
    ? ["-NoProfile", "-File", launcherPath]
    : [launcherPath];
  const result = await spawnWithInput({ executable: shell, args, cwd: root, env: environment, input });
  assert.equal(result.unavailable, false, `${launcher} shell became unavailable`);
  assert.equal(result.timedOut, false, `${launcher} launcher timed out`);
  assert.equal(result.outputTooLarge, false, `${launcher} output exceeded the bounded capture limit`);
  assert.equal(result.exitCode, 0, `${launcher} failed: ${safeStatus(result.stderr)}`);
  assert.equal(safeStatus(result.stderr), "", `${launcher} must not write diagnostics for valid input`);
  return safeStatuslineOutput(result.stdout);
}

async function firstAvailable(executables, root, env) {
  for (const executable of executables) {
    const probe = await runProcess({ executable, args: ["--version"], cwd: root, env, timeoutMs: 10_000, maxOutputBytes: 64 * 1024 });
    if (!probe.unavailable && !probe.outputTooLarge && probe.exitCode === 0) return executable;
  }
  return null;
}

async function initializeDisposableGitPackage(packageRoot, env) {
  const commands = [
    ["init"],
    ["config", "user.name", "T07 Disposable Test"],
    ["config", "user.email", "t07-disposable@example.invalid"],
    ["add", "."],
    ["commit", "--no-gpg-sign", "-m", "T07 disposable package"]
  ];
  for (const args of commands) {
    const result = await runProcess({ executable: "git", args, cwd: packageRoot, env, timeoutMs: 120_000, maxOutputBytes: 256 * 1024 });
    assert.equal(result.unavailable, false, "git is required to create the disposable local Codex marketplace source");
    assert.equal(result.outputTooLarge, false, "disposable git package setup exceeded the bounded output limit");
    assert.equal(result.exitCode, 0, `disposable git package setup failed: ${safeStatus(result.stderr)}`);
  }
}

async function probeVersion(executable, root, overrides = {}) {
  const result = await runProcess({ executable, args: ["--version"], cwd: root, env: isolatedEnvironment(root, overrides), timeoutMs: 30_000, maxOutputBytes: 64 * 1024 });
  return { ...result, version: versionText(result.stdout || result.stderr) };
}

function isolatedNativeRunner(root, captures) {
  return async (request) => {
    const requestedEnvironment = request.envOverrides ?? {};
    const env = isolatedEnvironment(root, requestedEnvironment);
    const result = await runProcess({
      ...request,
      envOverrides: undefined,
      environmentKeys: undefined,
      env,
      timeoutMs: 120_000,
      maxOutputBytes: 256 * 1024
    });
    captures.push({ executable: request.executable, args: [...request.args], result });
    return result;
  };
}

function capturedResult(captures, expectedArgs) {
  return captures.find(({ args }) => args.length === expectedArgs.length && args.every((value, index) => value === expectedArgs[index]))?.result ?? null;
}

// Review-fix contracts keep the disposable process boundary independently
// testable without invoking a product CLI.
test("T07 helper isolates the allowed environment and never carries ambient secrets", async () => {
  await withDisposableRoot(async (root) => {
    const previous = process.env.T07_AMBIENT_SECRET;
    process.env.T07_AMBIENT_SECRET = "ambient-secret-must-not-cross";
    try {
      const environment = minimalEnvironment(root, { CLAUDE_CONFIG_DIR: root });
      assert.equal(environment.HOME, root);
      assert.equal(environment.USERPROFILE, root);
      assert.equal(environment.CLAUDE_CONFIG_DIR, root);
      assert.equal(environment.T07_AMBIENT_SECRET, undefined);
      const probe = await spawnWithInput({ executable: process.execPath, args: ["-e", "process.stdout.write(process.env.T07_AMBIENT_SECRET || 'absent')"], cwd: root, env: environment, input: "" });
      assert.equal(probe.stdout, "absent");
    } finally {
      if (previous === undefined) delete process.env.T07_AMBIENT_SECRET;
      else process.env.T07_AMBIENT_SECRET = previous;
    }
  });
});

test("T07 helper treats authentication as unavailable only after a failed command", () => {
  assert.equal(authRequired({ exitCode: 0, stdout: "login is not needed", stderr: "" }), false);
  assert.equal(authRequired({ exitCode: 1, stdout: "", stderr: "login required" }), true);
});

test("T07 helper does not accept a lookalike plugin as an exact discovery result", () => {
  assert.equal(parseInstalledPluginList(JSON.stringify([{ id: "all-about-agents-extra@all-about-agents", scope: "user", enabled: true, installPath: "C:/tmp/lookalike" }]), "claude"), null);
  assert.equal(parseInstalledPluginList(JSON.stringify({ installed: [], available: [{ pluginId: PLUGIN_SELECTOR, name: "all-about-agents", installed: true, enabled: true }] }), "codex"), null);
  assert.equal(parseInstalledPluginList(JSON.stringify({ installed: [{ pluginId: PLUGIN_SELECTOR, name: "all-about-agents", installed: false, enabled: false }] }), "codex"), null);
});

test("T07 helper parses only the fixed installed-plugin shape", () => {
  const claudePayload = JSON.stringify([{ id: PLUGIN_SELECTOR, version: "1.0.0", scope: "user", enabled: true, installPath: "C:/T07/claude/plugins/all-about-agents" }]);
  assert.deepEqual(parseInstalledPluginList(claudePayload, "claude"), {
    selector: PLUGIN_SELECTOR,
    name: "all-about-agents",
    installed: true,
    enabled: true,
    installedPath: "C:/T07/claude/plugins/all-about-agents"
  });
  const codexPayload = JSON.stringify({ installed: [{ pluginId: PLUGIN_SELECTOR, name: "all-about-agents", installed: true, enabled: true }], available: [] });
  assert.deepEqual(parseInstalledPluginList(codexPayload, "codex"), {
    selector: PLUGIN_SELECTOR,
    name: "all-about-agents",
    installed: true,
    enabled: true,
    installedPath: null
  });
  assert.deepEqual(parseCodexInstall(JSON.stringify({ pluginId: PLUGIN_SELECTOR, name: "all-about-agents", installedPath: "C:/T07/codex/plugins/all-about-agents" })), {
    selector: PLUGIN_SELECTOR,
    name: "all-about-agents",
    installedPath: "C:/T07/codex/plugins/all-about-agents"
  });
});

test("T07 helper redacts tokens and user paths before diagnostics", () => {
  const output = safeStatus(`token=secret-value Bearer abcdef ${homedir()} sk-1234567890abcdef`);
  assert.equal(output.includes("secret-value"), false);
  assert.equal(output.includes("abcdef"), false);
  assert.equal(output.includes(homedir()), false);
  assert.equal(output.includes("1234567890abcdef"), false);
});

test("T07 helper routes statusline to the host-native launcher", () => {
  assert.equal(launcherForPlatform("win32"), "statusline/statusline.ps1");
  assert.equal(launcherForPlatform("linux"), "statusline/statusline.sh");
  assert.equal(launcherForPlatform("darwin"), "statusline/statusline.sh");
});

test("T07 helper bounds launcher output and reports overflow", async () => {
  await withDisposableRoot(async (root) => {
    const result = await spawnWithInput({
      executable: process.execPath,
      args: ["-e", "process.stdout.write('x'.repeat(4096))"],
      cwd: root,
      env: isolatedEnvironment(root),
      input: "",
      maxOutputBytes: 128,
      timeoutMs: 10_000
    });
    assert.equal(result.outputTooLarge, true);
  });
});

test("T07 helper settles a timed-out launcher", async () => {
  await withDisposableRoot(async (root) => {
    const started = Date.now();
    const result = await spawnWithInput({
      executable: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      cwd: root,
      env: isolatedEnvironment(root),
      input: "",
      timeoutMs: 50
    });
    assert.equal(result.timedOut, true);
    assert.ok(Date.now() - started < 3_000, "timed-out launcher must settle after the hard deadline");
  });
});

test("T07 renders portable and template native packages into separate disposable roots", async () => {
  await withDisposableRoot(async (root) => {
    for (const surface of ["claude", "codex"]) {
      for (const profile of ["portable", "template"]) {
        const packageRoot = resolve(root, `${surface}-${profile}`);
        await renderPackage(surface, profile, packageRoot);
        const markers = surface === "claude" ? CLAUDE_MARKERS : CODEX_MARKERS;
        await assertMarkers(packageRoot, markers);
        const files = await listFiles(packageRoot);
        assert.ok(files.length > 20, `${surface}/${profile} must render a complete package`);
      }
    }
  });
});

test("T07 removes a disposable root after an intentional failure", async () => {
  let removedRoot = null;
  await assert.rejects(
    withDisposableRoot(async (root) => {
      removedRoot = root;
      throw new Error("intentional T07 cleanup probe");
    }),
    /intentional T07 cleanup probe/u
  );
  assert.equal(await pathExists(removedRoot), false);
});

async function observeVersion(parent, product, root) {
  let outcome = { status: "NOT_RUN_UNAVAILABLE", version: "unavailable" };
  await parent.test(`${product} version`, async (subtest) => {
    const result = await probeVersion(product, root);
    if (result.unavailable) {
      const reason = `status=NOT_RUN_UNAVAILABLE product=${product} reason=executable-unavailable`;
      subtest.diagnostic(reason);
      subtest.skip(reason);
      return;
    }
    assert.equal(result.timedOut, false, `${product} --version timed out`);
    assert.equal(result.outputTooLarge, false, `${product} --version exceeded the bounded output limit`);
    assert.equal(result.exitCode, 0, `${product} --version failed: ${safeStatus(result.stderr, [root])}`);
    assert.notEqual(result.version, "", `${product} --version returned no version text`);
    subtest.diagnostic(`status=PASS product=${product} version=${result.version}`);
    outcome = { status: "PASS", version: result.version };
  });
  return outcome;
}

test("T07 Claude validates and discovers exact installed packages in an isolated config root", async (t) => {
  await withDisposableRoot(async (root) => {
    const packages = {};
    for (const profile of ["portable", "template"]) {
      packages[profile] = resolve(root, `claude-${profile}`);
      await renderPackage("claude", profile, packages[profile]);
    }
    const version = await observeVersion(t, "claude", root);
    if (version.status !== "PASS") {
      await skipSubtest(t, "Claude downstream native checks", "Claude Code executable is unavailable on this host");
      return;
    }

    const baseEnvironment = isolatedEnvironment(root);
    for (const [profile, packageRoot] of Object.entries(packages)) {
      await runCheckedCommand(t, `Claude ${profile} strict validation`, {
        executable: "claude",
        args: ["plugin", "validate", packageRoot, "--strict"],
        cwd: root,
        env: baseEnvironment,
        timeoutMs: 120_000
      }, { product: "claude", roots: [root] });
      await t.test(`Claude ${profile} statusline fixture`, async (subtest) => {
        const output = await runStatuslineLauncher(packageRoot, launcherForPlatform(process.platform), CLAUDE_FIXTURE, subtest, { CLAUDE_CONFIG_DIR: packageRoot });
        if (output === null) return;
        assert.equal(output.split(/\r?\n/u).length, 4, "Claude statusline must render four stable lines");
        assert.equal(/T07 claude fixture/iu.test(output), true, "Claude statusline must use the fixture name");
      });
    }

    const configRoot = resolve(root, "claude-config");
    await mkdir(configRoot, { recursive: true });
    const nativeEnvironment = isolatedEnvironment(root, { CLAUDE_CONFIG_DIR: configRoot });
    const marketplace = await runCheckedCommand(t, "Claude isolated marketplace add", {
      executable: "claude",
      args: ["plugin", "marketplace", "add", packages.template, "--scope", "user"],
      cwd: packages.template,
      env: nativeEnvironment,
      timeoutMs: 120_000
    }, { product: "claude", roots: [root] });
    if (marketplace.status !== "PASS") {
      await skipSubtest(t, "Claude isolated plugin install", marketplace.reason);
      await skipSubtest(t, "Claude exact installed-plugin discovery", marketplace.reason);
      return;
    }
    const installed = await runCheckedCommand(t, "Claude isolated plugin install", {
      executable: "claude",
      args: ["plugin", "install", PLUGIN_SELECTOR, "--scope", "user"],
      cwd: packages.template,
      env: nativeEnvironment,
      timeoutMs: 120_000
    }, { product: "claude", roots: [root] });
    if (installed.status !== "PASS") {
      await skipSubtest(t, "Claude exact installed-plugin discovery", installed.reason);
      return;
    }
    const listed = await runCheckedCommand(t, "Claude plugin list JSON", {
      executable: "claude",
      args: ["plugin", "list", "--json"],
      cwd: packages.template,
      env: nativeEnvironment,
      timeoutMs: 120_000
    }, { product: "claude", roots: [root], parseJson: true });
    if (listed.status !== "PASS") {
      await skipSubtest(t, "Claude exact installed-plugin discovery", listed.reason);
      return;
    }
    await t.test("Claude exact installed-plugin discovery", async () => {
      const discovery = parseInstalledPluginList(listed.result.stdout, "claude");
      assert.notEqual(discovery, null, "Claude list JSON must contain the exact enabled installed plugin entry");
      assert.deepEqual({ selector: discovery.selector, name: discovery.name, installed: discovery.installed, enabled: discovery.enabled }, {
        selector: PLUGIN_SELECTOR,
        name: "all-about-agents",
        installed: true,
        enabled: true
      });
      const installedRoot = installedPluginRoot(configRoot, discovery);
      await assertMarkers(installedRoot, [".claude-plugin/plugin.json", "hooks/hooks.json"]);
    });
  });
});

test("T07 Codex registration uses only an isolated CODEX_HOME and exact installed discovery", async (t) => {
  await withDisposableRoot(async (root) => {
    const packageRoot = resolve(root, "codex-template");
    const codexHome = resolve(root, "codex-home");
    await renderPackage("codex", "template", packageRoot);
    await mkdir(codexHome, { recursive: true });
    await t.test("Codex disposable marketplace Git source", async () => {
      await initializeDisposableGitPackage(packageRoot, isolatedEnvironment(root));
    });
    const version = await observeVersion(t, "codex", root);
    if (version.status !== "PASS") {
      await skipSubtest(t, "Codex isolated registration", "Codex executable is unavailable on this host");
      await skipSubtest(t, "Codex exact installed-plugin and hook discovery", "Codex executable is unavailable on this host");
      return;
    }

    const captures = [];
    let report = null;
    let registrationStatus = "FAIL";
    await t.test("Codex isolated registration", async (subtest) => {
      const plan = planNativeRegistration({ surface: "codex", packageRoot, productRoot: codexHome, profile: "template", platform: process.platform });
      report = await runNativeRegistration(plan, { mode: "apply", runProcess: isolatedNativeRunner(root, captures) });
      if (report.status !== "complete") {
        const failedResult = captures.at(-1)?.result;
        if (failedResult?.unavailable || authRequired(failedResult)) {
          const reason = failedResult?.unavailable ? "executable-unavailable" : "authentication-required";
          subtest.diagnostic(`status=NOT_RUN_UNAVAILABLE product=codex operation=registration reason=${reason}`);
          subtest.skip(`Codex registration unavailable: ${reason}`);
          registrationStatus = "NOT_RUN_UNAVAILABLE";
          return;
        }
      }
      assert.equal(report.status, "complete", `Codex registration failed: ${safeStatus(report.error?.message, [root])}`);
      assert.equal(report.lifecycle.registered.status, "not-run", "registration alone does not prove semantic discovery");
      assert.equal(report.lifecycle.trusted.status, "not-run", "hook trust must remain not-run");
      assert.equal(report.actions.at(-1).status, "manual-required", "hook trust must remain a manual state");
      assert.equal(/dangerously-bypass-hook-trust/iu.test(JSON.stringify(report)), false, "qualification must not bypass hook trust");
      registrationStatus = "PASS";
    });
    if (registrationStatus !== "PASS") {
      await skipSubtest(t, "Codex exact installed-plugin and hook discovery", "Codex isolated registration was unavailable");
      return;
    }

    await t.test("Codex exact installed-plugin and hook discovery", async () => {
      const installResult = capturedResult(captures, ["plugin", "add", PLUGIN_SELECTOR, "--json"]);
      const listResult = capturedResult(captures, ["plugin", "list", "--available", "--json"]);
      assert.notEqual(installResult, null, "Codex plugin add result must be captured");
      assert.notEqual(listResult, null, "Codex plugin list result must be captured");
      const installed = parseCodexInstall(installResult.stdout);
      const discovery = parseInstalledPluginList(listResult.stdout, "codex");
      assert.notEqual(installed, null, "Codex plugin add JSON must expose the exact installed package path");
      assert.notEqual(discovery, null, "Codex list JSON must contain the exact installed and enabled plugin entry");
      assert.deepEqual({ selector: discovery.selector, name: discovery.name, installed: discovery.installed, enabled: discovery.enabled }, {
        selector: PLUGIN_SELECTOR,
        name: "all-about-agents",
        installed: true,
        enabled: true
      });
      const installedRoot = installedPluginRoot(codexHome, installed);
      await assertMarkers(installedRoot, CODEX_HOOK_FILES);
    });
  });
});

test("T07 real product-root metadata comparison is outside the disposable safety boundary", (t) => {
  const reason = "status=NOT_RUN reason=the harness does not read live product roots; all observed writes are confined to disposable roots";
  t.diagnostic(reason);
  t.skip(reason);
});
