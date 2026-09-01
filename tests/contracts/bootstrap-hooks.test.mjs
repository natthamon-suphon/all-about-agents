import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { loadCore } from "../../installers/lib/load-core.mjs";
import { renderClaude } from "../../adapters/claude/adapter.mjs";
import { renderCodex } from "../../adapters/codex/adapter.mjs";
import { renderAntigravity } from "../../adapters/antigravity-2/adapter.mjs";
import { renderAgy } from "../../adapters/agy/adapter.mjs";
import { MAX_STDIN_BYTES, runBootstrap } from "../../core/hooks/bootstrap.mjs";
import { NATIVE_PHASES } from "../../adapters/shared/native-state.mjs";

const requiredOutputs = [
  "core/hooks/bootstrap.json",
  "core/hooks/bootstrap.mjs",
  "adapters/claude/templates/hooks/bootstrap.json",
  "adapters/codex/templates/hooks/bootstrap.json",
  "adapters/antigravity-2/templates/hooks/bootstrap.json",
  "adapters/agy/templates/hooks/bootstrap.json",
  "tests/contracts/bootstrap-hooks.test.mjs"
];

const root = (relativePath) => resolve(process.cwd(), relativePath);
const readJson = async (relativePath) => JSON.parse(await readFile(root(relativePath), "utf8"));

function fileMap(result) {
  return new Map(result.files.map((file) => [file.relativePath, new TextDecoder().decode(file.content)]));
}

function runHandler(executable, args, input, options) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(executable, args, options);
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`handler exited ${code}: ${Buffer.concat(stderr).toString("utf8")}`));
      else resolveResult(JSON.parse(Buffer.concat(stdout).toString("utf8")));
    });
    child.stdin.end(input);
  });
}

async function materialize(result, packageRoot) {
  for (const file of result.files) {
    const target = join(packageRoot, ...file.relativePath.split("/"));
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, file.content);
  }
}

async function executeRendered(result, { surface, runtimePath, skillPath, configPath, input }) {
  const packageRoot = await mkdtemp(join(tmpdir(), `t013-${surface}-`));
  try {
    await materialize(result, packageRoot);
    const runtime = join(packageRoot, ...runtimePath.split("/"));
    const skill = join(packageRoot, ...skillPath.split("/"));
    const args = [runtime, "--surface", surface, "--skill-path", skill];
    if (configPath) args.push("--config-path", join(packageRoot, ...configPath.split("/")));
    return await runHandler(process.execPath, args, `${typeof input === "string" ? input : JSON.stringify(input)}\n`, { cwd: tmpdir() });
  } finally {
    await rm(packageRoot, { recursive: true, force: true });
  }
}

test("T013 creates every owned artifact", async () => {
  assert.ok(requiredOutputs.length > 0);
  for (const relativePath of requiredOutputs) await access(root(relativePath));
});

test("rendered executable packages invoke the production bootstrap handler", async () => {
  const core = await loadCore(process.cwd());
  const packages = [
    {
      surface: "claude",
      result: renderClaude({ core, profile: { id: "portable" }, statuslineName: "", platform: "win32", env: { CLAUDE_CONFIG_DIR: "C:/disposable" } }),
      runtimePath: "hooks/bootstrap.mjs",
      skillPath: "skills/using-all-about-agents/SKILL.md",
      configPath: "hooks/bootstrap.json",
      input: { hook_event_name: "SessionStart", source: "startup" },
      expected: null
    },
    {
      surface: "codex",
      result: renderCodex({ core, profile: { id: "portable" }, statuslineName: "", platform: "win32", env: { CODEX_HOME: "C:/disposable" } }),
      runtimePath: "hooks/bootstrap.mjs",
      skillPath: ".agents/skills/using-all-about-agents/SKILL.md",
      configPath: "hooks/bootstrap.json",
      input: { hook_event_name: "SessionStart", source: "startup" },
      expected: null
    }
  ];

  for (const packageSpec of packages) {
    const files = fileMap(packageSpec.result);
    assert.equal(files.get(packageSpec.runtimePath), await readFile(root("core/hooks/bootstrap.mjs"), "utf8"), `${packageSpec.surface} must copy the canonical runtime`);
    const canonical = files.get(packageSpec.skillPath);
    const expected = packageSpec.surface === "antigravity-2"
      ? { injectSteps: [{ ephemeralMessage: canonical }] }
      : { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: canonical } };
    assert.deepEqual(await executeRendered(packageSpec.result, packageSpec), expected, `${packageSpec.surface} must execute the rendered handler`);
  }
});

test("automatic renderers consume the canonical core bootstrap contract", async () => {
  const core = await loadCore(process.cwd());
  const canonicalContract = await readFile(root("core/hooks/bootstrap.json"), "utf8");
  const packages = [
    {
      result: renderClaude({ core, profile: { id: "portable" }, statuslineName: "", platform: "win32" }),
      configPath: "hooks/bootstrap.json",
      hooksPath: "hooks/hooks.json"
    },
    {
      result: renderCodex({ core, profile: { id: "portable" }, statuslineName: "", platform: "win32" }),
      configPath: "hooks/bootstrap.json",
      hooksPath: "hooks/hooks.json"
    }
  ];

  for (const packageSpec of packages) {
    const files = fileMap(packageSpec.result);
    assert.equal(files.get(packageSpec.configPath), canonicalContract, "the automatic package must render the canonical bootstrap contract");
    const hooks = JSON.parse(files.get(packageSpec.hooksPath));
    const command = hooks.hooks.SessionStart[0].hooks[0];
    const commandText = command.args ? command.args.join(" ") : `${command.command} ${command.commandWindows || ""}`;
    assert.match(commandText, /--config-path/u, "the rendered handler must receive the canonical contract path");
  }
});

test("unverified renderers stay probe-only without commands or relative handler paths", async () => {
  const core = await loadCore(process.cwd());
  const packages = [
    {
      templatePath: "adapters/antigravity-2/templates/hooks/bootstrap.json",
      result: renderAntigravity({ core, profile: { id: "portable" }, statuslineName: "", platform: "win32" }),
      hooksPath: ".agents/plugins/all-about-agents/hooks.json"
    },
    {
      templatePath: "adapters/agy/templates/hooks/bootstrap.json",
      result: renderAgy({ core, profile: { id: "portable" }, statuslineName: "", platform: "win32" }),
      hooksPath: "hooks.json"
    }
  ];

  for (const packageSpec of packages) {
    const template = await readJson(packageSpec.templatePath);
    assert.equal(template.automatic, false);
    assert.equal(template.probeRequired, true);
    assert.equal(template.probe.status, "not run");
    assert.ok(template.probe.manualSequence.length >= 2);
    assert.doesNotMatch(JSON.stringify(template), /"command"\s*:|\.\/hooks|\.\/skills/iu);
    const hooks = fileMap(packageSpec.result).get(packageSpec.hooksPath);
    assert.doesNotMatch(hooks, /"command"\s*:|\.\/hooks|\.\/skills/iu);
    assert.doesNotMatch(hooks, /"enabled"\s*:\s*true/iu);
    const registration = packageSpec.result.registrations.find((entry) => entry.kind === "hook-contract");
    assert.equal(registration.enabled, false);
    assert.equal(registration.automaticHookExecution, false);
    assert.equal(registration.probeRequired, true);
  }
});

test("Claude production handler injects only on startup and fails open for every other SessionStart source", async () => {
  const core = await loadCore(process.cwd());
  const result = renderClaude({ core, profile: { id: "portable" }, statuslineName: "", platform: "win32", env: { CLAUDE_CONFIG_DIR: "C:/disposable" } });
  const base = { surface: "claude", runtimePath: "hooks/bootstrap.mjs", skillPath: "skills/using-all-about-agents/SKILL.md", configPath: "hooks/bootstrap.json" };
  const canonical = fileMap(result).get("skills/using-all-about-agents/SKILL.md");
  assert.deepEqual(await executeRendered(result, { ...base, input: { hook_event_name: "SessionStart", source: "startup" } }), { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: canonical } });
  for (const source of ["clear", "compact", "resume", "fork"]) {
    assert.deepEqual(await executeRendered(result, { ...base, input: { hook_event_name: "SessionStart", source } }), {});
  }
  for (const input of ["{malformed", "[]", "null", {}, { hook_event_name: "SessionStart", source: 0 }, { hook_event_name: "Other", source: "startup" }]) {
    assert.deepEqual(await executeRendered(result, { ...base, input }), {}, "malformed input must not be treated as first startup");
  }
  assert.deepEqual(await executeRendered(result, { ...base, skillPath: "skills/missing/SKILL.md", input: { hook_event_name: "SessionStart", source: "startup" } }), {}, "missing canonical content must fail open");
  assert.deepEqual(await executeRendered(result, { ...base, configPath: "hooks/missing-bootstrap.json", input: { hook_event_name: "SessionStart", source: "startup" } }), {}, "missing canonical bootstrap contract must fail open");
});

test("Codex production handler supports documented SessionStart sources and malformed input", async () => {
  const core = await loadCore(process.cwd());
  const result = renderCodex({ core, profile: { id: "portable" }, statuslineName: "", platform: "win32", env: { CODEX_HOME: "C:/disposable" } });
  const base = { surface: "codex", runtimePath: "hooks/bootstrap.mjs", skillPath: ".agents/skills/using-all-about-agents/SKILL.md", configPath: "hooks/bootstrap.json" };
  const canonical = fileMap(result).get(".agents/skills/using-all-about-agents/SKILL.md");
  assert.deepEqual(await executeRendered(result, { ...base, input: { hook_event_name: "SessionStart", source: "startup" } }), { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: canonical } });
  for (const source of ["clear", "compact"]) assert.deepEqual(await executeRendered(result, { ...base, input: { hook_event_name: "SessionStart", source } }), {});
  for (const input of ["{malformed", "[]", {}, { hook_event_name: "SessionStart", source: [] }, { hook_event_name: [], source: "startup" }]) {
    assert.deepEqual(await executeRendered(result, { ...base, input }), {});
  }
});

test("automatic bootstrap fails open when stdin exceeds the bounded collector limit", async () => {
  const core = await loadCore(process.cwd());
  const cases = [
    { surface: "claude", result: renderClaude({ core, profile: { id: "portable" }, statuslineName: "", platform: "win32", env: { CLAUDE_CONFIG_DIR: "C:/disposable" } }), skillPath: "skills/using-all-about-agents/SKILL.md" },
    { surface: "codex", result: renderCodex({ core, profile: { id: "portable" }, statuslineName: "", platform: "win32", env: { CODEX_HOME: "C:/disposable" } }), skillPath: ".agents/skills/using-all-about-agents/SKILL.md" }
  ];
  for (const item of cases) {
    const input = { hook_event_name: "SessionStart", source: "startup", padding: "x".repeat(70_000) };
    assert.deepEqual(await executeRendered(item.result, { surface: item.surface, runtimePath: "hooks/bootstrap.mjs", skillPath: item.skillPath, configPath: "hooks/bootstrap.json", input }), {});
  }
});

test("bootstrap helper also bounds explicitly supplied raw input", async () => {
  const skillPath = root("core/skills/using-all-about-agents/SKILL.md");
  const configPath = root("core/hooks/bootstrap.json");
  const rawInput = JSON.stringify({ hook_event_name: "SessionStart", source: "startup", padding: "x".repeat(MAX_STDIN_BYTES) });
  assert.deepEqual(JSON.parse(await runBootstrap([
    "--surface", "claude", "--skill-path", skillPath, "--config-path", configPath
  ], rawInput)), {});
});

test("agy renders a visible probe-required diagnostic without an automatic command", async () => {
  const core = await loadCore(process.cwd());
  const result = renderAgy({ core, profile: { id: "portable" }, statuslineName: "", platform: "win32" });
  const files = fileMap(result);
  const hooks = JSON.parse(files.get("hooks.json"));
  assert.equal(hooks["all-about-agents-safety"].enabled, false);
  assert.doesNotMatch(JSON.stringify(hooks), /command/iu);
  const registration = result.registrations.find((entry) => entry.kind === "hook-contract");
  assert.equal(registration.enabled, false);
  assert.equal(registration.automaticHookExecution, false);
  assert.equal(registration.probeRequired, true);
  assert.ok(result.diagnostics.some((entry) => entry.code === "agy-bootstrap-probe-required" && /Status: not run/iu.test(entry.message)));
});

test("canonical behavior is vendor-neutral while each template owns its native contract", async () => {
  const bootstrap = await readJson("core/hooks/bootstrap.json");
  assert.equal(bootstrap.id, "bootstrap");
  assert.equal(bootstrap.failureMode, "fail-open");
  assert.equal(bootstrap.failureDiagnostic, "Bootstrap skipped: malformed hook input; the session continues without injected context.");
  assert.equal(bootstrap.contentRef, "core/skills/using-all-about-agents/SKILL.md");
  for (const field of ["surface", "event", "matchers", "firstSession", "firstSessionWhen", "input", "hookSpecificOutput", "injectSteps"]) assert.equal(Object.hasOwn(bootstrap, field), false, `core must not own vendor field ${field}`);

  const templates = [
    "adapters/claude/templates/hooks/bootstrap.json",
    "adapters/codex/templates/hooks/bootstrap.json",
    "adapters/antigravity-2/templates/hooks/bootstrap.json",
    "adapters/agy/templates/hooks/bootstrap.json"
  ];
  for (const templatePath of templates) {
    const template = await readJson(templatePath);
    assert.equal(template.contentRef, bootstrap.contentRef);
    assert.equal(template.runtime.executable, "node");
    assert.equal(template.runtime.preflight, "required");
    assert.equal(template.runtime.missingRuntime, "unavailable");
  }
});

test("rendered hook configs consume their parsed native templates and declare runtime availability", async () => {
  const core = await loadCore(process.cwd());
  const claude = renderClaude({ core, profile: { id: "portable" }, statuslineName: "", platform: "win32" });
  const claudeHooks = JSON.parse(fileMap(claude).get("hooks/hooks.json"));
  assert.equal(claudeHooks.hooks.SessionStart[0].matcher, "startup");
  assert.deepEqual(claudeHooks.hooks.SessionStart[0].hooks[0].args.slice(1), ["--surface", "claude", "--skill-path", "${CLAUDE_PLUGIN_ROOT}/skills/using-all-about-agents/SKILL.md", "--config-path", "${CLAUDE_PLUGIN_ROOT}/hooks/bootstrap.json"]);
  const codex = renderCodex({ core, profile: { id: "portable" }, statuslineName: "", platform: "win32" });
  const codexHooks = JSON.parse(fileMap(codex).get("hooks/hooks.json"));
  assert.equal(codexHooks.hooks.SessionStart[0].matcher, "^startup$");
  assert.match(codexHooks.hooks.SessionStart[0].hooks[0].command, /\$PLUGIN_ROOT\/hooks\/bootstrap\.mjs/u);
  assert.ok(codex.registrations.some((entry) => entry.kind === "runtime-prerequisite" && entry.onMissing === "unavailable"));
  const antigravity = renderAntigravity({ core, profile: { id: "portable" }, statuslineName: "", platform: "win32" });
  const antigravityHooks = JSON.parse(fileMap(antigravity).get(".agents/plugins/all-about-agents/hooks.json"));
  assert.equal(antigravityHooks["all-about-agents-safety"].enabled, false);
  assert.doesNotMatch(JSON.stringify(antigravityHooks), /command|\.\//iu);
  assert.ok(antigravity.registrations.some((entry) => entry.kind === "runtime-prerequisite" && entry.onMissing === "unavailable"));
});

test("Codex hook templates and rendered records remain manual until registration and trust evidence", async () => {
  const core = await loadCore(process.cwd());
  const result = renderCodex({ core, profile: { id: "template" }, statuslineName: "", platform: "win32" });
  for (const templatePath of [
    "adapters/codex/templates/hooks/bootstrap.json",
    "adapters/codex/templates/hooks/activity-audit.json",
    "adapters/codex/templates/hooks/checkpoint.json",
    "adapters/codex/templates/hooks/emergency-guard.json"
  ]) {
    const template = await readJson(templatePath);
    assert.notEqual(template.automatic, true, `${templatePath} must not claim automatic execution before evidence`);
    assert.notEqual(template.enabled, true, `${templatePath} must not claim enabled execution before evidence`);
  }
  const records = result.registrations.filter((entry) => entry.kind === "native-integration");
  assert.equal(records.length, 5);
  const emergency = records.find((record) => record.feature === "emergency-protection");
  assert.ok(emergency);
  assert.deepEqual(Object.keys(emergency.phases), NATIVE_PHASES);
  assert.deepEqual(NATIVE_PHASES.map((phase) => emergency.phases[phase].status), ["pass", "not-run", "not-run", "not-run", "not-run", "not-run"]);
  assert.ok(emergency.manualSteps.some((step) => /\/hooks/u.test(step)));

  const hookRecords = records.filter((record) => record.feature !== "emergency-protection");
  assert.equal(hookRecords.length, 4);
  for (const record of hookRecords) {
    assert.deepEqual(Object.keys(record.phases), NATIVE_PHASES);
    assert.deepEqual(NATIVE_PHASES.map((phase) => record.phases[phase].status), ["pass", "pass", "not-run", "not-run", "not-run", "not-run"]);
    assert.ok(record.manualSteps.some((step) => /\/hooks/u.test(step)));
  }
});

test("production runtime uses structured JSON serialization and explicit inputs only", async () => {
  const source = await readFile(root("core/hooks/bootstrap.mjs"), "utf8");
  assert.match(source, /JSON\.stringify/u);
  assert.doesNotMatch(source, /process\.cwd\s*\(/u);
  assert.doesNotMatch(source, /transcript/iu);
  assert.match(source, /readFile\(skillPath/u);
});

test("portable package materialization keeps slash-neutral relative paths", async () => {
  const source = await readFile(root("tests/contracts/bootstrap-hooks.test.mjs"), "utf8");
  assert.doesNotMatch(source, /relativePath\.replaceAll\(/u);
  const packageRoot = await mkdtemp(join(tmpdir(), "t013-paths-"));
  try {
    await materialize({ files: [{ relativePath: "nested/portable.txt", content: new TextEncoder().encode("portable") }] }, packageRoot);
    assert.equal(await readFile(join(packageRoot, "nested", "portable.txt"), "utf8"), "portable");
  } finally {
    await rm(packageRoot, { recursive: true, force: true });
  }
});
