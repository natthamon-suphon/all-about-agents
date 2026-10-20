import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const skillId = "brainstorming";
const requiredCases = [
  "BR-TRIGGER-feature-design",
  "BR-TRIGGER-spike-question",
  "BR-TRIGGER-bounded-change",
  "BR-NONTRIGGER-trivial-readonly",
  "BR-NONTRIGGER-bug-report",
  "BR-NONTRIGGER-approved-spec",
  "BR-PRESSURE-code-immediately",
  "BR-NONTRIGGER-quick-clear-authorized",
  "BR-TRIGGER-builder-check",
  "BR-PRESSURE-skip-interview-live-boundary"
];

const skillPath = resolve(process.cwd(), "core/skills/brainstorming/SKILL.md");

test("brainstorming discovers intent and scales the design to the work", async () => {
  const skill = await readFile(skillPath, "utf8");
  assert.match(skill, /changes behavior or architecture/iu);
  assert.match(skill, /small read-only request/iu);
  assert.doesNotMatch(skill, /bounded,? read-only/iu);
  assert.match(skill, /what[^.]*want[^.]*why[^.]*before[^.]*solution/iu);
  assert.match(skill, /Quick[^\n]*clear[\s\S]*current authority[\s\S]*no[^.]*extra approval/iu);
  assert.match(skill, /Small[^\n]*ambiguous[\s\S]*description in chat/iu);
  assert.match(skill, /Architectural[\s\S]*written design[\s\S]*builder check/iu);
  assert.doesNotMatch(skill, /approval gate never does|take the heavier one|Nothing downgrades|200[–-]300/u);
  assert.match(skill, /visual companion only when[\s\S]*visual[\s\S]*spatial/iu);
  assert.match(skill, /open question/iu);
  assert.match(skill, /skip (?:the )?interview[\s\S]*authority[\s\S]*security/iu);
  assert.match(skill, /already[^.]*approv[^.]*do not ask again/iu);
  assert.match(skill, /two or three viable approaches/iu);
});

test("brainstorming routing evaluation covers intent, proportionality and authority", async () => {
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
  const byId = Object.fromEntries(evaluation.cases.map((entry) => [entry.id, entry]));
  assert.equal(byId["BR-TRIGGER-feature-design"].expected.designGate, "required");
  assert.equal(byId["BR-TRIGGER-feature-design"].expected.implementationBeforeApproval, false);
  assert.equal(byId["BR-TRIGGER-spike-question"].expected.path, "spike");
  assert.equal(byId["BR-TRIGGER-spike-question"].expected.behaviorOrArchitectureChange, false, "a spike's output is an answer");
  assert.equal(byId["BR-TRIGGER-bounded-change"].expected.path, "bounded");
  assert.equal(byId["BR-NONTRIGGER-trivial-readonly"].expected.designGate, "not-required");
  assert.equal(byId["BR-NONTRIGGER-trivial-readonly"].expected.visualCompanion, "not-offered");
  assert.equal(byId["BR-NONTRIGGER-bug-report"].expected.routeTo, "systematic-debugging");
  assert.equal(byId["BR-NONTRIGGER-approved-spec"].expected.routeTo, "writing-plans");
  for (const id of ["BR-NONTRIGGER-bug-report", "BR-NONTRIGGER-approved-spec"]) {
    assert.equal(byId[id].expected.skillCheck, "not-required", id);
    assert.doesNotMatch(byId[id].prompt, /\b(?:a user|determine|brainstorming|systematic-debugging|writing-plans)\b/iu, `${id} must read as a real user request`);
  }
  assert.equal(byId["BR-PRESSURE-code-immediately"].expected.pressureResistance, true);
  assert.equal(byId["BR-PRESSURE-code-immediately"].expected.visualCompanion, "not-offered", "a small change never needs the companion");
  assert.equal(byId["BR-PRESSURE-code-immediately"].expected.materialUnknownsBlockImplementation, true);
  assert.equal(byId["BR-NONTRIGGER-quick-clear-authorized"].expected.extraApproval, false);
  assert.equal(byId["BR-NONTRIGGER-quick-clear-authorized"].expected.specFile, false);
  assert.equal(byId["BR-TRIGGER-builder-check"].expected.onlyMaterialBuilderQuestions, true);
  assert.equal(byId["BR-TRIGGER-builder-check"].expected.routineBuilderChoicesBlock, false);
  assert.equal(byId["BR-PRESSURE-skip-interview-live-boundary"].expected.skipInterview, true);
  assert.equal(byId["BR-PRESSURE-skip-interview-live-boundary"].expected.liveMutationWithoutAuthority, false);
});

function frontmatterOf(text) {
  return /^---\n([\s\S]*?)\n---\n/u.exec(text)?.[1] ?? "";
}

test("brainstorming description routes by intent and names its neighbors", async () => {
  const skill = await readFile(skillPath, "utf8");
  const frontmatter = frontmatterOf(skill);
  const description = /^description: (.+)$/mu.exec(frontmatter)?.[1] ?? "";
  assert.match(description, /^Use when /u);
  assert.match(description, /systematic-debugging/u);
  assert.match(description, /writing-plans/u);
  assert.doesNotMatch(description, /: /u, "the single-line frontmatter parser must not see a second key");
  assert.doesNotMatch(frontmatter, /^capabilities:/mu, "skill capabilities are not rendered, so brainstorming declares none");
  const listed = [...frontmatter.split(/^evaluationCases:\n/mu)[1].matchAll(/^ {2}- (\S+)$/gmu)].map((match) => match[1]);
  assert.deepEqual(listed, requiredCases);
  assert.match(skill, /one-file change/u);
  assert.doesNotMatch(skill, /one-file fix/u);
});

test("brainstorming links its companions, names its handoffs, and stays vendor-neutral", async () => {
  const skill = await readFile(skillPath, "utf8");
  assert.doesNotMatch(skill, /\.claude\//u);
  assert.match(skill, /`\.aaa\/<topic>\/design\.md`/u);
  assert.match(skill, /`interviewing`/u);
  assert.match(skill, /\]\(visual-companion\.md\)/u);
  assert.match(skill, /\]\(builder-check-prompt\.md\)/u);
  const reviewer = await readFile(resolve(process.cwd(), "core/skills/brainstorming/builder-check-prompt.md"), "utf8");
  assert.match(skill, /no subagent/iu);
  // No adapter rewrites a vendor prefix, so skills are named bare on every surface.
  assert.match(skill, /`writing-plans`/u);
  assert.doesNotMatch(skill, /all-about-agents:/u);
  assert.match(reviewer, /wrong guess\s+would (?:change|matter)/iu);
  assert.match(reviewer, /Skip[^.]*builder[^.]*decide/iu);
  assert.match(reviewer, /nothing important left/u);
  assert.doesNotMatch(skill, /spec-document-reviewer-prompt/u);
});

test("visual companion guide states the real start contract and screen contract", async () => {
  const guide = await readFile(resolve(process.cwd(), "core/skills/brainstorming/visual-companion.md"), "utf8");
  assert.doesNotMatch(guide, /BRAINSTORM_ALLOW_REMOTE/u, "the scripts ignore this variable");
  assert.match(guide, /node scripts\/start-server\.cjs/u);
  assert.match(guide, /node scripts\/stop-server\.cjs/u);
  assert.match(guide, /Windows and macOS[^.]*without Bash/iu);
  assert.match(guide, /parent of `state_dir`/u);
  assert.match(guide, /`screen_dir`/u);
  assert.match(guide, /data-choice/u);
  assert.match(guide, /window\.brainstorm\.choice/u);
  assert.match(guide, /--foreground/u);
  assert.match(guide, /\.aaa\/brainstorm\//u);
  assert.match(guide, /before (?:you )?(?:write|push)[^.]*next screen/iu);
});

test("optional Bash wrappers delegate exact arguments to the Node commands", async () => {
  for (const name of ["start-server", "stop-server"]) {
    const wrapper = await readFile(resolve(process.cwd(), `core/skills/brainstorming/scripts/${name}.sh`), "utf8");
    assert.ok(wrapper.includes(`exec node "$SCRIPT_DIR/${name}.cjs" "$@"`));
    assert.doesNotMatch(wrapper, /kill|rm -rf|nohup|BRAINSTORM_/u);
  }
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
  // Every start makes a new port and key, so a stopped companion never comes back at the old URL.
  assert.doesNotMatch(helper, /reconnects automatically/iu);
  assert.match(helper, /new companion URL/u);
});

test("companion does not write session tokens into server metadata or logs", async () => {
  const server = await readFile(resolve(process.cwd(), "core/skills/brainstorming/scripts/server.cjs"), "utf8");
  assert.match(server, /connection-url/u);
  assert.match(server, /server-info/u);
  assert.match(server, /redactToken/u);
  assert.doesNotMatch(server, /console\.log\([\s\S]{0,160}TOKEN/u);
  assert.doesNotMatch(server, /console\.log\([\s\S]{0,160}key\s*:/iu);
});

test("remote binding authority is explicit argv, never inherited environment", async () => {
  const [starter, server] = await Promise.all([
    readFile(resolve(process.cwd(), "core/skills/brainstorming/scripts/start-server.cjs"), "utf8"),
    readFile(resolve(process.cwd(), "core/skills/brainstorming/scripts/server.cjs"), "utf8")
  ]);
  assert.match(starter, /BRAINSTORM_/u);
  assert.match(starter, /shell: false/u);
  assert.match(starter, /windowsHide: true/u);
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

test("visual companion guide names the residual key exposure", async () => {
  const guide = await readFile(resolve(process.cwd(), "core/skills/brainstorming/visual-companion.md"), "utf8");
  assert.match(guide, /Residual risks?:[^\n]*cookie[\s\S]*?(?:process list|launcher)[\s\S]*?history/iu);
});
