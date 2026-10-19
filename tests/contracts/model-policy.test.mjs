import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withTempRoot } from "../helpers/temp-root.mjs";
import { runProcess } from "../../scripts/lib/process-runner.mjs";

const policy = await import("../../scripts/model-policy.mjs").catch(() => null);
const codexModel = (model, efforts = ["low", "high", "xhigh"], extra = {}) => ({ id: model, model, hidden: false, supportedReasoningEfforts: efforts.map((reasoningEffort) => ({ reasoningEffort })), ...extra });

test("automatic model policy chooses the newest eligible premium family and actual effort", () => {
  assert.ok(policy, "native-first automatic model policy must be available");
  const catalog = [codexModel("gpt-6.1-sol"), codexModel("gpt-6.10-sol"), codexModel("gpt-6.2-sol"), codexModel("gpt-99-luna"), codexModel("gpt-100-sol", undefined, { hidden: true })];
  const selected = policy.selectModel({ surface: "codex", catalog });
  assert.equal(selected.model, "gpt-6.10-sol");
  assert.equal(selected.effort, "xhigh");
  assert.equal(policy.selectModel({ surface: "codex", catalog: [codexModel("gpt-6.1-sol", ["low", "high"])] }).effort, "high");
  const agy = policy.parseAntigravityModels("Fetching available models...\ngemini-4-argon-medium\tGemini 4 Argon (Medium)\ngemini-4-argon-high\tGemini 4 Argon (High)\ngemini-10-flash-high\tGemini 10 Flash (High)\n");
  const gemini = policy.selectModel({ surface: "antigravity", catalog: agy });
  assert.equal(gemini.model, "gemini-4-argon-high");
  assert.equal(gemini.effort, "high");
  assert.equal(gemini.effortFallback, true);
  assert.equal(policy.selectModel({ surface: "claude" }).model, "opus[1m]");
});

test("model policy rejects invalid catalogs, upgrade cycles and unknown GUI control instead of guessing", () => {
  assert.ok(policy);
  assert.throws(() => policy.selectModel({ surface: "codex", catalog: [codexModel("gpt-6-sol", undefined, { upgrade: "gpt-6.1-sol" }), codexModel("gpt-6.1-sol", undefined, { upgrade: "gpt-6-sol" })] }), /cycle/u);
  assert.throws(() => policy.selectModel({ surface: "codex", catalog: [codexModel("gpt-6-sol", undefined, { upgrade: "gpt-7-sol" })] }), /missing upgrade/u);
  assert.throws(() => policy.selectModel({ surface: "codex", catalog: [codexModel("gpt-6-sol", [])] }), /effort/u);
  assert.throws(() => policy.parseAntigravityModels("invalid model response"), /catalog/u);
  assert.throws(() => policy.selectModel({ surface: "codex", catalog: [codexModel("gpt-6-sol"), codexModel("gpt-6-sol")] }), /duplicate/u);
  assert.throws(() => policy.selectModel({ surface: "codex", catalog: [codexModel("gpt-99-sol", undefined, { hidden: "true" })] }), /hidden/u);
  for (const runtime of ["desktop", "ide"]) {
    assert.throws(() => policy.selectModel({ surface: "antigravity", runtime, catalog: [] }), /native.*unavailable/u);
  }
});

test("managed launch keeps native arguments literal and rejects competing model overrides", () => {
  assert.ok(policy);
  const selection = policy.selectModel({ surface: "codex", catalog: [codexModel("gpt-6.1-sol")] });
  const text = 'spaces ภาษาไทย; $(do-not-run)';
  const plan = policy.planModelLaunch({ surface: "codex", selection, args: [text] });
  assert.equal(plan.executable, "codex");
  assert.equal(plan.args.at(-1), text);
  assert.ok(plan.args.includes('model_reasoning_effort="xhigh"'));
  assert.ok(plan.args.includes("danger-full-access"));
  for (const args of [["--model=other"], ["-m", "other"], ["-c", "model=other"], ["-p", "other"], ["--config", "model=other"], ["--profile", "other"]]) assert.throws(() => policy.planModelLaunch({ surface: "codex", selection, args }), /override/u);
  for (const surface of ["claude", "antigravity"]) {
    assert.equal(policy.planModelLaunch({ surface, selection, args: ["-c"] }).args.at(-1), "-c", `${surface} -c resumes a conversation without overriding model policy`);
  }
  assert.deepEqual(policy.planModelLaunch({ surface: "codex", profile: "portable", args: [text] }).args, [text]);
});

test("Codex native catalog reader completes the handshake and pages without starting a turn", async () => {
  assert.ok(policy);
  await withTempRoot(async (root) => {
    const path = join(root, "fake server.mjs");
    await writeFile(path, `import { createInterface } from "node:readline";
let initialized = false;
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (request.method === "initialize") process.stdout.write(JSON.stringify({ id: request.id, result: {} }) + "\\n");
  else if (request.method === "initialized") initialized = true;
  else if (request.method === "model/list" && initialized) process.stdout.write(JSON.stringify({ id: request.id, result: { data: [{ model: request.params.cursor ? "gpt-6.1-sol" : "gpt-6-sol" }], nextCursor: request.params.cursor ? null : "next" } }) + "\\n");
  else process.exit(20);
}`);
    const models = await policy.readCodexModels({ executable: process.execPath, argsPrefix: [path] });
    assert.deepEqual(models.map((value) => value.model), ["gpt-6-sol", "gpt-6.1-sol"]);
    await assert.rejects(() => policy.readCodexModels({ executable: process.execPath, argsPrefix: [path], maxOutputBytes: 1 }), /output limit/u);
    await writeFile(path, "setInterval(() => {}, 1000);\n");
    await assert.rejects(() => policy.readCodexModels({ executable: process.execPath, argsPrefix: [path], timeoutMs: 500 }), /timed out/u);
  });
});

test("catalog failures prevent a managed launch rather than selecting a stale model", async () => {
  assert.ok(policy);
  await assert.rejects(() => policy.discoverModelSelection({ surface: "antigravity", run: async () => ({ exitCode: 0, stdout: "incomplete", outputTooLarge: true }) }), /unavailable/u);
  await assert.rejects(() => policy.discoverModelSelection({ surface: "codex", readCodex: async () => [] }), /catalog/u);
  assert.equal(await policy.discoverModelSelection({ surface: "codex", profile: "portable", readCodex: async () => { throw new Error("must not discover"); } }), null);
});

test("model policy CLI forwards help after the native argument boundary", async () => {
  const result = await runProcess({
    executable: process.execPath,
    args: ["scripts/model-policy.mjs", "--surface", "claude", "--", "--help"]
  });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /^\s*\{/u, "native help must remain in the dry-run launch plan");
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.status, "dry-run");
  assert.equal(plan.args.at(-1), "--help");
  const help = await runProcess({ executable: process.execPath, args: ["scripts/model-policy.mjs", "--help"] });
  assert.equal(help.exitCode, 0);
  assert.match(help.stdout, /Dry-run by default/u);
});
