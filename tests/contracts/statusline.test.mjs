import assert from "node:assert/strict";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
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
import { loadCore } from "../../installers/lib/load-core.mjs";
import { renderClaude } from "../../adapters/claude/adapter.mjs";
import { withTempRoot } from "../helpers/temp-root.mjs";

const fixtureCases = JSON.parse(await readFile(resolve(process.cwd(), "tests/fixtures/statusline/cases.json"), "utf8"));

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
  await withTempRoot(async (root) => {
    assert.deepEqual(await readStatuslineConfig(root), { displayName: "" });
    const configDir = join(root, "all-about-agents");
    await mkdir(configDir, { recursive: true });
    const configPath = join(configDir, "statusline.json");
    await writeFile(configPath, JSON.stringify({ displayName: " ทีม / \"Claude\" " }), "utf8");
    assert.deepEqual(await readStatuslineConfig(root), { displayName: "ทีม / \"Claude\"" });
    await writeFile(configPath, "{not-json", "utf8");
    assert.deepEqual(await readStatuslineConfig(root), { displayName: "" });
    await writeFile(configPath, JSON.stringify({ displayName: "a".repeat(10_000) }), "utf8");
    assert.deepEqual(await readStatuslineConfig(root), { displayName: "" });
  });
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
});

test("renderStatusline always emits deterministic four-line fail-open output", async () => {
  await withTempRoot(async (root) => {
    const data = {
      workspace: { project_dir: "C:\\repo\\evil\nname" },
      worktree: { branch: "feature/\u001b[31munsafe\nbranch" },
      model: { display_name: "model\r\u001b[2J" },
      context_window: { total_input_tokens: 1234, total_output_tokens: 5678 },
      rate_limits: { five_hour: { used_percentage: -20 }, seven_day: { used_percentage: 140 } },
      cost: { total_duration_ms: 61_000 },
      session_id: "../traversal\\session",
      unknown: "\u001b]52;;secret\u0007"
    };
    const first = await renderStatusline(data, { configRoot: root, logRoot: join(root, "logs") });
    const second = await renderStatusline(data, { configRoot: root, logRoot: join(root, "logs") });
    assert.equal(first, second);
    assert.equal(first.split("\n").length, 4);
    assert.doesNotMatch(first.replace(/\r?\n/gu, ""), /[\u0000-\u001f\u007f-\u009f\u001b]/u);
    assert.match(first, /0%/u);
    assert.doesNotMatch(first, /Natthamon Suphon/u);
  });
});

test("renderer returns empty-name output and only invalid stdin JSON fails", async () => {
  await withTempRoot(async (root) => {
    const output = await renderStatusline({}, { configRoot: root, logRoot: join(root, "logs") });
    assert.equal(output.split("\n").length, 4);
    assert.doesNotMatch(output, /Natthamon Suphon/u);
  });
  const modulePath = resolve(process.cwd(), "adapters/claude/templates/statusline/statusline.mjs");
  const valid = spawnSync(process.execPath, [modulePath], { input: "{}", encoding: "utf8" });
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(valid.stdout.trimEnd().split("\n").length, 4);
  const invalid = spawnSync(process.execPath, [modulePath], { input: "not-json", encoding: "utf8" });
  assert.notEqual(invalid.status, 0);
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
  const result = renderClaude({ core, profile: "portable", statuslineName: "" });
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
  assert.deepEqual(manifest.statuslinePrerequisites.requiredBy, ["statusline/statusline.mjs", "statusline/track-tool.mjs"]);
  assert.ok(manifest.ownedPaths.includes("statusline/track-tool.mjs"));
});

test("generated statusline package imports and renders both owned modules", async () => {
  const core = await loadCore(process.cwd());
  const result = renderClaude({ core, profile: "portable", statuslineName: "" });
  await withTempRoot(async (root) => {
    for (const file of result.files) {
      const target = join(root, ...file.relativePath.split("/"));
      await mkdir(resolve(target, ".."), { recursive: true });
      await writeFile(target, file.content);
    }
    const statusline = await import(pathToFileURL(join(root, "statusline/statusline.mjs")).href);
    const tracker = await import(pathToFileURL(join(root, "statusline/track-tool.mjs")).href);
    const output = await statusline.renderStatusline({}, { configRoot: root, logRoot: join(root, "logs") });
    assert.equal(output.split("\n").length, 4);
    await tracker.trackToolEvent({ session_id: "generated-session", tool_name: "Agent", tool_input: { subagent_type: "reviewer" } }, { logDir: join(root, "logs") });
  });
});
