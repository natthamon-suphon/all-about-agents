import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createServer } from "node:net";
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
  // "Bounded" names one path only; read-only work is "small" (review B11).
  assert.match(skill, /small read-only request/iu);
  assert.doesNotMatch(skill, /bounded,? read-only/iu);
  assert.match(skill, /does not require a design document,[\s\S]*visual[\s\S]*companion,[\s\S]*long interview/iu);
  assert.match(skill, /before[\s\S]*the first implementation action/iu);
  assert.match(skill, /explicitly approves/iu);
  assert.match(skill, /Spike[\s\S]*Bounded[\s\S]*Architectural/u);
  assert.match(skill, /approval gate never does/iu);
  assert.match(skill, /take the heavier one/iu);
  assert.match(skill, /visual companion only when[\s\S]*visual[\s\S]*spatial/iu);
  assert.match(skill, /one question at a time/iu);
  assert.match(skill, /two or three viable approaches/iu);
});

test("brainstorming routing evaluation has seven complete critical cases", async () => {
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
  const reviewer = await readFile(resolve(process.cwd(), "core/skills/brainstorming/spec-document-reviewer-prompt.md"), "utf8");
  assert.doesNotMatch(skill, /\.claude\//u);
  assert.match(skill, /`\.aaa\/<topic>\/design\.md`/u);
  assert.match(skill, /^2\. [^\n]*`interviewing`/mu, "step 2 hands the clarifying questions to interviewing");
  assert.match(skill, /\]\(visual-companion\.md\)/u);
  assert.match(skill, /\]\(spec-document-reviewer-prompt\.md\)/u);
  assert.match(skill, /no subagent/iu);
  // No adapter rewrites a vendor prefix, so skills are named bare on every surface.
  assert.match(skill, /`writing-plans`/u);
  assert.doesNotMatch(skill, /all-about-agents:/u);
  assert.match(reviewer, /only on the Architectural path/iu);
  assert.doesNotMatch(reviewer, /bounded read-only/iu);
});

test("visual companion guide states the real start contract and screen contract", async () => {
  const guide = await readFile(resolve(process.cwd(), "core/skills/brainstorming/visual-companion.md"), "utf8");
  assert.doesNotMatch(guide, /BRAINSTORM_ALLOW_REMOTE/u, "the scripts ignore this variable");
  assert.match(guide, /bash scripts\/start-server\.sh/u);
  assert.match(guide, /Git Bash or WSL/u);
  assert.match(guide, /parent of `state_dir`/u);
  assert.match(guide, /`screen_dir`/u);
  assert.match(guide, /data-choice/u);
  assert.match(guide, /window\.brainstorm\.choice/u);
  assert.match(guide, /--foreground/u);
  assert.match(guide, /\.aaa\/brainstorm\//u);
  assert.match(guide, /before (?:you )?(?:write|push)[^.]*next screen/iu);
});

test("start script sets the umask first, keeps no dead PID code, and has no product detection", async () => {
  const [wrapper, server] = await Promise.all([
    readFile(resolve(process.cwd(), "core/skills/brainstorming/scripts/start-server.sh"), "utf8"),
    readFile(resolve(process.cwd(), "core/skills/brainstorming/scripts/server.cjs"), "utf8")
  ]);
  assert.ok(wrapper.indexOf("umask 077") > -1 && wrapper.indexOf("umask 077") < wrapper.indexOf("mkdir"), "umask must precede the first mkdir");
  assert.doesNotMatch(wrapper, /OLD_PID/u);
  assert.doesNotMatch(wrapper, /CODEX_CI/u);
  assert.doesNotMatch(wrapper, /\.claude\//u);
  assert.doesNotMatch(`${wrapper}\n${server}`, /TOKEN_FILE|PORT_FILE|BRAINSTORM_TOKEN\b/u, "a key is never read from or saved to disk or the environment");
  assert.doesNotMatch(server, /on\(['"]error['"],\s*\(\)\s*=>\s*\{\s*\}\)/u, "a watcher error must not be swallowed");
  assert.match(server, /shutdown\(reason, 1\)/u, "a watcher failure exits non-zero");
  assert.match(server, /process\.exit\(exitCode\)/u);
  // A crashed server's PID may already belong to another process.
  assert.match(wrapper, /if \[\[ "\$reason" != "crashed" \]\]; then kill "\$SERVER_PID"/u);
  assert.doesNotMatch(server, /execFile\([^;]*,\s*\(\)\s*=>\s*\{\s*\}\)/u, "a browser launch error must be logged");
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

test("companion cleanup proves canonical containment before deleting ephemeral roots", async () => {
  const stop = await readFile(resolve(process.cwd(), "core/skills/brainstorming/scripts/stop-server.sh"), "utf8");
  // One method (pwd -P) canonicalizes both the session and the temp roots, so the
  // compare holds on macOS where /var and /tmp are links (review B4).
  assert.match(stop, /pwd -P/u);
  assert.doesNotMatch(stop, /"\$parent" == "\$\{TMPDIR:-\/tmp\}"/u);
  assert.match(stop, /brainstorm-\[0-9\]/u);
  assert.match(stop, /canonical="\$\(canonical_dir "\$SESSION_DIR"/u);
  assert.match(stop, /rm -rf -- "\$canonical"/u);
  assert.doesNotMatch(stop, /rm\s+-rf\s+['"]?\$\{?SESSION_DIR/u);
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
  const [wrapper, server] = await Promise.all([
    readFile(resolve(process.cwd(), "core/skills/brainstorming/scripts/start-server.sh"), "utf8"),
    readFile(resolve(process.cwd(), "core/skills/brainstorming/scripts/server.cjs"), "utf8")
  ]);
  // Every inherited BRAINSTORM_* value is dropped before the flags set their own.
  assert.match(wrapper, /unset "\$\{!BRAINSTORM_@\}"/u);
  assert.ok(wrapper.indexOf('unset "${!BRAINSTORM_@}"') < wrapper.indexOf("while [[ $# -gt 0 ]]"), "clear the environment before parsing flags");
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

const scriptsDir = resolve(process.cwd(), "core/skills/brainstorming/scripts");
const posixProbe = process.platform === "win32" ? null : spawnSync("bash", ["-c", "command -v node && command -v ps"], { encoding: "utf8" });
const posixSkip = process.platform === "win32"
  ? "companion scripts are POSIX bash; this test does not model Git Bash or WSL paths"
  : posixProbe.status === 0 ? false : `bash, node, or ps unavailable (status ${posixProbe.status ?? "spawn-error"})`;

function companionEnv(tmpRoot) {
  const inherited = Object.entries(process.env).filter(([key]) => !key.startsWith("BRAINSTORM_"));
  // macOS sets TMPDIR with a trailing slash under a /var link; keep that shape.
  return { ...Object.fromEntries(inherited), TMPDIR: `${tmpRoot}/` };
}

function runScript(name, args, env) {
  return spawnSync("bash", [join(scriptsDir, name), ...args], { env, encoding: "utf8", timeout: 15000 });
}

function startCompanion(env, args = []) {
  const result = runScript("start-server.sh", args, env);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

function killLeftover(info) {
  let pid;
  try {
    pid = Number(readFileSync(join(info.state_dir, "server.pid"), "utf8").trim());
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  try {
    process.kill(pid);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

function isInside(root, target) {
  const path = relative(root, target);
  return path !== "" && !path.startsWith("..") && !isAbsolute(path);
}

test("start-server reports an unknown argument as valid JSON", { skip: posixSkip }, () => {
  const result = runScript("start-server.sh", ['--bogus"flag'], companionEnv(tmpdir()));
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).error, 'Unknown argument: --bogus"flag');
});

test("each project start makes a fresh key and keeps it in a private temp state folder", { skip: posixSkip }, async () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "t017-tmp-"));
  const project = mkdtempSync(join(tmpdir(), "t017-project-"));
  const env = companionEnv(tmpRoot);
  const started = [];
  try {
    const injected = "a".repeat(64);
    started.push(startCompanion({ ...env, BRAINSTORM_TOKEN: injected }, ["--project-dir", project]));
    started.push(startCompanion(env, ["--project-dir", project]));
    const keys = started.map((info) => new URL(info.url).searchParams.get("key"));
    assert.match(keys[0], /^[0-9a-f]{64}$/u);
    assert.notEqual(keys[0], injected, "an inherited key is never reused");
    assert.notEqual(keys[0], keys[1], "every start makes a new key");
    for (const info of started) {
      assert.ok(info.port > 0, "the reported port is the real bound port");
      assert.equal(new URL(info.url).port, String(info.port));
    }
    const loopback = new URL(started[1].url);
    loopback.hostname = "127.0.0.1";
    const opened = await fetch(loopback);
    await opened.text();
    assert.equal(opened.status, 200, "the keyed loopback URL opens");
    const denied = await fetch(new URL("/", loopback));
    await denied.text();
    assert.equal(denied.status, 403, "a request without the key is refused");
    const realTmp = realpathSync(tmpRoot);
    const realProject = realpathSync(project);
    for (const info of started) {
      const state = realpathSync(info.state_dir);
      assert.ok(isInside(realTmp, state), `state ${state} must live under the temp root`);
      assert.ok(isInside(join(realProject, ".aaa", "brainstorm"), realpathSync(info.screen_dir)), "screens persist under .aaa/brainstorm/");
      assert.equal(statSync(state).mode & 0o777, 0o700);
      assert.equal(statSync(join(state, "connection-url")).mode & 0o777, 0o600);
    }
    started.forEach((info, index) => {
      for (const name of ["server-info", "server.log"]) {
        assert.equal(readFileSync(join(info.state_dir, name), "utf8").includes(keys[index]), false, `${name} must not hold the key`);
      }
    });
    const projectFiles = readdirSync(project, { recursive: true }).map((name) => join(project, name)).filter((path) => statSync(path).isFile());
    const projectText = projectFiles.map((path) => readFileSync(path, "utf8")).join("\n");
    for (const key of keys) assert.equal(projectText.includes(key), false, "the key must never be written into the project");
    assert.equal(existsSync(join(project, ".claude")), false);
  } finally {
    for (const info of started) {
      runScript("stop-server.sh", [dirname(info.state_dir)], env);
      killLeftover(info);
    }
    rmSync(tmpRoot, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});

test("a screen fragment keeps its dollar sequences verbatim", { skip: posixSkip }, async () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "t017-tmp-"));
  let info;
  try {
    info = startCompanion(companionEnv(tmpRoot));
    const fragment = "<p>cost $$5, $' tail, $& match, $` head</p>";
    writeFileSync(join(info.screen_dir, "001.html"), fragment);
    const key = new URL(info.url).searchParams.get("key");
    const page = await fetch(`http://127.0.0.1:${info.port}/`, { headers: { cookie: `brainstorm-key-${info.port}=${key}` } });
    const body = await page.text();
    assert.equal(page.status, 200);
    assert.ok(body.includes(fragment), "String.replace patterns must not rewrite the screen");
    assert.equal(body.split("<!-- CONTENT -->").length, 1, "no placeholder text is left or injected");
  } finally {
    if (info) {
      runScript("stop-server.sh", [dirname(info.state_dir)], companionEnv(tmpRoot));
      killLeftover(info);
    }
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("stop removes a disposable temp session and refuses one outside the temp root", { skip: posixSkip }, () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "t017-tmp-"));
  const otherRoot = mkdtempSync(join(tmpdir(), "t017-other-"));
  const started = [];
  try {
    const disposable = startCompanion(companionEnv(tmpRoot));
    started.push(disposable);
    const disposableSession = dirname(disposable.state_dir);
    const stopped = runScript("stop-server.sh", [disposableSession], companionEnv(tmpRoot));
    assert.equal(stopped.status, 0, stopped.stderr);
    assert.deepEqual(JSON.parse(stopped.stdout), { status: "stopped", removed: true });
    assert.equal(existsSync(disposableSession), false, "the disposable session must be removed");
    const again = runScript("stop-server.sh", [disposableSession], companionEnv(tmpRoot));
    assert.equal(again.status, 0, again.stderr);
    assert.deepEqual(JSON.parse(again.stdout), { status: "not_running", removed: false }, "a second stop still answers in JSON");

    const outside = startCompanion(companionEnv(otherRoot));
    started.push(outside);
    const outsideSession = dirname(outside.state_dir);
    const refused = runScript("stop-server.sh", [outsideSession], companionEnv(tmpRoot));
    assert.equal(refused.status, 1, refused.stderr);
    assert.equal(JSON.parse(refused.stdout).status, "refused");
    assert.equal(JSON.parse(refused.stdout).removed, false);
    assert.equal(existsSync(outsideSession), true, "a session outside the temp root must not be deleted");
    const outsidePid = Number(readFileSync(join(outside.state_dir, "server.pid"), "utf8").trim());
    assert.doesNotThrow(() => process.kill(outsidePid, 0), "a refused path is not acted on");
  } finally {
    for (const info of started) killLeftover(info);
    rmSync(tmpRoot, { recursive: true, force: true });
    rmSync(otherRoot, { recursive: true, force: true });
  }
});

async function waitForExit(pid) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === "ESRCH") return;
      throw error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  assert.fail(`process ${pid} did not exit`);
}

test("server refuses to start without an explicit session directory", { skip: posixSkip }, () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "t017-nodir-"));
  try {
    const env = { ...companionEnv(tmpRoot), TMPDIR: tmpRoot };
    const result = spawnSync(process.execPath, [join(scriptsDir, "server.cjs"), "--brainstorm-server-id=t017-nodir"], { env, encoding: "utf8", timeout: 3000 });
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /BRAINSTORM_DIR/u);
    assert.equal(existsSync(join(tmpRoot, "brainstorm")), false, "no shared os.tmpdir()/brainstorm fallback");
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("start ignores inherited companion settings it does not set itself", { skip: posixSkip }, async () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "t017-tmp-"));
  const blocker = createServer();
  await new Promise((resolveListen) => blocker.listen(0, "127.0.0.1", resolveListen));
  let info;
  try {
    const busyPort = blocker.address().port;
    info = startCompanion({
      ...companionEnv(tmpRoot),
      BRAINSTORM_PORT: String(busyPort),
      BRAINSTORM_IDLE_TIMEOUT_MS: "1",
      BRAINSTORM_LIFECYCLE_CHECK_MS: "1"
    });
    assert.notEqual(info.port, busyPort, "a stale BRAINSTORM_PORT must not be used");
    assert.equal(info.idle_timeout_ms, 4 * 60 * 60 * 1000);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
    const pid = Number(readFileSync(join(info.state_dir, "server.pid"), "utf8").trim());
    assert.doesNotThrow(() => process.kill(pid, 0), "a stale lifecycle setting must not stop the server");
  } finally {
    if (info) {
      runScript("stop-server.sh", [dirname(info.state_dir)], companionEnv(tmpRoot));
      killLeftover(info);
    }
    await new Promise((resolveClose) => blocker.close(resolveClose));
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("stop cleans a disposable session whose server already exited, and reports removal", { skip: posixSkip }, async () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "t017-tmp-"));
  const otherRoot = mkdtempSync(join(tmpdir(), "t017-other-"));
  let info;
  try {
    info = startCompanion(companionEnv(tmpRoot));
    const pid = Number(readFileSync(join(info.state_dir, "server.pid"), "utf8").trim());
    process.kill(pid);
    await waitForExit(pid);
    const session = dirname(info.state_dir);
    const stale = runScript("stop-server.sh", [session], companionEnv(tmpRoot));
    assert.deepEqual(JSON.parse(stale.stdout), { status: "stale_pid", removed: true });
    assert.equal(existsSync(session), false);

    const orphan = join(tmpRoot, "brainstorm-orphan1");
    mkdirSync(join(orphan, "state"), { recursive: true });
    const notRunning = runScript("stop-server.sh", [orphan], companionEnv(tmpRoot));
    assert.deepEqual(JSON.parse(notRunning.stdout), { status: "not_running", removed: true });
    assert.equal(existsSync(orphan), false);

    const outside = join(otherRoot, "brainstorm-outside1");
    mkdirSync(join(outside, "state"), { recursive: true });
    const planted = { "server-info": "{}\n", "server.pid": "999999\n", "server-instance-id": "someone-else\n" };
    for (const [name, text] of Object.entries(planted)) writeFileSync(join(outside, "state", name), text);
    const refused = runScript("stop-server.sh", [outside], companionEnv(tmpRoot));
    assert.equal(refused.status, 1, refused.stderr);
    assert.equal(JSON.parse(refused.stdout).status, "refused");
    assert.deepEqual(readdirSync(join(outside, "state")).sort(), Object.keys(planted).sort(), "a non-temp state folder is not touched");
    for (const [name, text] of Object.entries(planted)) assert.equal(readFileSync(join(outside, "state", name), "utf8"), text);
  } finally {
    if (info) killLeftover(info);
    rmSync(tmpRoot, { recursive: true, force: true });
    rmSync(otherRoot, { recursive: true, force: true });
  }
});

test("a start that times out stops the server and removes its session and empty screen folder", { skip: posixSkip }, () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "t017-tmp-"));
  const project = mkdtempSync(join(tmpdir(), "t017-project-"));
  const fakeBin = mkdtempSync(join(tmpdir(), "t017-bin-"));
  const pidFile = join(fakeBin, "fake-node.pid");
  try {
    // A node that never becomes ready, so the start loop reaches its timeout.
    writeFileSync(join(fakeBin, "node"), `#!/bin/sh\nprintf '%s\\n' "$$" > "${pidFile}"\nexec sleep 60\n`, { mode: 0o755 });
    const env = { ...companionEnv(tmpRoot), PATH: `${fakeBin}:${process.env.PATH}` };
    const result = runScript("start-server.sh", ["--project-dir", project], env);
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(JSON.parse(result.stdout).error, /within 5 seconds/u);
    const pid = Number(readFileSync(pidFile, "utf8").trim());
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" }, "the timed-out server must be stopped");
    assert.deepEqual(readdirSync(tmpRoot).filter((name) => name.startsWith("brainstorm-")), [], "the temp session with the key must be removed");
    assert.deepEqual(readdirSync(join(project, ".aaa", "brainstorm")), [], "the empty screen folder must be removed");
  } finally {
    try {
      process.kill(Number(readFileSync(pidFile, "utf8").trim()));
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ESRCH") throw error;
    }
    rmSync(tmpRoot, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
    rmSync(fakeBin, { recursive: true, force: true });
  }
});

test("stop matches the whole instance id and re-proves identity before a forced kill", { skip: posixSkip }, async () => {
  const stop = await readFile(join(scriptsDir, "stop-server.sh"), "utf8");
  assert.doesNotMatch(stop, /grep -F -- "--brainstorm-server-id=/u, "a prefix of another id must not match");
  assert.match(stop, /if is_our_server "\$PID" "\$EXPECTED_ID"; then kill -9/u);
  const tmpRoot = mkdtempSync(join(tmpdir(), "t017-tmp-"));
  let info;
  try {
    info = startCompanion(companionEnv(tmpRoot));
    const pid = Number(readFileSync(join(info.state_dir, "server.pid"), "utf8").trim());
    const idFile = join(info.state_dir, "server-instance-id");
    writeFileSync(idFile, `${readFileSync(idFile, "utf8").trim().slice(0, -1)}\n`);
    const result = runScript("stop-server.sh", [dirname(info.state_dir)], companionEnv(tmpRoot));
    assert.deepEqual(JSON.parse(result.stdout), { status: "stale_pid", removed: true });
    assert.doesNotThrow(() => process.kill(pid, 0), "a server whose id only shares a prefix must not be killed");
    process.kill(pid);
    await waitForExit(pid);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("a server that stops by itself removes its connection URL", { skip: posixSkip }, () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "t017-tmp-"));
  const session = join(tmpRoot, "brainstorm-idle01");
  try {
    const env = { ...companionEnv(tmpRoot), BRAINSTORM_DIR: session, BRAINSTORM_IDLE_TIMEOUT_MS: "300", BRAINSTORM_LIFECYCLE_CHECK_MS: "50" };
    const result = spawnSync(process.execPath, [join(scriptsDir, "server.cjs"), "--brainstorm-server-id=t017-idle"], { env, encoding: "utf8", timeout: 10000 });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(readFileSync(join(session, "state", "server-stopped"), "utf8"), /idle timeout/u);
    assert.equal(existsSync(join(session, "state", "connection-url")), false, "a dead key must not stay on disk");
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("start refuses a symlinked .aaa or .aaa/brainstorm in the project", { skip: posixSkip }, () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "t017-tmp-"));
  const outsideRoot = mkdtempSync(join(tmpdir(), "t017-outside-"));
  const projects = [];
  const started = [];
  try {
    const topLink = mkdtempSync(join(tmpdir(), "t017-project-"));
    symlinkSync(outsideRoot, join(topLink, ".aaa"));
    const innerLink = mkdtempSync(join(tmpdir(), "t017-project-"));
    mkdirSync(join(innerLink, ".aaa"));
    symlinkSync(outsideRoot, join(innerLink, ".aaa", "brainstorm"));
    projects.push(topLink, innerLink);
    for (const project of projects) {
      const result = runScript("start-server.sh", ["--project-dir", project], companionEnv(tmpRoot));
      if (result.status === 0) started.push(JSON.parse(result.stdout));
      assert.equal(result.status, 1, `${project}: ${result.stdout}`);
      assert.match(JSON.parse(result.stdout).error, /symlink/u);
    }
    assert.deepEqual(readdirSync(outsideRoot), [], "screens must never land outside the project");
    assert.deepEqual(readdirSync(tmpRoot), [], "a refused start leaves no temp session");
  } finally {
    for (const info of started) {
      runScript("stop-server.sh", [dirname(info.state_dir)], companionEnv(tmpRoot));
      killLeftover(info);
    }
    for (const path of [tmpRoot, outsideRoot, ...projects]) rmSync(path, { recursive: true, force: true });
  }
});

test("a server that crashes before it is ready keeps only its log and reports where it is", { skip: posixSkip }, () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "t017-tmp-"));
  const project = mkdtempSync(join(tmpdir(), "t017-project-"));
  try {
    const result = runScript("start-server.sh", ["--host", "0.0.0.0", "--project-dir", project], companionEnv(tmpRoot));
    assert.equal(result.status, 1, result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.error, "Server failed to start");
    assert.match(readFileSync(output.log, "utf8"), /non-loopback companion binding requires/u);
    assert.deepEqual(readdirSync(dirname(output.log)), ["server.log"], "a crash keeps only the redacted log");
    assert.deepEqual(readdirSync(join(project, ".aaa", "brainstorm")), [], "the empty screen folder must be removed");
    const cleaned = runScript("stop-server.sh", [dirname(dirname(output.log))], companionEnv(tmpRoot));
    assert.equal(JSON.parse(cleaned.stdout).removed, true, "stop cleans the kept log session");
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});

test("visual companion guide names the residual key exposure", async () => {
  const guide = await readFile(resolve(process.cwd(), "core/skills/brainstorming/visual-companion.md"), "utf8");
  assert.match(guide, /Residual risks?:[^\n]*cookie[\s\S]*?(?:process list|launcher)[\s\S]*?history/iu);
});
