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
import { renderAntigravity } from "../../adapters/antigravity-2/adapter.mjs";
import { renderAgy } from "../../adapters/agy/adapter.mjs";

const requiredOutputs = [
  "core/hooks/activity-audit.json",
  "core/hooks/checkpoint.json",
  "installers/lib/audit-log.mjs",
  "adapters/claude/templates/hooks/activity-audit.json",
  "adapters/claude/templates/hooks/checkpoint.json",
  "adapters/codex/templates/hooks/activity-audit.json",
  "adapters/codex/templates/hooks/checkpoint.json",
  "adapters/antigravity-2/templates/hooks/activity-audit.json",
  "adapters/antigravity-2/templates/hooks/checkpoint.json",
  "adapters/agy/templates/hooks/activity-audit.json",
  "adapters/agy/templates/hooks/checkpoint.json",
  "tests/contracts/audit-checkpoint.test.mjs"
];

test("T015 creates every owned artifact", async () => {
  assert.ok(requiredOutputs.length > 0);
  for (const relativePath of requiredOutputs) {
    await access(resolve(process.cwd(), relativePath));
  }
});

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
  actionId: " AAA:Design ",
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
      actionId: "aaa:design",
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
      const result = await appendAuditEvent(root, { ...validEvent, actionId: `aaa:design-${index}` }, smallLimits);
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
      result: renderClaude({ core, profile: { id: "portable" }, statuslineName: "", platform: "win32" }),
      auditPath: "hooks/activity-audit.json",
      checkpointPath: "hooks/checkpoint.json",
      hooksPath: "hooks/hooks.json",
      registrationKinds: ["activity-audit", "checkpoint"]
    },
    {
      surface: "codex",
      result: renderCodex({ core, profile: { id: "portable" }, statuslineName: "", platform: "win32", targetRuntime: "cli" }),
      auditPath: "hooks/activity-audit.json",
      checkpointPath: "hooks/checkpoint.json",
      hooksPath: "hooks/hooks.json",
      registrationKinds: ["activity-audit", "checkpoint"]
    },
    {
      surface: "antigravity-2",
      result: renderAntigravity({ core, profile: { id: "portable" }, statuslineName: "", platform: "win32" }),
      auditPath: ".agents/plugins/all-about-agents/hooks/activity-audit.json",
      checkpointPath: ".agents/plugins/all-about-agents/hooks/checkpoint.json",
      hooksPath: ".agents/plugins/all-about-agents/hooks.json",
      registrationKinds: ["activity-audit", "checkpoint"]
    },
    {
      surface: "agy",
      result: renderAgy({ core, profile: { id: "portable" }, statuslineName: "", platform: "win32" }),
      auditPath: "activity-audit.json",
      checkpointPath: "checkpoint.json",
      hooksPath: "hooks.json",
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
    if (packageSpec.surface === "claude" || packageSpec.surface === "codex") assert.equal(renderedCheckpoint.event, "PreCompact");
    else {
      assert.equal(renderedCheckpoint.nativeHookEquivalent, false);
      assert.equal(renderedCheckpoint.durableWorkflow, "explicit");
    }
    for (const kind of packageSpec.registrationKinds) assert.ok(packageSpec.result.registrations.some((entry) => entry.kind === kind), `${packageSpec.surface} must register ${kind}`);
    assert.ok(files.has(packageSpec.hooksPath), `${packageSpec.surface} must render its hook registry`);
    if (packageSpec.surface === "claude" || packageSpec.surface === "codex") {
      assert.ok(files.has("hooks/audit-log.mjs"), `${packageSpec.surface} must render the audit-log seam`);
      assert.doesNotMatch(files.get("hooks/activity-audit.mjs"), /intentionally emits no arguments or results/iu, `${packageSpec.surface} must render a consuming activity audit hook`);
      assert.doesNotMatch(files.get("hooks/pre-compact.mjs"), /does not rewrite user files/iu, `${packageSpec.surface} must render a consuming checkpoint hook`);
    }
  }
});

test("Claude and Codex activity/checkpoint wrappers fail open on oversized stdin", async () => {
  const core = await loadCore(process.cwd());
  const packages = [
    { surface: "claude", result: renderClaude({ core, profile: { id: "portable" }, statuslineName: "", platform: "win32" }) },
    { surface: "codex", result: renderCodex({ core, profile: { id: "portable" }, statuslineName: "", platform: "win32", targetRuntime: "cli" }) }
  ];
  for (const item of packages) {
    await withTempRoot(async (root) => {
      for (const file of item.result.files) {
        const target = join(root, ...file.relativePath.split("/"));
        await mkdir(resolve(target, ".."), { recursive: true });
        await writeFile(target, file.content);
      }
      const oversized = JSON.stringify({ actionId: "aaa:review", outcome: "success", session_id: "bounded", padding: "x".repeat(70_000) });
      for (const name of ["activity-audit.mjs", "pre-compact.mjs"]) {
        const result = spawnSync(process.execPath, [join(root, "hooks", name)], { input: oversized, encoding: "utf8" });
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

  for (const surface of ["claude", "codex", "antigravity-2", "agy"]) {
    const activity = await json(`adapters/${surface}/templates/hooks/activity-audit.json`);
    assert.equal(activity.surface, surface);
    assert.equal(activity.event, "PostToolUse");
    assert.equal(activity.optional, true);
    assert.equal(activity.failureMode, "fail-open");
    assert.deepEqual(activity.recordedFields, audit.recordedFields);
  }
  for (const surface of ["claude", "codex"]) {
    const native = await json(`adapters/${surface}/templates/hooks/checkpoint.json`);
    assert.equal(native.surface, surface);
    assert.equal(native.event, "PreCompact");
    assert.equal(native.automatic, true);
    assert.equal(native.failureMode, "fail-open");
  }
  for (const surface of ["antigravity-2", "agy"]) {
    const native = await json(`adapters/${surface}/templates/hooks/checkpoint.json`);
    assert.equal(native.surface, surface);
    assert.equal(native.nativeHookEquivalent, false);
    assert.equal(native.durableWorkflow, "explicit");
    assert.match(native.documentation, /no native checkpoint hook equivalent/iu);
    assert.equal(native.failureMode, "fail-open");
  }
});
