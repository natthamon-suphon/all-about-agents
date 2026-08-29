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
    const target = join(packageRoot, file.relativePath.replaceAll("/", "\\"));
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, file.content);
  }
}

async function executeRendered(result, { surface, runtimePath, skillPath, input }) {
  const packageRoot = await mkdtemp(join(tmpdir(), `t013-${surface}-`));
  try {
    await materialize(result, packageRoot);
    const runtime = join(packageRoot, runtimePath.replaceAll("/", "\\"));
    const skill = join(packageRoot, skillPath.replaceAll("/", "\\"));
    return await runHandler(process.execPath, [runtime, "--surface", surface, "--skill-path", skill], `${typeof input === "string" ? input : JSON.stringify(input)}\n`, { cwd: tmpdir() });
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
      input: { hook_event_name: "SessionStart", source: "startup" },
      expected: null
    },
    {
      surface: "codex",
      result: renderCodex({ core, profile: { id: "portable" }, statuslineName: "", platform: "win32", env: { CODEX_HOME: "C:/disposable" } }),
      runtimePath: "hooks/bootstrap.mjs",
      skillPath: ".agents/skills/using-all-about-agents/SKILL.md",
      input: { hook_event_name: "SessionStart", source: "startup" },
      expected: null
    },
    {
      surface: "antigravity-2",
      result: renderAntigravity({ core, profile: { id: "portable" }, statuslineName: "", platform: "win32" }),
      runtimePath: ".agents/plugins/all-about-agents/hooks/bootstrap.mjs",
      skillPath: ".agents/plugins/all-about-agents/skills/using-all-about-agents/SKILL.md",
      input: { invocationNum: 0, initialNumSteps: 0 },
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

test("Claude production handler injects only on startup and fails open for every other SessionStart source", async () => {
  const core = await loadCore(process.cwd());
  const result = renderClaude({ core, profile: { id: "portable" }, statuslineName: "", platform: "win32", env: { CLAUDE_CONFIG_DIR: "C:/disposable" } });
  const base = { surface: "claude", runtimePath: "hooks/bootstrap.mjs", skillPath: "skills/using-all-about-agents/SKILL.md" };
  const canonical = fileMap(result).get("skills/using-all-about-agents/SKILL.md");
  assert.deepEqual(await executeRendered(result, { ...base, input: { hook_event_name: "SessionStart", source: "startup" } }), { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: canonical } });
  for (const source of ["clear", "compact", "resume", "fork"]) {
    assert.deepEqual(await executeRendered(result, { ...base, input: { hook_event_name: "SessionStart", source } }), {});
  }
  for (const input of ["{malformed", "[]", "null", {}, { hook_event_name: "SessionStart", source: 0 }, { hook_event_name: "Other", source: "startup" }]) {
    assert.deepEqual(await executeRendered(result, { ...base, input }), {}, "malformed input must not be treated as first startup");
  }
  assert.deepEqual(await executeRendered(result, { ...base, skillPath: "skills/missing/SKILL.md", input: { hook_event_name: "SessionStart", source: "startup" } }), {}, "missing canonical content must fail open");
});

test("Codex production handler supports documented SessionStart sources and malformed input", async () => {
  const core = await loadCore(process.cwd());
  const result = renderCodex({ core, profile: { id: "portable" }, statuslineName: "", platform: "win32", env: { CODEX_HOME: "C:/disposable" } });
  const base = { surface: "codex", runtimePath: "hooks/bootstrap.mjs", skillPath: ".agents/skills/using-all-about-agents/SKILL.md" };
  const canonical = fileMap(result).get(".agents/skills/using-all-about-agents/SKILL.md");
  assert.deepEqual(await executeRendered(result, { ...base, input: { hook_event_name: "SessionStart", source: "startup" } }), { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: canonical } });
  for (const source of ["clear", "compact"]) assert.deepEqual(await executeRendered(result, { ...base, input: { hook_event_name: "SessionStart", source } }), {});
  for (const input of ["{malformed", "[]", {}, { hook_event_name: "SessionStart", source: [] }, { hook_event_name: [], source: "startup" }]) {
    assert.deepEqual(await executeRendered(result, { ...base, input }), {});
  }
});

test("Antigravity production handler requires integer zero-based first invocation fields", async () => {
  const core = await loadCore(process.cwd());
  const result = renderAntigravity({ core, profile: { id: "portable" }, statuslineName: "", platform: "win32" });
  const base = { surface: "antigravity-2", runtimePath: ".agents/plugins/all-about-agents/hooks/bootstrap.mjs", skillPath: ".agents/plugins/all-about-agents/skills/using-all-about-agents/SKILL.md" };
  const canonical = fileMap(result).get(".agents/plugins/all-about-agents/skills/using-all-about-agents/SKILL.md");
  assert.deepEqual(await executeRendered(result, { ...base, input: { invocationNum: 0, initialNumSteps: 0 } }), { injectSteps: [{ ephemeralMessage: canonical }] });
  for (const input of [
    { invocationNum: 1, initialNumSteps: 0 },
    { invocationNum: 0, initialNumSteps: 1 },
    { invocationNum: 0 },
    { initialNumSteps: 0 },
    { invocationNum: "0", initialNumSteps: 0 },
    { invocationNum: 0, initialNumSteps: "0" },
    "{malformed",
    "[]",
    null
  ]) assert.deepEqual(await executeRendered(result, { ...base, input }), { injectSteps: [] });
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
  assert.deepEqual(claudeHooks.hooks.SessionStart[0].hooks[0].args.slice(1), ["--surface", "claude", "--skill-path", "${CLAUDE_PLUGIN_ROOT}/skills/using-all-about-agents/SKILL.md"]);
  const codex = renderCodex({ core, profile: { id: "portable" }, statuslineName: "", platform: "win32" });
  const codexHooks = JSON.parse(fileMap(codex).get("hooks/hooks.json"));
  assert.equal(codexHooks.hooks.SessionStart[0].matcher, "^startup$");
  assert.match(codexHooks.hooks.SessionStart[0].hooks[0].command, /\$PLUGIN_ROOT\/hooks\/bootstrap\.mjs/u);
  assert.ok(codex.registrations.some((entry) => entry.kind === "runtime-prerequisite" && entry.onMissing === "unavailable"));
  const antigravity = renderAntigravity({ core, profile: { id: "portable" }, statuslineName: "", platform: "win32" });
  const antigravityHooks = JSON.parse(fileMap(antigravity).get(".agents/plugins/all-about-agents/hooks.json"));
  assert.equal(antigravityHooks["all-about-agents-bootstrap"].PreInvocation[0].type, "command");
  assert.match(antigravityHooks["all-about-agents-bootstrap"].PreInvocation[0].command, /hooks\/bootstrap\.mjs/u);
  assert.ok(antigravity.registrations.some((entry) => entry.kind === "runtime-prerequisite" && entry.onMissing === "unavailable"));
});

test("production runtime uses structured JSON serialization and explicit inputs only", async () => {
  const source = await readFile(root("core/hooks/bootstrap.mjs"), "utf8");
  assert.match(source, /JSON\.stringify/u);
  assert.doesNotMatch(source, /process\.cwd\s*\(/u);
  assert.doesNotMatch(source, /transcript/iu);
  assert.match(source, /readFile\(skillPath/u);
});
