import assert from "node:assert/strict";
import { link, lstat, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
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
import { skipIfLinkUnavailable } from "../helpers/symlink.mjs";

const fixtureCases = JSON.parse(await readFile(resolve(process.cwd(), "tests/fixtures/statusline/cases.json"), "utf8"));
const TEMPLATE_ROOT = resolve(process.cwd(), "adapters/claude/templates/statusline");
const PINNED_RENDER = Object.freeze({ env: { CLAUDE_CONFIG_DIR: "C:/disposable/claude" }, homeDir: "C:/Users/tester", platform: "win32" });
const SAFETY_LOG = "safety-session-47b25ae7282e6fd9-skills.log";
const SAFETY_PAYLOAD = Object.freeze({ session_id: "safety-session", tool_name: "Skill", tool_input: { skill: "brainstorming" } });

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
  for (const [id, expected] of [
    ["../session\\nested/\u001b[31m", "session-nested-31m-24309b734dd3c71a"],
    ["a/b", "a-b-c14cddc033f64b9d"],
    ["a\\b", "a-b-c62016d0f8ee3333"],
    ["x".repeat(80), "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx-d929cdeea7e6a0f4"],
    ["plain-session", "plain-session-c24d508e9a83bb32"]
  ]) {
    assert.equal(safeStatuslineLogKey(id), expected);
  }
});

for (const kind of ["hardlink", "symlink"]) {
  for (const mode of ["append", "rotation"]) {
    test(`tracker refuses ${kind} ${mode} without changing its unowned neighbor`, async (t) => {
      await withTempRoot(async (root) => {
        const logs = join(root, "logs");
        const neighbor = join(root, "neighbor.txt");
        const target = join(logs, SAFETY_LOG);
        await mkdir(logs);
        const before = mode === "rotation" ? "x".repeat(8_192) : "keep\n";
        await writeFile(neighbor, before);
        try {
          if (kind === "hardlink") await link(neighbor, target);
          else await symlink(neighbor, target, "file");
        } catch (error) {
          skipIfLinkUnavailable(t, error);
          return;
        }
        try {
          await assert.doesNotReject(trackToolEvent(SAFETY_PAYLOAD, { logDir: logs }));
          assert.ok((await readFile(neighbor)).equals(Buffer.from(before)), "unowned neighbor bytes must stay unchanged");
          assert.deepEqual(await readdir(logs), [SAFETY_LOG]);
          assert.equal((await lstat(target)).isSymbolicLink(), kind === "symlink");
          if (kind === "hardlink") assert.equal((await lstat(target)).nlink, 2);
        } finally {
          await rm(target, { force: true });
        }
      });
    });
  }
}

for (const mode of ["append", "rotation"]) {
  test(`tracker rejects a log swapped to a hardlink after its ${mode} metadata check`, async () => {
    await withTempRoot(async (root) => {
      const logs = join(root, "claude-statusline");
      const target = join(logs, SAFETY_LOG);
      const neighbor = join(root, "neighbor.txt");
      const before = mode === "rotation" ? "x".repeat(8_192) : "keep\n";
      await mkdir(logs);
      await writeFile(target, mode === "rotation" ? "t".repeat(8_192) : "trusted\n");
      await writeFile(neighbor, before);
      const preload = join(root, "swap-before-open.mjs");
      await writeFile(preload, `import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const target = ${JSON.stringify(target)};
const neighbor = ${JSON.stringify(neighbor)};
let swapped = false;
for (const name of ["stat", "lstat"]) {
  const original = fs.promises[name];
  fs.promises[name] = async (path, ...args) => {
    const info = await original(path, ...args);
    if (path === target && !swapped) {
      swapped = true;
      await fs.promises.unlink(target);
      await fs.promises.link(neighbor, target);
    }
    return info;
  };
}
syncBuiltinESMExports();
`);
      const result = spawnSync(process.execPath, ["--import", pathToFileURL(preload).href, join(TEMPLATE_ROOT, "track-tool.mjs")], {
        input: JSON.stringify(SAFETY_PAYLOAD), encoding: "utf8", env: disposableEnv(root), timeout: 10_000
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal((await lstat(target)).nlink, 2, "the adversarial swap must have occurred");
      assert.ok((await readFile(neighbor)).equals(Buffer.from(before)), "unowned neighbor bytes must stay unchanged");
    });
  });
}

test("tracker refuses an unowned regular log created after its missing-file check", async () => {
  await withTempRoot(async (root) => {
    const logs = join(root, "claude-statusline");
    const target = join(logs, SAFETY_LOG);
    await mkdir(logs);
    const preload = join(root, "create-before-open.mjs");
    await writeFile(preload, `import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const target = ${JSON.stringify(target)};
let created = false;
for (const name of ["stat", "lstat"]) {
  const original = fs.promises[name];
  fs.promises[name] = async (path, ...args) => {
    try { return await original(path, ...args); }
    catch (error) {
      if (path === target && error.code === "ENOENT" && !created) {
        created = true;
        await fs.promises.writeFile(target, "unowned\\n");
      }
      throw error;
    }
  };
}
syncBuiltinESMExports();
`);
    const result = spawnSync(process.execPath, ["--import", pathToFileURL(preload).href, join(TEMPLATE_ROOT, "track-tool.mjs")], {
      input: JSON.stringify(SAFETY_PAYLOAD), encoding: "utf8", env: disposableEnv(root), timeout: 10_000
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(target, "utf8"), "unowned\n", "exclusive creation must preserve the newly appeared file");
  });
});

for (const placement of ["root", "ancestor"]) {
  test(`tracker refuses a linked ${placement} before creating an external log or directory`, async (t) => {
    await withTempRoot(async (root) => {
      const outside = join(root, "unowned");
      const redirected = join(root, "redirected");
      await mkdir(outside);
      try {
        await symlink(outside, redirected, process.platform === "win32" ? "junction" : "dir");
      } catch (error) {
        skipIfLinkUnavailable(t, error);
        return;
      }
      try {
        const logs = placement === "root" ? redirected : join(redirected, "not-created", "logs");
        await assert.doesNotReject(trackToolEvent(SAFETY_PAYLOAD, { logDir: logs }));
        assert.deepEqual(await readdir(outside), []);
      } finally {
        await rm(redirected, { force: true, recursive: false });
      }
    });
  });
}

test("tracker creates, appends, and rotates only its regular bounded log", async () => {
  await withTempRoot(async (root) => {
    const logs = join(root, "new", "logs");
    await trackToolEvent(SAFETY_PAYLOAD, { logDir: logs });
    const target = join(logs, SAFETY_LOG);
    assert.equal(await readFile(target, "utf8"), "brainstorming\n");
    await trackToolEvent(SAFETY_PAYLOAD, { logDir: logs });
    assert.equal(await readFile(target, "utf8"), "brainstorming\nbrainstorming\n");
    await writeFile(target, "x".repeat(8_192 - Buffer.byteLength("brainstorming\n")));
    await trackToolEvent(SAFETY_PAYLOAD, { logDir: logs });
    assert.equal((await lstat(target)).size, 8_192, "an entry at the byte bound is retained");
    await trackToolEvent(SAFETY_PAYLOAD, { logDir: logs });
    assert.equal(await readFile(target, "utf8"), "brainstorming\n");
    const unicode = { ...SAFETY_PAYLOAD, tool_input: { skill: "ไทย".repeat(300) } };
    for (let index = 0; index < 20; index += 1) await trackToolEvent(unicode, { logDir: logs });
    const text = await readFile(target, "utf8");
    assert.ok(Buffer.byteLength(text) <= 8_192);
    assert.ok(text.trim().split("\n").every((line) => [...line].length <= 256));
    assert.equal((await lstat(target)).nlink, 1);
    assert.equal((await lstat(target)).isFile(), true);
  });
});

test("tracker fails open for non-file targets and invalid parent paths", async () => {
  await withTempRoot(async (root) => {
    const directoryTarget = join(root, SAFETY_LOG);
    await mkdir(directoryTarget);
    await writeFile(join(directoryTarget, "neighbor.txt"), "keep\n");
    await assert.doesNotReject(trackToolEvent(SAFETY_PAYLOAD, { logDir: root }));
    assert.equal(await readFile(join(directoryTarget, "neighbor.txt"), "utf8"), "keep\n");
    const parentFile = join(root, "parent.txt");
    await writeFile(parentFile, "keep\n");
    await assert.doesNotReject(trackToolEvent(SAFETY_PAYLOAD, { logDir: join(parentFile, "logs") }));
    assert.equal(await readFile(parentFile, "utf8"), "keep\n");
  });
});

test("tracker and renderer accept only the known system-temp alias before validating custom log descendants", async (t) => {
  await withTempRoot(async (root) => {
    const actualTemp = join(root, "temp");
    const tempAlias = join(root, "temp-alias");
    await mkdir(actualTemp);
    try {
      await symlink(actualTemp, tempAlias, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      skipIfLinkUnavailable(t, error);
      return;
    }
    try {
      const script = join(root, "custom-temp-root.mjs");
      await writeFile(script, `import { trackToolEvent } from ${JSON.stringify(pathToFileURL(join(TEMPLATE_ROOT, "track-tool.mjs")).href)};
import { renderStatusline } from ${JSON.stringify(pathToFileURL(join(TEMPLATE_ROOT, "statusline.mjs")).href)};
const logDir = ${JSON.stringify(join(tempAlias, "custom-logs"))};
const payload = ${JSON.stringify(SAFETY_PAYLOAD)};
await trackToolEvent(payload, { logDir });
process.stdout.write(await renderStatusline(payload, { configRoot: ${JSON.stringify(root)}, logRoot: logDir }));
`);
      const env = disposableEnv(root, { TMPDIR: tempAlias, TMP: tempAlias, TEMP: tempAlias });
      const result = spawnSync(process.execPath, [script], { encoding: "utf8", env, timeout: 10_000 });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(sanitizeTerminalText(result.stdout.split("\n")[3]), "⚡ brainstorming");
      assert.equal(await readFile(join(actualTemp, "custom-logs", SAFETY_LOG), "utf8"), "brainstorming\n");
      const tracked = spawnSync(process.execPath, [join(TEMPLATE_ROOT, "track-tool.mjs")], {
        input: JSON.stringify(SAFETY_PAYLOAD), encoding: "utf8", env, timeout: 10_000
      });
      assert.equal(tracked.status, 0, tracked.stderr);
      const rendered = spawnSync(process.execPath, [join(TEMPLATE_ROOT, "statusline.mjs")], {
        input: JSON.stringify(SAFETY_PAYLOAD), encoding: "utf8", env, timeout: 10_000
      });
      assert.equal(rendered.status, 0, rendered.stderr);
      assert.equal(sanitizeTerminalText(rendered.stdout.split("\n")[3]), "⚡ brainstorming");
      const outside = join(root, "neighbor");
      const nestedLink = join(actualTemp, "redirected");
      await mkdir(outside);
      await symlink(outside, nestedLink, process.platform === "win32" ? "junction" : "dir");
      try {
        await writeFile(script, `import { trackToolEvent } from ${JSON.stringify(pathToFileURL(join(TEMPLATE_ROOT, "track-tool.mjs")).href)};
await trackToolEvent(${JSON.stringify(SAFETY_PAYLOAD)}, { logDir: ${JSON.stringify(join(tempAlias, "redirected", "logs"))} });
`);
        const blocked = spawnSync(process.execPath, [script], { encoding: "utf8", env, timeout: 10_000 });
        assert.equal(blocked.status, 0, blocked.stderr);
        assert.deepEqual(await readdir(outside), [], "only the temp base may be canonicalized");
      } finally {
        await rm(nestedLink, { force: true, recursive: false });
      }
    } finally {
      await rm(tempAlias, { force: true, recursive: false });
    }
  });
});

for (const kind of ["hardlink", "symlink"]) {
  test(`renderer ignores a ${kind} log instead of displaying unowned text`, async (t) => {
    await withTempRoot(async (root) => {
      const logs = join(root, "logs");
      const neighbor = join(root, "neighbor.txt");
      const target = join(logs, SAFETY_LOG);
      await mkdir(logs);
      await writeFile(neighbor, "unowned-label\n");
      try {
        if (kind === "hardlink") await link(neighbor, target);
        else await symlink(neighbor, target, "file");
      } catch (error) {
        skipIfLinkUnavailable(t, error);
        return;
      }
      try {
        const output = await renderStatusline(SAFETY_PAYLOAD, { configRoot: root, logRoot: logs });
        assert.equal(output.split("\n")[3], ".");
        assert.equal(await readFile(neighbor, "utf8"), "unowned-label\n");
      } finally {
        await rm(target, { force: true });
      }
    });
  });
}

test("renderer ignores a redirected log root and leaves it unchanged", async (t) => {
  await withTempRoot(async (root) => {
    const outside = join(root, "unowned");
    const redirected = join(root, "redirected");
    await mkdir(outside);
    await writeFile(join(outside, SAFETY_LOG), "unowned-label\n");
    try {
      await symlink(outside, redirected, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      skipIfLinkUnavailable(t, error);
      return;
    }
    try {
      const output = await renderStatusline(SAFETY_PAYLOAD, { configRoot: root, logRoot: redirected });
      assert.equal(output.split("\n")[3], ".");
      assert.equal(await readFile(join(outside, SAFETY_LOG), "utf8"), "unowned-label\n");
    } finally {
      await rm(redirected, { force: true, recursive: false });
    }
  });
});

test("renderer reads regular log labels only within the byte bound", async () => {
  await withTempRoot(async (root) => {
    const logs = join(root, "logs");
    const target = join(logs, SAFETY_LOG);
    await mkdir(logs);
    await writeFile(target, "brainstorming\nbrainstorming\nreview\n");
    const output = await renderStatusline(SAFETY_PAYLOAD, { configRoot: root, logRoot: logs });
    assert.equal(sanitizeTerminalText(output.split("\n")[3]), "⚡ brainstorming, review");
    await writeFile(target, "x".repeat(8_193));
    assert.equal((await renderStatusline(SAFETY_PAYLOAD, { configRoot: root, logRoot: logs })).split("\n")[3], ".");
  });
});

for (const mode of ["default", "explicit"]) {
  test(`renderer preserves valid main fields when the ${mode} log root uses an unavailable temp base`, async () => {
    await withTempRoot(async (root) => {
      const missingTemp = join(root, "missing-temp");
      const script = join(root, "render-without-temp.mjs");
      const payload = {
        session_id: "safety-session",
        workspace: { project_dir: "C:/workspace/sample" },
        worktree: { branch: "main" },
        model: { display_name: "Synthetic Model" },
        effort: { level: "xhigh" },
        context_window: { total_input_tokens: 1_000, context_window_size: 10_000, used_percentage: 25 },
        rate_limits: { five_hour: { used_percentage: 12 }, seven_day: { used_percentage: 34 } }
      };
      const options = { configRoot: root, ...(mode === "explicit" ? { logRoot: join(missingTemp, "logs") } : {}) };
      await writeFile(script, `import { renderStatusline } from ${JSON.stringify(pathToFileURL(join(TEMPLATE_ROOT, "statusline.mjs")).href)};
process.stdout.write(await renderStatusline(${JSON.stringify(payload)}, ${JSON.stringify(options)}));
`);
      const result = spawnSync(process.execPath, [script], {
        encoding: "utf8", env: disposableEnv(root, { TMPDIR: missingTemp, TMP: missingTemp, TEMP: missingTemp }), timeout: 10_000
      });
      assert.equal(result.status, 0, result.stderr);
      const lines = result.stdout.split("\n").map(sanitizeTerminalText);
      assert.equal(lines.length, 4);
      assert.equal(lines[0], "🤖 Synthetic Model  ·  🎚 xhigh  ·  📂 sample  ·  🌳 main  ·  🚀 1k/10k 25%");
      assert.match(lines[1], /^🔥 5h .* 12%$/u);
      assert.match(lines[2], /^🌙 7d .* 34%$/u);
      assert.equal(lines[3], ".");
      await assert.rejects(lstat(missingTemp), { code: "ENOENT" });
    });
  });
}

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
