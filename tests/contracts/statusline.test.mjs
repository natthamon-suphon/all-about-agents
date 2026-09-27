import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  clampPercent,
  readStatuslineConfig,
  renderStatusline,
  safeStatuslineLogKey,
  sanitizeTerminalText
} from "../../adapters/claude/templates/statusline/statusline.mjs";
import { trackToolEvent } from "../../adapters/claude/templates/statusline/track-tool.mjs";
import { safeLogKey } from "../../installers/lib/audit-log.mjs";
import { loadCore } from "../../installers/lib/load-core.mjs";
import { renderClaude } from "../../adapters/claude/adapter.mjs";
import { withTempRoot } from "../helpers/temp-root.mjs";
import { skipIfLinkUnavailable } from "../helpers/symlink.mjs";

const fixtureCases = JSON.parse(await readFile(resolve(process.cwd(), "tests/fixtures/statusline/cases.json"), "utf8"));
const TEMPLATE_ROOT = resolve(process.cwd(), "adapters/claude/templates/statusline");
const PINNED_RENDER = Object.freeze({ env: { CLAUDE_CONFIG_DIR: "C:/disposable/claude" }, homeDir: "C:/Users/tester", platform: "win32" });

function disposableEnv(root, overrides = {}) {
  return { PATH: process.env.PATH, HOME: root, USERPROFILE: root, TMPDIR: root, TMP: root, TEMP: root, CLAUDE_CONFIG_DIR: root, ...overrides };
}

async function materialize(files, root) {
  for (const file of files) {
    const target = join(root, ...file.relativePath.split("/"));
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, file.content);
  }
}

const requiredOutputs = [
  "adapters/claude/templates/statusline/statusline.mjs",
  "adapters/claude/templates/statusline/track-tool.mjs",
  "tests/contracts/statusline.test.mjs",
  "tests/fixtures/statusline/"
];

test("T016 creates every owned artifact", async () => {
  assert.ok(requiredOutputs.length > 0);
  for (const relativePath of requiredOutputs) {
    await access(resolve(process.cwd(), relativePath));
  }
});

test("sanitizeTerminalText removes ANSI, controls, and newline injection while retaining Unicode", () => {
  const value = "ไทย \u001b]8;;https://evil.example\u0007quoted\nbranch\r\u001b[31mmodel\u001b[0m";
  const sanitized = sanitizeTerminalText(value);
  assert.equal(sanitized, "ไทย quoted branch model");
  assert.doesNotMatch(sanitized, /[\u0000-\u001f\u007f-\u009f\u001b]/u);
  assert.equal(sanitizeTerminalText({ value: "unsafe" }), "");
});

test("clampPercent handles negative, over-100, decimal, numeric-string, and non-finite values", () => {
  assert.equal(clampPercent(-10), 0);
  assert.equal(clampPercent(125), 100);
  assert.equal(clampPercent(42.6), 43);
  assert.equal(clampPercent("17"), 17);
  assert.equal(clampPercent(Number.NaN), 0);
  assert.equal(clampPercent("not-a-number"), 0);
  assert.deepEqual(fixtureCases.percentages.map(clampPercent), [0, 0, 43, 100, 100, 0]);
});

test("readStatuslineConfig is JSON-only, bounded, and fail-open", async () => {
  const writeConfig = async (root, text) => {
    await mkdir(join(root, "all-about-agents"), { recursive: true });
    await writeFile(join(root, "all-about-agents", "statusline.json"), text, "utf8");
  };
  for (const [name, { config, expected }] of Object.entries(fixtureCases.config)) {
    await withTempRoot(async (root) => {
      if (config !== null) await writeConfig(root, typeof config === "string" ? config : JSON.stringify(config));
      assert.deepEqual(readStatuslineConfig(root), { displayName: expected }, name);
    });
  }
  // A short valid name plus padding isolates the 8,192-byte file bound from the 64-code-point name rule.
  const configOfBytes = (bytes) => {
    const empty = JSON.stringify({ schemaVersion: 1, displayName: "ok", padding: "" });
    return JSON.stringify({ schemaVersion: 1, displayName: "ok", padding: "a".repeat(bytes - empty.length) });
  };
  for (const [bytes, expected, label] of [[8_192, "ok", "a config at the byte bound is read"], [8_193, "", "a config above the byte bound is ignored"]]) {
    await withTempRoot(async (root) => {
      const text = configOfBytes(bytes);
      assert.equal(Buffer.byteLength(text), bytes);
      await writeConfig(root, text);
      assert.deepEqual(readStatuslineConfig(root), { displayName: expected }, label);
    });
  }
});

test("safeStatuslineLogKey preserves canonical ownership and separates hostile collisions", () => {
  const traversal = safeStatuslineLogKey("../session\\nested/\u001b[31m");
  const slash = safeStatuslineLogKey("a/b");
  const backslash = safeStatuslineLogKey("a\\b");
  const longA = safeStatuslineLogKey("x".repeat(64) + "a");
  const longB = safeStatuslineLogKey("x".repeat(64) + "b");
  for (const key of [traversal, slash, backslash, longA, longB]) {
    assert.match(key, /^[A-Za-z0-9._-]+$/u);
    assert.ok([...key].length <= 64);
    assert.doesNotMatch(key, /(?:^|[.])\.(?:$|[.])|[\\/]/u);
  }
  assert.notEqual(slash, backslash);
  assert.notEqual(longA, longB);
  assert.throws(() => safeStatuslineLogKey(42), TypeError);
  for (const id of ["../session\\nested/\u001b[31m", "a/b", "x".repeat(80), "plain-session"]) {
    const digest = createHash("sha256").update(id, "utf8").digest("hex").slice(0, 16);
    assert.equal(safeStatuslineLogKey(id), `${safeLogKey(id).slice(0, 47)}-${digest}`, "the self-contained key must keep the canonical audit key shape");
  }
});

test("renderStatusline always emits deterministic four-line fail-open output", async () => {
  await withTempRoot(async (root) => {
    const data = {
      workspace: { project_dir: fixtureCases.fields.maliciousRepo },
      worktree: { branch: fixtureCases.fields.maliciousBranch },
      model: { display_name: fixtureCases.fields.maliciousModel },
      context_window: { total_input_tokens: 1234, total_output_tokens: 5678 },
      rate_limits: { five_hour: { used_percentage: -20 }, seven_day: { used_percentage: 140 } },
      cost: { total_duration_ms: 61_000 },
      session_id: fixtureCases.fields.traversalSession,
      unknown: "\u001b]52;;secret\u0007"
    };
    const first = await renderStatusline(data, { configRoot: root, logRoot: join(root, "logs") });
    const second = await renderStatusline(data, { configRoot: root, logRoot: join(root, "logs") });
    assert.equal(first, second);
    assert.equal(first.split("\n").length, 4);
    // The renderer's own colors are the only escapes allowed: every ESC must open a
    // well-formed SGR sequence, and no control data may survive from an external field.
    assert.doesNotMatch(first, /\u001b(?!\[[0-9;]+m)/u);
    assert.doesNotMatch(first.replace(/\u001b\[[0-9;]+m/gu, "").replace(/\r?\n/gu, ""), /[\u0000-\u001f\u007f-\u009f]/u);
    assert.doesNotMatch(first, /\u001b\[2J|\u001b\]52;|\u0007/u);
    assert.match(first, /0%/u);
    assert.doesNotMatch(first, /Hardcoded User Name/u);
  });
});

test("renderer returns empty-name output and only invalid stdin JSON fails", async () => {
  await withTempRoot(async (root) => {
    const output = await renderStatusline({}, { configRoot: root, logRoot: join(root, "logs") });
    assert.equal(output.split("\n").length, 4);
    assert.doesNotMatch(output, /Hardcoded User Name/u);
    const modulePath = join(TEMPLATE_ROOT, "statusline.mjs");
    const run = (input) => spawnSync(process.execPath, [modulePath], { input, encoding: "utf8", env: disposableEnv(root) });
    const valid = run("{}");
    assert.equal(valid.status, 0, valid.stderr);
    assert.equal(valid.stdout.trimEnd().split("\n").length, 4);
    assert.notEqual(run("not-json").status, 0);
    assert.notEqual(run(JSON.stringify({ padding: "x".repeat(70_000) })).status, 0);
  });
});

test("statusline and tracker run as main modules when started through a symlinked path", async (t) => {
  await withTempRoot(async (root) => {
    const renderer = join(root, "statusline-link.mjs");
    const tracker = join(root, "track-tool-link.mjs");
    try {
      await symlink(join(TEMPLATE_ROOT, "statusline.mjs"), renderer, "file");
      await symlink(join(TEMPLATE_ROOT, "track-tool.mjs"), tracker, "file");
    } catch (error) {
      skipIfLinkUnavailable(t, error);
      return;
    }
    try {
      const rendered = spawnSync(process.execPath, [renderer], { input: "{}", encoding: "utf8", env: disposableEnv(root) });
      assert.equal(rendered.status, 0, rendered.stderr);
      assert.equal(rendered.stdout.split("\n").length, 4, "the symlinked renderer must still write its four lines");
      const payload = { session_id: "linked-session", tool_name: "Skill", tool_input: { skill: "brainstorming" } };
      const tracked = spawnSync(process.execPath, [tracker], { input: JSON.stringify(payload), encoding: "utf8", env: disposableEnv(root) });
      assert.equal(tracked.status, 0, tracked.stderr);
      assert.deepEqual(await readdir(join(root, "claude-statusline")), [`${safeStatuslineLogKey("linked-session")}-skills.log`]);
    } finally {
      // Unlink the live-repository links before withTempRoot deletes the root recursively.
      for (const link of [renderer, tracker]) await rm(link, { force: true, recursive: false });
    }
  });
});

test("track-tool fails open, bounds values, and never writes unsafe session or tool text", async () => {
  await withTempRoot(async (root) => {
    await trackToolEvent({
      session_id: "../session\\nested/\u001b[31m",
      tool_name: "Agent",
      tool_input: { subagent_type: "reviewer\n\u001b[2J\"quoted\"" }
    }, { logDir: root });
    await trackToolEvent({
      session_id: "skills-session",
      tool_name: "Skill",
      tool_input: { skill: "ไทย / \"brainstorming\"" }
    }, { logDir: root });
    await trackToolEvent("malformed", { logDir: root });
    const files = await readdir(root);
    assert.equal(files.length, 2);
    assert.ok(files.every((file) => /^[A-Za-z0-9._-]+-(?:agents|skills)\.log$/u.test(file)));
    for (const file of files) {
      const content = await readFile(join(root, file), "utf8");
      assert.doesNotMatch(content.replace(/\r?\n/gu, ""), /[\u0000-\u001f\u007f-\u009f\u001b]/u);
      assert.doesNotMatch(content, /(?:\.\.|[\\/])/u);
      assert.ok(Buffer.byteLength(content, "utf8") <= 8_192);
    }
  });
});

test("Claude production render owns both statusline modules and wires the tracker", async () => {
  const core = await loadCore(process.cwd());
  const result = renderClaude({ core, profile: "portable", statuslineName: "", ...PINNED_RENDER });
  const files = new Map(result.files.map((file) => [file.relativePath, new TextDecoder().decode(file.content)]));
  assert.ok(files.has("statusline/statusline.mjs"));
  assert.ok(files.has("statusline/track-tool.mjs"));
  assert.equal(files.get("statusline/statusline.mjs"), await readFile(resolve(process.cwd(), "adapters/claude/templates/statusline/statusline.mjs"), "utf8"));
  assert.equal(files.get("statusline/track-tool.mjs"), await readFile(resolve(process.cwd(), "adapters/claude/templates/statusline/track-tool.mjs"), "utf8"));
  const hooks = JSON.parse(files.get("hooks/hooks.json")).hooks;
  const postToolHooks = hooks.PostToolUse.flatMap((entry) => entry.hooks);
  assert.ok(postToolHooks.some((hook) => hook.args?.some((arg) => arg.endsWith("/statusline/track-tool.mjs"))));
  const manifest = JSON.parse(await readFile(resolve(process.cwd(), "installers/manifests/claude.json"), "utf8"));
  assert.equal(manifest.components.statusline, "statusline/statusline.mjs");
  assert.equal(manifest.components.statuslineTracker, "statusline/track-tool.mjs");
  assert.equal(manifest.components.statuslineWindowsLauncher, "statusline/statusline.ps1");
  assert.equal(manifest.components.statuslinePosixLauncher, "statusline/statusline.sh");
  assert.deepEqual(manifest.statuslinePrerequisites.requiredBy, ["statusline/statusline.mjs", "statusline/track-tool.mjs"]);
  assert.ok(manifest.ownedPaths.includes("statusline/track-tool.mjs"));
});

test("Claude production render owns cross-platform statusline launchers", async () => {
  const core = await loadCore(process.cwd());
  const result = renderClaude({
    core,
    profile: "portable",
    statuslineName: "ทีม Claude",
    platform: "win32",
    env: { CLAUDE_CONFIG_DIR: "C:/disposable/Claude Config" },
    homeDir: "C:/Users/tester"
  });
  const files = new Map(result.files.map((file) => [file.relativePath, new TextDecoder().decode(file.content)]));
  assert.ok(files.has("statusline/statusline.ps1"));
  assert.ok(files.has("statusline/statusline.sh"));
  assert.match(files.get("statusline/statusline.ps1"), /statusline[.]mjs/u);
  assert.match(files.get("statusline/statusline.sh"), /exec node/u);
  assert.equal(JSON.parse(files.get("config/statusline.json")).displayName, "ทีม Claude");
});

test("generated statusline package imports and renders both owned modules", async () => {
  const core = await loadCore(process.cwd());
  const result = renderClaude({ core, profile: "portable", statuslineName: "", ...PINNED_RENDER });
  await withTempRoot(async (root) => {
    await materialize(result.files, root);
    const statusline = await import(pathToFileURL(join(root, "statusline/statusline.mjs")).href);
    const tracker = await import(pathToFileURL(join(root, "statusline/track-tool.mjs")).href);
    const output = await statusline.renderStatusline({}, { configRoot: root, logRoot: join(root, "logs") });
    assert.equal(output.split("\n").length, 4);
    await tracker.trackToolEvent({ session_id: "generated-session", tool_name: "Agent", tool_input: { subagent_type: "reviewer" } }, { logDir: join(root, "logs") });
  });
});

test("a statusline deployed apart from the plugin shows the plugin tracker's agents and skills", async () => {
  const core = await loadCore(process.cwd());
  const result = renderClaude({ core, profile: "portable", statuslineName: "", ...PINNED_RENDER });
  await withTempRoot(async (root) => {
    const pluginRoot = join(root, "plugin");
    const configRoot = join(root, "config");
    await materialize(result.files, pluginRoot);
    await materialize(result.files.filter((file) => file.relativePath.startsWith("statusline/")), configRoot);
    const env = disposableEnv(root, { CLAUDE_CONFIG_DIR: configRoot });
    for (const payload of [
      { session_id: "deployed-session", tool_name: "Agent", tool_input: { subagent_type: "reviewer" } },
      { session_id: "deployed-session", tool_name: "Skill", tool_input: { skill: "brainstorming" } }
    ]) {
      const tracked = spawnSync(process.execPath, [join(pluginRoot, "statusline", "track-tool.mjs")], { input: JSON.stringify(payload), encoding: "utf8", env });
      assert.equal(tracked.status, 0, tracked.stderr);
    }
    const rendered = spawnSync(process.execPath, [join(configRoot, "statusline", "statusline.mjs")], { input: JSON.stringify({ session_id: "deployed-session" }), encoding: "utf8", env });
    assert.equal(rendered.status, 0, rendered.stderr);
    const line4 = rendered.stdout.split("\n")[3].replace(/\u001b\[[0-9;]+m/gu, "");
    assert.equal(line4, "🤖 reviewer · ⚡ brainstorming");
  });
});

test("oversized tracker stdin fails open without writing", async () => {
  await withTempRoot(async (root) => {
    const modulePath = join(TEMPLATE_ROOT, "track-tool.mjs");
    const oversized = JSON.stringify({
      session_id: "oversized-session",
      tool_name: "Agent",
      tool_input: { subagent_type: "reviewer", padding: "x".repeat(70_000) }
    });
    const result = spawnSync(process.execPath, [modulePath], {
      input: oversized,
      encoding: "utf8",
      env: disposableEnv(root)
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(await readdir(root), []);
  });
});
