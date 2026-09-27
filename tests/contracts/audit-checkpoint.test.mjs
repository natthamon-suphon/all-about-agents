import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";

import { appendAuditEvent, safeLogKey } from "../../installers/lib/audit-log.mjs";
import { withTempRoot } from "../helpers/temp-root.mjs";
import { loadCore } from "../../installers/lib/load-core.mjs";
import { renderClaude } from "../../adapters/claude/adapter.mjs";
import { renderCodex } from "../../adapters/codex/adapter.mjs";

test("safeLogKey rejects path traversal and terminal control data", () => {
  const key = safeLogKey("../session\\nested\u001b[31m\nkey");
  assert.match(key, /^[A-Za-z0-9._-]+$/u);
  assert.doesNotMatch(key, /[\\/\u0000-\u001f\u007f]/u);
  assert.ok(key.length <= 64);
  assert.throws(() => safeLogKey(42), TypeError);
});

const validEvent = Object.freeze({
  timestamp: "2026-08-30T00:00:00.000Z",
  surface: "Claude",
  actionId: " TOOL:Design ",
  outcome: " Success ",
  sessionKey: "session/one"
});

const limits = Object.freeze({ maxBytes: 1024, maxFiles: 3 });
const logPattern = /^activity-audit(?:\.\d+)?\.log$/u;

async function logFiles(root) {
  let names;
  try {
    names = (await readdir(root)).filter((name) => logPattern.test(name));
  } catch {
    return [];
  }
  return Promise.all(names.sort().map(async (name) => ({
    name,
    path: join(root, name),
    content: await readFile(join(root, name), "utf8")
  })));
}

test("appendAuditEvent writes only normalized, hashed audit fields", async () => {
  await withTempRoot(async (root) => {
    const result = await appendAuditEvent(root, {
      ...validEvent,
      token: "token-value",
      password: "password-value",
      apiKey: "key-value",
      args: { command: "do not record" },
      result: "do not record"
    }, limits);
    assert.equal(result.status, "written");
    assert.equal(result.path, join(root, "activity-audit.log"));
    const line = (await readFile(result.path, "utf8")).trim();
    assert.equal(result.bytes, Buffer.byteLength(`${line}\n`));
    assert.deepEqual(JSON.parse(line), {
      timestamp: "2026-08-30T00:00:00.000Z",
      surface: "claude",
      actionId: "tool:design",
      outcome: "success",
      sessionKeyHash: createHash("sha256").update("session/one").digest("hex")
    });
    assert.doesNotMatch(line, /token-value|password-value|key-value|do not record/u);
  });
});

test("appendAuditEvent fails open for malformed events and limits", async () => {
  await withTempRoot(async (root) => {
    for (const event of [
      null,
      {},
      { ...validEvent, surface: "unknown" },
      { ...validEvent, actionId: "\n" },
      { ...validEvent, outcome: 7 },
      { ...validEvent, sessionKey: "" },
      { ...validEvent, timestamp: "not-a-timestamp" }
    ]) {
      const result = await appendAuditEvent(root, event, limits);
      assert.deepEqual(result, { status: "skipped", path: null, bytes: 0 });
    }
    assert.deepEqual(await logFiles(root), []);
    assert.deepEqual(await appendAuditEvent(root, validEvent, { maxBytes: 0, maxFiles: 3 }), { status: "skipped", path: null, bytes: 0 });
  });
});

test("appendAuditEvent rotates and retains at most the configured files and bytes", async () => {
  await withTempRoot(async (root) => {
    const smallLimits = { maxBytes: 220, maxFiles: 2 };
    for (let index = 0; index < 10; index += 1) {
      const result = await appendAuditEvent(root, { ...validEvent, actionId: `tool:design-${index}` }, smallLimits);
      assert.equal(result.status, "written");
    }
    const files = await logFiles(root);
    assert.equal(files.length, 2);
    assert.ok(files.every((file) => Buffer.byteLength(file.content) <= smallLimits.maxBytes));
    assert.ok(files.some((file) => file.name === "activity-audit.1.log"));
    assert.ok(files.every((file) => file.content.trim().length > 0));
  });
});

test("appendAuditEvent remains bounded after 10,000 repeated events", async () => {
  await withTempRoot(async (root) => {
    const repeatedLimits = { maxBytes: 768, maxFiles: 3 };
    for (let index = 0; index < 10_000; index += 1) {
      const result = await appendAuditEvent(root, validEvent, repeatedLimits);
      assert.equal(result.status, "written");
    }
    const files = await logFiles(root);
    assert.ok(files.length <= repeatedLimits.maxFiles);
    assert.ok(files.every((file) => Buffer.byteLength(file.content) <= repeatedLimits.maxBytes));
  });
});

test("concurrent appendAuditEvent calls produce complete JSON lines", async () => {
  await withTempRoot(async (root) => {
    const results = await Promise.all(Array.from({ length: 200 }, (_, index) => appendAuditEvent(
      root,
      { ...validEvent, actionId: `aaa:concurrent-${index}` },
      { maxBytes: 1024 * 1024, maxFiles: 2 }
    )));
    assert.ok(results.every((result) => result.status === "written"));
    const files = await logFiles(root);
    assert.equal(files.length, 1);
    const entries = files[0].content.trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(entries.length, 200);
    assert.equal(new Set(entries.map((entry) => entry.actionId)).size, 200);
  });
});

test("appendAuditEvent fails open when its target cannot be written", async () => {
  await withTempRoot(async (root) => {
    await mkdir(join(root, "activity-audit.log"));
    assert.deepEqual(await appendAuditEvent(root, validEvent, limits), { status: "skipped", path: null, bytes: 0 });
  });
});

test("appendAuditEvent enforces a lowered byte limit across retained files", async () => {
  await withTempRoot(async (root) => {
    const oversized = { ...validEvent, actionId: `aaa:${"initial".repeat(30)}` };
    assert.equal((await appendAuditEvent(root, oversized, { maxBytes: 1000, maxFiles: 3 })).status, "written");
    const lowered = { maxBytes: 220, maxFiles: 3 };
    assert.equal((await appendAuditEvent(root, { ...validEvent, actionId: "aaa:small" }, lowered)).status, "written");
    const files = await logFiles(root);
    assert.ok(files.length <= lowered.maxFiles);
    assert.ok(files.every((file) => Buffer.byteLength(file.content) <= lowered.maxBytes));
  });
});

function fileMap(result) {
  return new Map(result.files.map((file) => [file.relativePath, new TextDecoder().decode(file.content)]));
}

test("every adapter production render consumes the audit and checkpoint contracts", async () => {
  const core = await loadCore(process.cwd());
  const canonicalAudit = await readFile(resolve(process.cwd(), "core/hooks/activity-audit.json"), "utf8");
  const canonicalCheckpoint = await readFile(resolve(process.cwd(), "core/hooks/checkpoint.json"), "utf8");
  const packages = [
    {
      surface: "claude",
      result: renderClaude({ core, profile: { id: "portable" }, statuslineName: "", env: { CLAUDE_CONFIG_DIR: "C:/disposable" }, homeDir: "C:/Users/tester", platform: "win32" }),
      auditPath: "hooks/activity-audit.json",
      checkpointPath: "hooks/checkpoint.json",
      hooksPath: "hooks/hooks.json",
      registrationKinds: ["activity-audit", "checkpoint"]
    },
    {
      surface: "codex",
      result: renderCodex({ core, profile: { id: "portable" }, statuslineName: "", env: { CODEX_HOME: "C:/disposable" }, homeDir: "C:/Users/tester", platform: "win32", targetRuntime: "cli" }),
      auditPath: "hooks/activity-audit.json",
      checkpointPath: "hooks/checkpoint.json",
      hooksPath: "hooks/hooks.json",
      registrationKinds: ["activity-audit", "checkpoint"]
    }
  ];

  for (const packageSpec of packages) {
    const files = fileMap(packageSpec.result);
    assert.ok(files.has(packageSpec.auditPath), `${packageSpec.surface} must render activity-audit.json`);
    assert.ok(files.has(packageSpec.checkpointPath), `${packageSpec.surface} must render checkpoint.json`);
    const renderedAudit = JSON.parse(files.get(packageSpec.auditPath));
    const renderedCheckpoint = JSON.parse(files.get(packageSpec.checkpointPath));
    assert.deepEqual(renderedAudit.recordedFields, JSON.parse(canonicalAudit).recordedFields);
    assert.deepEqual(renderedCheckpoint.recordedFields, JSON.parse(canonicalCheckpoint).recordedFields);
    assert.equal(renderedAudit.surface, packageSpec.surface);
    assert.equal(renderedAudit.event, "PostToolUse");
    assert.equal(renderedCheckpoint.event, "PreCompact");
    for (const kind of packageSpec.registrationKinds) assert.ok(packageSpec.result.registrations.some((entry) => entry.kind === kind), `${packageSpec.surface} must register ${kind}`);
    assert.ok(files.has(packageSpec.hooksPath), `${packageSpec.surface} must render its hook registry`);
    assert.ok(files.has("hooks/audit-log.mjs"), `${packageSpec.surface} must render the audit-log seam`);
  }
});

async function materialize(result, root) {
  for (const file of result.files) {
    const target = join(root, ...file.relativePath.split("/"));
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, file.content);
  }
}

function disposableEnv(root) {
  return { PATH: process.env.PATH, HOME: root, USERPROFILE: root, TMPDIR: root, TMP: root, TEMP: root, CLAUDE_CONFIG_DIR: root, CODEX_HOME: root };
}

function renderedHookPackages(core) {
  return [
    { surface: "claude", result: renderClaude({ core, profile: { id: "portable" }, statuslineName: "", env: { CLAUDE_CONFIG_DIR: "C:/disposable" }, homeDir: "C:/Users/tester", platform: "win32" }) },
    { surface: "codex", result: renderCodex({ core, profile: { id: "portable" }, statuslineName: "", env: { CODEX_HOME: "C:/disposable" }, homeDir: "C:/Users/tester", platform: "win32", targetRuntime: "cli" }) }
  ];
}

test("rendered activity and checkpoint hooks record one line each for a valid native payload", async () => {
  const core = await loadCore(process.cwd());
  for (const item of renderedHookPackages(core)) {
    await withTempRoot(async (root) => {
      await materialize(item.result, root);
      const runHook = (name, payload) => spawnSync(process.execPath, [join(root, "hooks", name)], { input: JSON.stringify(payload), encoding: "utf8", env: disposableEnv(root) });
      const audit = runHook("activity-audit.mjs", { hook_event_name: "PostToolUse", tool_name: "Read", tool_input: {}, tool_response: {}, session_id: "session-1", tool_use_id: "tool-1" });
      assert.equal(audit.status, 0, `${item.surface}: ${audit.stderr}`);
      const checkpoint = runHook("pre-compact.mjs", { hook_event_name: "PreCompact", session_id: "session-1", transcript_path: join(root, "transcript.jsonl"), trigger: "auto" });
      assert.equal(checkpoint.status, 0, `${item.surface}: ${checkpoint.stderr}`);

      const auditLines = (await readFile(join(root, "hooks", "audit", "activity-audit.log"), "utf8")).trim().split("\n");
      assert.equal(auditLines.length, 1, item.surface);
      const auditEntry = JSON.parse(auditLines[0]);
      assert.deepEqual(Object.keys(auditEntry), JSON.parse(await readFile(resolve(process.cwd(), "core/hooks/activity-audit.json"), "utf8")).recordedFields);
      assert.equal(auditEntry.surface, item.surface);
      assert.equal(auditEntry.actionId, "read");
      assert.equal(auditEntry.sessionKeyHash, createHash("sha256").update("session-1").digest("hex"));

      const checkpointLines = (await readFile(join(root, "hooks", "checkpoints", "checkpoint.jsonl"), "utf8")).trim().split("\n");
      assert.equal(checkpointLines.length, 1, item.surface);
      const checkpointEntry = JSON.parse(checkpointLines[0]);
      assert.deepEqual(Object.keys(checkpointEntry), JSON.parse(await readFile(resolve(process.cwd(), "core/hooks/checkpoint.json"), "utf8")).recordedFields);
      assert.equal(checkpointEntry.sessionId, "session-1");
      assert.equal(checkpointEntry.trigger, "auto");
      assert.ok(Number.isFinite(Date.parse(checkpointEntry.timestamp)));
    });
  }
});

test("rendered checkpoint hook bounds and sanitizes the native session and trigger fields", async () => {
  const core = await loadCore(process.cwd());
  for (const item of renderedHookPackages(core)) {
    await withTempRoot(async (root) => {
      await materialize(item.result, root);
      const result = spawnSync(process.execPath, [join(root, "hooks", "pre-compact.mjs")], {
        input: JSON.stringify({ hook_event_name: "PreCompact", session_id: `../${"s".repeat(100)}\u001b[31m`, trigger: 7 }),
        encoding: "utf8",
        env: disposableEnv(root)
      });
      assert.equal(result.status, 0, `${item.surface}: ${result.stderr}`);
      const entry = JSON.parse((await readFile(join(root, "hooks", "checkpoints", "checkpoint.jsonl"), "utf8")).trim());
      assert.match(entry.sessionId, /^[A-Za-z0-9._-]{1,64}$/u);
      assert.equal(entry.trigger, "unknown");
    });
  }
});

test("Claude and Codex activity/checkpoint wrappers fail open on oversized stdin", async () => {
  const core = await loadCore(process.cwd());
  for (const item of renderedHookPackages(core)) {
    await withTempRoot(async (root) => {
      await materialize(item.result, root);
      const oversized = JSON.stringify({ actionId: "tool:review", outcome: "success", session_id: "bounded", padding: "x".repeat(70_000) });
      for (const name of ["activity-audit.mjs", "pre-compact.mjs"]) {
        const result = spawnSync(process.execPath, [join(root, "hooks", name)], { input: oversized, encoding: "utf8", env: disposableEnv(root) });
        assert.equal(result.status, 0, `${item.surface}/${name}: ${result.stderr}`);
      }
      assert.equal(await access(join(root, "hooks", "audit")).then(() => true, () => false), false);
      assert.equal(await access(join(root, "hooks", "checkpoints")).then(() => true, () => false), false);
    });
  }
});

test("audit and checkpoint templates keep native mappings explicit", async () => {
  const json = async (relativePath) => JSON.parse(await readFile(resolve(process.cwd(), relativePath), "utf8"));
  const audit = await json("core/hooks/activity-audit.json");
  const checkpoint = await json("core/hooks/checkpoint.json");
  assert.equal(audit.id, "activity-audit");
  assert.equal(audit.failureMode, "fail-open");
  assert.deepEqual(audit.recordedFields, ["timestamp", "surface", "actionId", "outcome", "sessionKeyHash"]);
  assert.equal(checkpoint.id, "checkpoint");
  assert.equal(checkpoint.storage, "durable-workflow");
  assert.equal(checkpoint.failureMode, "fail-open");
  assert.equal(Object.hasOwn(audit, "surface"), false);
  assert.equal(Object.hasOwn(checkpoint, "event"), false);

  for (const surface of ["claude", "codex"]) {
    const activity = await json(`adapters/${surface}/templates/hooks/activity-audit.json`);
    assert.equal(activity.surface, surface);
    assert.equal(activity.event, "PostToolUse");
    assert.equal(activity.optional, true);
    assert.equal(activity.failureMode, "fail-open");
    assert.deepEqual(activity.recordedFields, audit.recordedFields);
  }
  const claudeCheckpoint = await json("adapters/claude/templates/hooks/checkpoint.json");
  assert.equal(claudeCheckpoint.surface, "claude");
  assert.equal(claudeCheckpoint.event, "PreCompact");
  assert.equal(claudeCheckpoint.automatic, true);
  assert.equal(claudeCheckpoint.failureMode, "fail-open");

  const codexCheckpoint = await json("adapters/codex/templates/hooks/checkpoint.json");
  assert.equal(codexCheckpoint.surface, "codex");
  assert.equal(codexCheckpoint.event, "PreCompact");
  assert.equal(codexCheckpoint.automatic, false);
  assert.equal(codexCheckpoint.enabled, false);
  assert.equal(codexCheckpoint.trustRequired, true);
  assert.equal(codexCheckpoint.status, "not run");
  assert.equal(codexCheckpoint.failureMode, "fail-open");
});
