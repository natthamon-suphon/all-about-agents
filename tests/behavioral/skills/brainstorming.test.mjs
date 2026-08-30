import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const skillId = "brainstorming";
const requiredCases = [
  "BR-TRIGGER-feature-design",
  "BR-NONTRIGGER-trivial-readonly",
  "BR-PRESSURE-code-immediately"
];

test("T017 exposes its routing evidence", async () => {
  const skill = await readFile(new URL(`../../../core/skills/${skillId}/SKILL.md`, import.meta.url), "utf8");
  const evaluation = JSON.parse(
    await readFile(new URL(`../../../core/evals/skill-routing/${skillId}.json`, import.meta.url), "utf8"),
  );
  const serialized = JSON.stringify(evaluation);
  assert.match(skill, /^---\n/);
  for (const caseId of requiredCases) assert.match(serialized, new RegExp(caseId));
});

const skillPath = resolve(process.cwd(), "core/skills/brainstorming/SKILL.md");
const assetPaths = [
  "core/skills/brainstorming/SKILL.md",
  "core/skills/brainstorming/visual-companion.md",
  "core/skills/brainstorming/spec-document-reviewer-prompt.md",
  "core/skills/brainstorming/scripts/frame-template.html",
  "core/skills/brainstorming/scripts/helper.js",
  "core/skills/brainstorming/scripts/server.cjs",
  "core/skills/brainstorming/scripts/start-server.sh",
  "core/skills/brainstorming/scripts/stop-server.sh"
];

test("T017 owns every canonical brainstorming artifact", async () => {
  for (const relativePath of assetPaths) await access(resolve(process.cwd(), relativePath));
});

test("brainstorming gates only behavior and architecture changes", async () => {
  const skill = await readFile(skillPath, "utf8");
  assert.match(skill, /changes behavior or architecture/iu);
  assert.match(skill, /trivial, bounded, read-only request/iu);
  assert.match(skill, /does not require a design document,[\s\S]*visual[\s\S]*companion,[\s\S]*long interview/iu);
  assert.match(skill, /before[\s\S]*the first implementation action/iu);
  assert.match(skill, /explicitly approves/iu);
  assert.match(skill, /visual companion only when[\s\S]*visual[\s\S]*spatial/iu);
  assert.match(skill, /one question at a time/iu);
  assert.match(skill, /two or three viable approaches/iu);
});

test("brainstorming routing evaluation has three complete critical cases", async () => {
  const evaluation = JSON.parse(await readFile(resolve(process.cwd(), "core/evals/skill-routing/brainstorming.json"), "utf8"));
  assert.equal(evaluation.schemaVersion, 1);
  assert.equal(evaluation.skill, skillId);
  assert.deepEqual(evaluation.cases.map((entry) => entry.id), requiredCases);
  for (const entry of evaluation.cases) {
    assert.equal(entry.critical, true);
    assert.equal(typeof entry.prompt, "string");
    assert.equal(typeof entry.expected, "object");
    assert.ok(Array.isArray(entry.observables) && entry.observables.length > 0);
  }
  assert.equal(evaluation.cases[0].expected.designGate, "required");
  assert.equal(evaluation.cases[0].expected.implementationBeforeApproval, false);
  assert.equal(evaluation.cases[1].expected.designGate, "not-required");
  assert.equal(evaluation.cases[1].expected.visualCompanion, "not-offered");
  assert.equal(evaluation.cases[2].expected.pressureResistance, true);
});

test("visual companion defaults to loopback and uses a restrictive CSP", async () => {
  const [server, frame, guide] = await Promise.all([
    readFile(resolve(process.cwd(), "core/skills/brainstorming/scripts/server.cjs"), "utf8"),
    readFile(resolve(process.cwd(), "core/skills/brainstorming/scripts/frame-template.html"), "utf8"),
    readFile(resolve(process.cwd(), "core/skills/brainstorming/visual-companion.md"), "utf8")
  ]);
  assert.match(server, /BRAINSTORM_HOST\s*\|\|\s*['"]127\.0\.0\.1['"]/u);
  assert.match(server, /default-src ['"]none['"]/u);
  assert.match(server, /connect-src ['"]self['"]/u);
  assert.match(server, /frame-ancestors ['"]none['"]/u);
  assert.doesNotMatch(`${server}\n${frame}`, /default-src\s+\*/iu);
  assert.doesNotMatch(`${server}\n${frame}`, /unsafe-eval/iu);
  assert.match(guide, /loopback/iu);
  assert.match(guide, /explicit.*remote/isu);
});

test("companion bounds frames, event input, queue growth, and event-log output", async () => {
  const server = await readFile(resolve(process.cwd(), "core/skills/brainstorming/scripts/server.cjs"), "utf8");
  const helper = await readFile(resolve(process.cwd(), "core/skills/brainstorming/scripts/helper.js"), "utf8");
  assert.match(server, /MAX_FRAME_PAYLOAD_BYTES\s*=\s*64\s*\*\s*1024/u);
  assert.match(server, /MAX_EVENT_BYTES/u);
  assert.match(server, /MAX_EVENT_QUEUE_LENGTH/u);
  assert.match(server, /MAX_EVENT_LOG_BYTES/u);
  assert.match(server, /normalizeEvent/u);
  assert.doesNotMatch(server, /console\.log\(JSON\.stringify\(\{\s*source:\s*['"]user-event['"]\s*,\s*\.\.\.event/su);
  assert.match(helper, /MAX_EVENT_QUEUE_LENGTH/u);
  assert.match(helper, /MAX_EVENT_TEXT_LENGTH/u);
  assert.match(helper, /eventQueue\.length\s*[<>]=?/u);
});

test("companion cleanup proves canonical containment before deleting ephemeral roots", async () => {
  const stop = await readFile(resolve(process.cwd(), "core/skills/brainstorming/scripts/stop-server.sh"), "utf8");
  assert.match(stop, /realpath/iu);
  assert.match(stop, /brainstorm-\[0-9\]/u);
  assert.match(stop, /session.*real/isu);
  assert.doesNotMatch(stop, /rm\s+-rf\s+['"]?\$\{?SESSION_DIR/u);
});

test("companion does not write session tokens into server metadata or logs", async () => {
  const server = await readFile(resolve(process.cwd(), "core/skills/brainstorming/scripts/server.cjs"), "utf8");
  assert.match(server, /connection-url/u);
  assert.match(server, /server-info/u);
  assert.match(server, /redactToken/u);
  assert.doesNotMatch(server, /server-info[\s\S]{0,300}companionUrl\(\)/u);
  assert.doesNotMatch(server, /console\.log\([\s\S]{0,160}TOKEN/u);
  assert.doesNotMatch(server, /console\.log\([\s\S]{0,160}key\s*:/iu);
});

test("remote binding authority is explicit argv, never inherited environment", async () => {
  const [wrapper, server] = await Promise.all([
    readFile(resolve(process.cwd(), "core/skills/brainstorming/scripts/start-server.sh"), "utf8"),
    readFile(resolve(process.cwd(), "core/skills/brainstorming/scripts/server.cjs"), "utf8")
  ]);
  assert.match(wrapper, /unset BRAINSTORM_ALLOW_REMOTE/u);
  assert.match(wrapper, /SERVER_ARGS\+=\("--allow-remote"\)/u);
  assert.match(wrapper, /node "\$\{SERVER_ARGS\[@\]\}"/u);
  assert.match(server, /process\.argv\.includes\(['"]--allow-remote['"]\)/u);
  assert.doesNotMatch(server, /process\.env\.BRAINSTORM_ALLOW_REMOTE/u);
});

test("direct companion rejects inherited remote authorization without --allow-remote", () => {
  const root = mkdtempSync(join(tmpdir(), "t017-remote-direct-"));
  try {
    const result = spawnSync(process.execPath, [
      resolve(process.cwd(), "core/skills/brainstorming/scripts/server.cjs"),
      "--brainstorm-server-id=t017-direct"
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BRAINSTORM_DIR: root,
        BRAINSTORM_HOST: "0.0.0.0",
        BRAINSTORM_ALLOW_REMOTE: "1"
      },
      encoding: "utf8",
      timeout: 3000,
      windowsHide: true
    });
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(`${result.stdout}\n${result.stderr}`, /non-loopback companion binding requires/iu);
    assert.equal(existsSync(join(root, "state", "server-info")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
