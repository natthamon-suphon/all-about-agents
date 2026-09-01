import assert from "node:assert/strict";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { loadCore } from "../../installers/lib/load-core.mjs";
import { renderAgy } from "../../adapters/agy/adapter.mjs";
import { withTempRoot } from "../helpers/temp-root.mjs";

const core = await loadCore(process.cwd());

function fileMap(result) {
  return new Map(result.files.map((file) => [file.relativePath, new TextDecoder().decode(file.content)]));
}

test("T04 creates the agy statusline artifacts", async () => {
  for (const relativePath of [
    "adapters/agy/templates/statusline/statusline.mjs",
    "adapters/agy/templates/statusline/statusline.ps1",
    "adapters/agy/templates/statusline/statusline.sh",
    "tests/contracts/agy-statusline.test.mjs"
  ]) await access(resolve(process.cwd(), relativePath));
});

test("agy statusline module is a public renderer seam", async () => {
  const module = await import("../../adapters/agy/templates/statusline/statusline.mjs");
  assert.equal(typeof module.renderAgyStatusline, "function");
  assert.equal(typeof module.collectBoundedStdin, "function");
});

test("agy renderer keeps documented low-risk fields and excludes private payload fields", async () => {
  const { renderAgyStatusline } = await import("../../adapters/agy/templates/statusline/statusline.mjs");
  await withTempRoot(async (root) => {
    const configPath = join(root, "statusline.json");
    await writeFile(configPath, JSON.stringify({ schemaVersion: 1, displayName: "Team O'Reilly" }), "utf8");
    const payload = {
      cwd: "/private/full/cwd",
      conversation_id: "private-conversation",
      transcript_path: "/private/transcript.jsonl",
      model: { id: "private-model-id", display_name: "Gemini 3.5 Flash (High)" },
      workspace: { current_dir: "/private/current", project_dir: "/workspaces/agents" },
      version: "1.1.22",
      context_window: { used_percentage: 14.24, current_usage: { input_tokens: 999 } },
      quota: { "private-bucket": { remaining_fraction: 0.1 } },
      agent_state: "thinking",
      vcs: { type: "git", branch: "feature/native", dirty: true },
      sandbox: { enabled: false },
      artifact_count: 2,
      plan_tier: "Pro",
      email: "developer@email.com",
      task_count: 3,
      terminal_width: 111,
      execution_mode: "planning",
      unknown: { nested: "secret" }
    };
    const output = await renderAgyStatusline(payload, { configPath });
    assert.equal(output.split("\n").length, 1);
    assert.match(output, /Team O'Reilly/u);
    assert.match(output, /agents/u);
    assert.match(output, /Gemini 3\.5 Flash \(High\)/u);
    assert.match(output, /14%/u);
    assert.match(output, /thinking/u);
    assert.match(output, /feature\/native\*/u);
    assert.match(output, /3 tasks/u);
    assert.match(output, /planning/u);
    for (const privateValue of ["/private/full/cwd", "private-conversation", "private/transcript.jsonl", "private-model-id", "private-bucket", "developer@email.com", "secret"]) {
      assert.equal(output.includes(privateValue), false, privateValue);
    }
    assert.doesNotMatch(output, /[\u0000-\u001f\u007f-\u009f\u001b]/u);
  });
});

test("agy renderer handles malformed and hostile data without echoing it", async () => {
  const { renderAgyStatusline } = await import("../../adapters/agy/templates/statusline/statusline.mjs");
  await withTempRoot(async (root) => {
    const configPath = join(root, "statusline.json");
    await writeFile(configPath, "{not-json", "utf8");
    const output = await renderAgyStatusline({
      workspace: { project_dir: "C:\\evil\\project\nname" },
      model: { display_name: "model\u001b[31m" },
      context_window: { used_percentage: 140 },
      agent_state: "working\nstate",
      vcs: { branch: "main\r\u001b[2J", dirty: false },
      task_count: -3,
      execution_mode: "fast\u0000"
    }, { configPath });
    assert.equal(output.split("\n").length, 1);
    assert.match(output, /140%|100%/u);
    assert.doesNotMatch(output, /evil|\u001b|\r|\n/u);
  });
});

test("generated agy renderer rejects oversized stdin without echoing it", () => {
  const modulePath = resolve(process.cwd(), "adapters/agy/templates/statusline/statusline.mjs");
  const oversized = JSON.stringify({ untrusted: "x".repeat(70 * 1024) });
  const result = spawnSync(process.execPath, [modulePath], { input: oversized, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "invalid statusline JSON\n");
  assert.equal(result.stderr.includes("x"), false);
});

test("generated agy renderer rejects malformed stdin without echoing it", () => {
  const modulePath = resolve(process.cwd(), "adapters/agy/templates/statusline/statusline.mjs");
  const invalid = spawnSync(process.execPath, [modulePath], { input: "not-json", encoding: "utf8" });
  assert.notEqual(invalid.status, 0);
  assert.equal(invalid.stdout, "");
  assert.equal(invalid.stderr, "invalid statusline JSON\n");
});

test("emitted agy settings statusLine command runs the disposable Windows route", async (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows PowerShell route is unavailable on this platform");
    return;
  }
  const routeProbe = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "exit 0"], { encoding: "utf8", windowsHide: true });
  if (routeProbe.error) assert.fail(`Windows PowerShell route unavailable: ${routeProbe.error.code || routeProbe.error.message}`);
  assert.equal(routeProbe.status, 0, routeProbe.stderr);
  await withTempRoot(async (root) => {
    const unrelated = join(root, "unrelated-cwd");
    const configRoot = join(root, "Agy Config ทีม O'Reilly $&;" + String.fromCharCode(96) + "tick");
    const displayName = "Unique statusline ทีม O'Reilly $&;" + String.fromCharCode(96) + "tick";
    await mkdir(unrelated, { recursive: true });
    const rendered = renderAgy({ core, profile: { id: "template" }, statuslineName: displayName, configRoot: configRoot.replaceAll("\\", "/"), platform: "win32" });
    const files = fileMap(rendered);
    for (const relativePath of ["statusline/statusline.mjs", "statusline/statusline.ps1", "statusline/statusline.sh", "statusline/statusline.json"]) {
      const destination = join(configRoot, "plugins", "all-about-agents", relativePath);
      await mkdir(resolve(destination, ".."), { recursive: true });
      await writeFile(destination, files.get(relativePath), "utf8");
    }
    const overlay = JSON.parse(files.get("settings.overlay.json"));
    const command = overlay.statusLine.command;
    const encoded = command.match(/^powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ([A-Za-z0-9+/=]+)$/u)?.[1];
    assert.ok(encoded, "settings overlay must emit the documented Windows command route");
    const decoded = Buffer.from(encoded, "base64").toString("utf16le");
    assert.match(decoded.replaceAll("\\", "/"), /\/plugins\/all-about-agents\/statusline\/statusline\.ps1'/u);
    const sample = {
      cwd: "C:/private/cwd",
      session_id: "session-id",
      conversation_id: "conversation-id",
      transcript_path: "C:/private/transcript.jsonl",
      model: { id: "model-id", display_name: "Gemini 3.5 Flash (High)" },
      workspace: { current_dir: "C:/private/current", project_dir: "C:/workspace/agy-project" },
      context_window: { used_percentage: 14 },
      agent_state: "idle",
      vcs: { branch: "main", dirty: false },
      task_count: 1,
      execution_mode: "planning",
      email: "private@example.com"
    };
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], {
      cwd: unrelated,
      input: JSON.stringify(sample),
      encoding: "utf8",
      windowsHide: true
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout.split(/\r?\n/u).length, 1);
    assert.ok(result.stdout.length > 0 && result.stdout.length <= 1024);
    assert.equal(result.stdout.match(new RegExp(displayName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "gu"))?.length, 1);
    assert.match(result.stdout, /^Unique statusline .* · 📁 agy-project · 🧠 Gemini 3\.5 Flash \(High\)/u);
    assert.equal(result.stdout.includes("private@example.com"), false);
  });
});

test("agy generated statusline renderer and launchers are copied byte-for-byte", async () => {
  const result = renderAgy({ core, profile: { id: "portable" }, statuslineName: "", platform: "win32" });
  const files = fileMap(result);
  for (const name of ["statusline.mjs", "statusline.ps1", "statusline.sh"]) {
    assert.equal(files.get(`statusline/${name}`), await readFile(resolve(process.cwd(), `adapters/agy/templates/statusline/${name}`), "utf8"));
  }
});
