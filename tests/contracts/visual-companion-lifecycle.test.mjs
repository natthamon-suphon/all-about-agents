import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, readdirSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const scripts = resolve("core/skills/brainstorming/scripts");
const start = join(scripts, "start-server.cjs");
const stop = join(scripts, "stop-server.cjs");
const available = existsSync(start) && existsSync(stop);

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "aaa-companion-")));
  const temporary = join(root, "temp ไทย & spaces");
  const project = join(root, "project ไทย & spaces");
  mkdirSync(temporary);
  mkdirSync(project);
  const env = { ...process.env, TMPDIR: temporary, TEMP: temporary, TMP: temporary };
  return { root, temporary, project, env };
}

function cli(file, args, env) {
  const result = spawnSync(process.execPath, [file, ...args], { env, encoding: "utf8", timeout: 15000, windowsHide: true });
  assert.equal(result.error, undefined, "the public Node command must finish within its deadline");
  let output;
  try { output = JSON.parse(result.stdout); } catch { assert.fail("the public Node command must return exactly one JSON value"); }
  return { status: result.status, output };
}

function asynchronousCli(file, args, env) {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [file, ...args], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("Node command exceeded test deadline")); }, 10000);
    child.stdout.on("data", (data) => { stdout += data; });
    child.on("error", reject);
    child.on("exit", (status) => {
      clearTimeout(timer);
      try { done({ status, output: JSON.parse(stdout) }); } catch (error) { reject(error); }
    });
  });
}

function started(f, args = [], env = f.env) {
  const result = cli(start, args, env);
  assert.equal(result.status, 0, result.output.error);
  return result.output;
}

function stopped(f, info) { return cli(stop, [dirname(info.state_dir)], f.env); }

function control(info, { secret, instance, origin, method = "GET", pathname = "/status" } = {}) {
  const record = JSON.parse(readFileSync(join(info.state_dir, "control.json"), "utf8"));
  return new Promise((resolveResponse, reject) => {
    const headers = { "X-Brainstorm-Control": secret ?? record.secret, "X-Brainstorm-Instance": instance ?? record.instance };
    if (origin) headers.Origin = origin;
    const request = http.request({ host: "127.0.0.1", port: record.port, path: pathname, method, headers, timeout: 2000 }, (response) => {
      let body = "";
      response.on("data", (data) => { body += data; });
      response.on("end", () => resolveResponse({ status: response.statusCode, body }));
    });
    request.on("timeout", () => request.destroy(new Error("control deadline")));
    request.on("error", reject);
    request.end();
  });
}

function removeFixture(f) {
  assert.equal(dirname(f.root), realpathSync(tmpdir()), "test cleanup stays inside its resolved disposable root");
  function remove(target) {
    if (lstatSync(target).isDirectory() && !lstatSync(target).isSymbolicLink()) {
      for (const name of readdirSync(target)) remove(join(target, name));
      rmdirSync(target);
    } else unlinkSync(target);
  }
  remove(f.root);
}

test("portable companion exposes executable Node start and stop commands", () => {
  assert.ok(existsSync(start), "Node start CLI is missing; Windows currently requires Bash");
  assert.ok(existsSync(stop), "Node stop CLI is missing; Windows currently requires Bash");
});

test("Node lifecycle survives starter exit, preserves project screens and supports repeated stop", { skip: !available }, async () => {
  const f = fixture();
  let info;
  try {
    info = started(f, ["--project-dir", f.project]);
    assert.equal(info.host, "127.0.0.1");
    assert.equal(dirname(dirname(info.state_dir)), f.temporary);
    assert.equal(dirname(info.screen_dir), join(f.project, ".aaa", "brainstorm"));
    writeFileSync(join(info.screen_dir, "001.html"), "<p>preserve $& $$ Thai ไทย</p>");
    await new Promise((done) => setTimeout(done, 350));
    const key = new URL(info.url).searchParams.get("key");
    const response = await fetch(`http://127.0.0.1:${info.port}/`, { headers: { cookie: `brainstorm-key-${info.port}=${key}` } });
    assert.equal(response.status, 200);
    assert.ok((await response.text()).includes("preserve $& $$ Thai ไทย"));
    assert.equal((await fetch(`http://127.0.0.1:${info.port}/`)).status, 403);
    assert.deepEqual(stopped(f, info), { status: 0, output: { status: "stopped", removed: true } });
    assert.equal(readFileSync(join(info.screen_dir, "001.html"), "utf8"), "<p>preserve $& $$ Thai ไทย</p>");
    assert.deepEqual(stopped(f, info), { status: 0, output: { status: "not_running", removed: false } });
  } finally {
    if (info && existsSync(info.state_dir)) stopped(f, info);
    removeFixture(f);
  }
});

test("Node start ignores inherited companion configuration and makes fresh credentials", { skip: !available }, async () => {
  const f = fixture();
  const infos = [];
  try {
    const hostile = { ...f.env, BRAINSTORM_HOST: "0.0.0.0", BRAINSTORM_ALLOW_REMOTE: "1", BRAINSTORM_DIR: f.project, BRAINSTORM_CONTENT_DIR: f.project, BRAINSTORM_OWNER_PID: "999999", BRAINSTORM_PORT: "1", BRAINSTORM_IDLE_TIMEOUT_MS: "1", BRAINSTORM_LIFECYCLE_CHECK_MS: "1", BRAINSTORM_OPEN: "1", BRAINSTORM_TOKEN: "inherited-key" };
    infos.push(started(f, [], hostile), started(f));
    const keys = infos.map((info) => new URL(info.url).searchParams.get("key"));
    assert.match(keys[0], /^[0-9a-f]{64}$/u);
    assert.notEqual(keys[0], keys[1], "keys are fresh");
    const controls = infos.map((info) => JSON.parse(readFileSync(join(info.state_dir, "control.json"), "utf8")));
    assert.notEqual(controls[0].secret, controls[1].secret, "control secrets are fresh");
    assert.notEqual(controls[0].instance, controls[1].instance, "instance identities are fresh");
    assert.equal(infos[0].idle_timeout_ms, 14400000);
    assert.equal(infos[0].host, "127.0.0.1");
    assert.equal((await control(infos[0])).status, 200);
    for (let index = 0; index < infos.length; index += 1) {
      const metadata = readFileSync(join(infos[index].state_dir, "server-info"), "utf8") + readFileSync(join(infos[index].state_dir, "server.log"), "utf8");
      assert.equal(metadata.includes(keys[index]), false, "browser key never appears in metadata/log");
      assert.equal(metadata.includes(controls[index].secret), false, "control secret never appears in metadata/log");
    }
  } finally {
    for (const info of infos) stopped(f, info);
    removeFixture(f);
  }
});

test("Node commands reject invalid flags, hosts and timeouts with bounded JSON errors", { skip: !available }, () => {
  const f = fixture();
  try {
    for (const args of [["--bogus\"flag"], ["--project-dir"], ["--host"], ["--url-host", "evil.test/path?key=bad"], ["--idle-timeout-minutes", "0"], ["--idle-timeout-minutes", "999999999999999999999999"]]) {
      const result = cli(start, args, f.env);
      assert.equal(result.status, 1);
      assert.equal(typeof result.output.error, "string");
      assert.ok(result.output.error.length <= 512);
    }
    assert.equal(cli(stop, [], f.env).status, 1);
    assert.equal(cli(stop, [f.project, "extra"], f.env).status, 1);
    const denied = cli(start, ["--host", "0.0.0.0"], { ...f.env, BRAINSTORM_ALLOW_REMOTE: "1" });
    assert.equal(denied.status, 1);
    assert.match(denied.output.error, /--allow-remote/u);
    assert.deepEqual(readdirSync(f.temporary), []);
  } finally { removeFixture(f); }
});

test("control needs its own secret and exact instance, and rejects browser Origin", { skip: !available }, async () => {
  const f = fixture();
  let info;
  try {
    info = started(f);
    for (const options of [{ secret: "wrong" }, { secret: new URL(info.url).searchParams.get("key") }, { instance: "wrong" }, { origin: "http://127.0.0.1" }]) {
      assert.equal((await control(info, { ...options, method: "POST", pathname: "/stop" })).status, 403);
    }
    assert.equal((await control(info)).status, 200, "failed stop requests leave the instance active");
    assert.deepEqual(stopped(f, info), { status: 0, output: { status: "stopped", removed: true } });
    await assert.rejects(fetch(`http://127.0.0.1:${info.port}/`, { signal: AbortSignal.timeout(1000) }));
  } finally {
    if (info && existsSync(info.state_dir)) stopped(f, info);
    removeFixture(f);
  }
});

test("stale instance and authentication mismatch refuse without deleting active state", { skip: !available }, async () => {
  const f = fixture();
  let info;
  let saved;
  try {
    info = started(f);
    const file = join(info.state_dir, "control.json");
    saved = readFileSync(file, "utf8");
    const original = JSON.parse(saved);
    for (const changed of [{ ...original, instance: "f".repeat(64) }, { ...original, secret: "e".repeat(64) }]) {
      writeFileSync(file, JSON.stringify(changed));
      const denied = stopped(f, info);
      assert.equal(denied.status, 1);
      assert.equal(denied.output.status, "refused");
      assert.equal(denied.output.removed, false);
      assert.equal(existsSync(join(info.state_dir, "connection-url")), true);
      writeFileSync(file, saved);
    }
    assert.equal((await control(info)).status, 200);
  } finally {
    if (info) {
      if (saved) writeFileSync(join(info.state_dir, "control.json"), saved);
      stopped(f, info);
    }
    removeFixture(f);
  }
});

test("malformed control credentials are refused before sending control requests", { skip: !available }, () => {
  const f = fixture();
  let info;
  let saved;
  try {
    info = started(f);
    const file = join(info.state_dir, "control.json");
    saved = readFileSync(file, "utf8");
    const record = JSON.parse(saved);
    writeFileSync(file, JSON.stringify({ ...record, secret: [record.secret] }));
    const denied = stopped(f, info);
    assert.equal(denied.output.status, "refused");
    assert.equal(denied.output.removed, false);
    assert.equal(existsSync(join(info.state_dir, "connection-url")), true);
  } finally {
    if (info && existsSync(info.state_dir)) {
      if (saved) writeFileSync(join(info.state_dir, "control.json"), saved);
      stopped(f, info);
    }
    removeFixture(f);
  }
});

test("control never sends credentials to metadata URLs", { skip: !available }, async () => {
  const f = fixture();
  let info;
  let received = false;
  const trap = http.createServer((_request, response) => { received = true; response.end(); });
  await new Promise((done) => trap.listen(0, "127.0.0.1", done));
  try {
    info = started(f, ["--host", "127.0.0.1", "--url-host", "example.invalid"]);
    const metadataFile = join(info.state_dir, "server-info");
    const metadata = JSON.parse(readFileSync(metadataFile, "utf8"));
    writeFileSync(metadataFile, JSON.stringify({ ...metadata, url: `http://127.0.0.1:${trap.address().port}/`, url_host: `127.0.0.1:${trap.address().port}` }));
    assert.equal(stopped(f, info).output.status, "stopped");
    assert.equal(received, false);
  } finally {
    if (info && existsSync(info.state_dir)) stopped(f, info);
    await new Promise((done) => trap.close(done));
    removeFixture(f);
  }
});

test("redirect, oversized, slow and absent-but-live control states retain the session", { skip: !available }, async () => {
  const f = fixture();
  let info;
  let saved;
  let mode = "redirect";
  const sockets = new Set();
  const fake = http.createServer((_request, response) => {
    if (mode === "redirect") { response.writeHead(302, { Location: "http://example.invalid/" }); response.end(); }
    else if (mode === "oversized") response.end("x".repeat(5000));
    else if (mode === "slow") {
      const timer = setInterval(() => response.write(" "), 100);
      response.on("close", () => clearInterval(timer));
    }
  });
  fake.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  await new Promise((done) => fake.listen(0, "127.0.0.1", done));
  try {
    info = started(f);
    const file = join(info.state_dir, "control.json");
    saved = readFileSync(file, "utf8");
    const record = JSON.parse(saved);
    writeFileSync(file, JSON.stringify({ ...record, port: fake.address().port }));
    for (mode of ["redirect", "oversized", "slow"]) {
      const before = Date.now();
      const denied = await asynchronousCli(stop, [dirname(info.state_dir)], f.env);
      assert.equal(denied.status, 1);
      assert.equal(denied.output.status, "refused");
      assert.equal(denied.output.removed, false);
      assert.equal(existsSync(file), true);
      assert.ok(Date.now() - before < 5000, "control has a total deadline even while bytes arrive");
    }
    for (const socket of sockets) socket.destroy();
    await new Promise((done) => fake.close(done));
    const denied = stopped(f, info);
    assert.equal(denied.output.status, "refused", "absent control plus an active PID is uncertain");
    assert.equal(denied.output.removed, false);
  } finally {
    for (const socket of sockets) socket.destroy();
    if (fake.listening) await new Promise((done) => fake.close(done));
    if (info) {
      if (saved) writeFileSync(join(info.state_dir, "control.json"), saved);
      stopped(f, info);
    }
    removeFixture(f);
  }
});

test("authenticated stop closes live WebSocket and incomplete HTTP connections", { skip: !available }, async () => {
  const f = fixture();
  let info;
  const sockets = [];
  try {
    info = started(f);
    const websocket = net.createConnection({ host: "127.0.0.1", port: info.port });
    sockets.push(websocket);
    const key = new URL(info.url).searchParams.get("key");
    await new Promise((done, reject) => {
      websocket.on("error", reject);
      websocket.on("connect", () => websocket.write(`GET /?key=${key} HTTP/1.1\r\nHost: 127.0.0.1:${info.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`));
      websocket.once("data", (data) => { assert.match(data.toString(), /^HTTP\/1.1 101/u); done(); });
    });
    const incomplete = net.createConnection({ host: "127.0.0.1", port: info.port });
    sockets.push(incomplete);
    await new Promise((done) => incomplete.on("connect", () => { incomplete.write("GET / HTTP/1.1\r\n"); done(); }));
    const closed = sockets.map((socket) => new Promise((done) => socket.on("close", done)));
    assert.equal(stopped(f, info).output.status, "stopped");
    await Promise.race([Promise.all(closed), new Promise((_done, reject) => setTimeout(() => reject(new Error("active sockets were not closed")), 2000))]);
    assert.equal(existsSync(info.state_dir), false);
  } finally {
    for (const socket of sockets) socket.destroy();
    if (info && existsSync(info.state_dir)) stopped(f, info);
    removeFixture(f);
  }
});

test("idle shutdown confirms the matching closed instance before stale cleanup", { skip: !available }, () => {
  const f = fixture();
  const session = join(f.temporary, "brainstorm-idlefixture");
  try {
    const result = spawnSync(process.execPath, [join(scripts, "server.cjs")], {
      env: { ...f.env, BRAINSTORM_DIR: session, BRAINSTORM_IDLE_TIMEOUT_MS: "200", BRAINSTORM_LIFECYCLE_CHECK_MS: "50" },
      encoding: "utf8", timeout: 5000, windowsHide: true
    });
    assert.equal(result.status, 0);
    const record = JSON.parse(readFileSync(join(session, "state", "control.json"), "utf8"));
    const closed = JSON.parse(readFileSync(join(session, "state", "server-stopped"), "utf8"));
    assert.equal(closed.instance, record.instance);
    assert.equal(closed.reason, "idle timeout");
    assert.equal(existsSync(join(session, "state", "connection-url")), false);
    assert.deepEqual(cli(stop, [session], f.env), { status: 0, output: { status: "stale", removed: true } });
  } finally { removeFixture(f); }
});

test("new Unicode project screens clear the previous bounded event log", { skip: !available }, async () => {
  const f = fixture();
  let info;
  try {
    info = started(f, ["--project-dir", f.project]);
    const events = join(info.state_dir, "events");
    writeFileSync(events, '{"type":"choice","value":"old"}\n');
    writeFileSync(join(info.screen_dir, "001-ไทย.html"), "<p>new screen</p>");
    await new Promise((done) => setTimeout(done, 300));
    assert.equal(existsSync(events), false, "a new filename must clear events even on Unicode paths");
  } finally {
    if (info) stopped(f, info);
    removeFixture(f);
  }
});

test("linked project folders and session roots are refused without touching their targets", { skip: !available }, () => {
  const f = fixture();
  let info;
  try {
    symlinkSync(f.temporary, join(f.project, ".aaa"), process.platform === "win32" ? "junction" : "dir");
    assert.equal(cli(start, ["--project-dir", f.project], f.env).status, 1);
    assert.deepEqual(readdirSync(f.temporary), []);
    info = started(f);
    const alias = join(f.temporary, "brainstorm-linkedroot");
    symlinkSync(dirname(info.state_dir), alias, process.platform === "win32" ? "junction" : "dir");
    const denied = cli(stop, [alias], f.env);
    assert.equal(denied.output.status, "refused");
    assert.equal(denied.output.removed, false);
    assert.equal(existsSync(info.state_dir), true);
  } finally {
    if (info) stopped(f, info);
    removeFixture(f);
  }
});

test("linked control files and content targets block cleanup and preserve targets", { skip: !available }, () => {
  const f = fixture();
  let info;
  try {
    info = started(f);
    const recordFile = join(info.state_dir, "control.json");
    const saved = readFileSync(recordFile);
    const outside = join(f.project, "control-copy");
    writeFileSync(outside, saved);
    unlinkSync(recordFile);
    linkSync(outside, recordFile);
    assert.equal(stopped(f, info).output.status, "refused");
    assert.deepEqual(readFileSync(outside), saved);
    unlinkSync(recordFile);
    writeFileSync(recordFile, saved);
    const target = join(f.project, "keep.txt");
    writeFileSync(target, "keep");
    linkSync(target, join(info.screen_dir, "linked.txt"));
    const denied = stopped(f, info);
    assert.equal(denied.output.status, "refused");
    assert.equal(denied.output.removed, false);
    assert.equal(readFileSync(target, "utf8"), "keep");
    unlinkSync(join(info.screen_dir, "linked.txt"));
  } finally {
    if (info) stopped(f, info);
    removeFixture(f);
  }
});

test("a remote main bind keeps authenticated control on numeric loopback", { skip: !available }, async () => {
  const f = fixture();
  let info;
  try {
    info = started(f, ["--host", "0.0.0.0", "--allow-remote", "--url-host", "127.0.0.1"]);
    assert.equal(info.host, "0.0.0.0");
    assert.equal((await control(info)).status, 200);
    assert.equal(stopped(f, info).output.status, "stopped");
  } finally {
    if (info && existsSync(info.state_dir)) stopped(f, info);
    removeFixture(f);
  }
});

test("foreground prints readiness and ends when the exact instance is stopped", { skip: !available }, async () => {
  const f = fixture();
  const child = spawn(process.execPath, [start, "--foreground"], { env: f.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const exited = new Promise((done) => child.on("exit", (code) => done(code)));
  let info;
  try {
    info = await new Promise((done, reject) => {
      let text = "";
      const timer = setTimeout(() => reject(new Error("foreground readiness deadline")), 10000);
      child.stdout.on("data", (data) => {
        text += data;
        if (text.includes("\n")) { clearTimeout(timer); done(JSON.parse(text.trim())); }
      });
      child.on("error", reject);
    });
    assert.equal(stopped(f, info).output.status, "stopped");
    assert.equal(await exited, 0);
  } finally {
    if (info && existsSync(info.state_dir)) stopped(f, info);
    if (child.exitCode === null) child.kill();
    removeFixture(f);
  }
});

test("failed and timed-out startup cancel only the owned child and clean empty screens", { skip: !available }, () => {
  const f = fixture();
  const copy = join(f.root, "copied-lifecycle");
  mkdirSync(copy);
  for (const name of ["start-server.cjs", "lifecycle.cjs"]) copyFileSync(join(scripts, name), join(copy, name));
  const pidFile = join(f.root, "owned-child.pid");
  try {
    for (const mode of ["crash", "timeout"]) {
      const server = mode === "crash" ? 'process.exit(1);' : "require('node:fs').writeFileSync(process.env.AAA_COMPANION_TEST_PID, String(process.pid)); setTimeout(() => process.exit(0), 15000);";
      writeFileSync(join(copy, "server.cjs"), server);
      const result = cli(join(copy, "start-server.cjs"), ["--project-dir", f.project], { ...f.env, AAA_COMPANION_TEST_PID: pidFile });
      assert.equal(result.status, 1);
      assert.equal(typeof result.output.error, "string");
      assert.deepEqual(readdirSync(f.temporary), [], "confirmed child exit permits disposable session cleanup");
      assert.deepEqual(readdirSync(join(f.project, ".aaa", "brainstorm")), [], "only the empty screen folder is removed");
      if (mode === "timeout") {
        const pid = Number(readFileSync(pidFile, "utf8"));
        assert.throws(() => process.kill(pid, 0), { code: "ESRCH" }, "the directly owned startup child must have exited");
      }
    }
  } finally { removeFixture(f); }
});

test("partial cleanup errors retain instance proof and allow a safe CLI retry", { skip: !available }, () => {
  const f = fixture();
  let info;
  try {
    info = started(f, ["--project-dir", f.project]);
    const screen = join(info.screen_dir, "001-preserved.html");
    writeFileSync(screen, "<p>preserve project content</p>");
    const controlFile = join(info.state_dir, "control.json");
    const identity = JSON.parse(readFileSync(controlFile, "utf8")).instance;
    const faultFile = join(f.root, "cleanup-unlink-fault.cjs");
    const blockedFile = join(info.state_dir, "server.log");
    writeFileSync(faultFile, `const fs = require('node:fs'); const original = fs.unlinkSync; fs.unlinkSync = function(target) { if (String(target) === ${JSON.stringify(blockedFile)}) { const error = new Error('synthetic sharing violation'); error.code = 'EPERM'; throw error; } return original.apply(this, arguments); };\n`);
    const result = cli(stop, [dirname(info.state_dir)], { ...f.env, NODE_OPTIONS: `--require "${faultFile.replaceAll("\\", "/")}"` });
    assert.equal(result.status, 1);
    assert.equal(result.output.status, "error", "a cleanup failure after mutation must not report refusal");
    assert.equal(result.output.removed, false);
    assert.equal(result.output.partial, true);
    assert.equal(result.output.retryable, true);
    assert.equal(JSON.parse(readFileSync(controlFile, "utf8")).instance, identity, "retain ownership proof after partial cleanup");
    assert.equal(JSON.parse(readFileSync(join(info.state_dir, "server-stopped"), "utf8")).instance, identity, "retain matching closure proof");
    assert.equal(existsSync(join(info.state_dir, "server-instance-id")), false, "the fault occurs after a real file deletion");
    assert.equal(readFileSync(screen, "utf8"), "<p>preserve project content</p>");
    assert.deepEqual(stopped(f, info), { status: 0, output: { status: "stale", removed: true } });
    assert.equal(existsSync(dirname(info.state_dir)), false);
    assert.equal(readFileSync(screen, "utf8"), "<p>preserve project content</p>");
  } finally {
    if (info && existsSync(info.state_dir)) stopped(f, info);
    removeFixture(f);
  }
});

test("final directory cleanup errors report when automatic retry proof is gone", { skip: !available }, () => {
  const f = fixture();
  let info;
  try {
    info = started(f, ["--project-dir", f.project]);
    const screen = join(info.screen_dir, "001-preserved.html");
    writeFileSync(screen, "<p>preserve project content</p>");
    const faultFile = join(f.root, "cleanup-rmdir-fault.cjs");
    writeFileSync(faultFile, `const fs = require('node:fs'); const original = fs.rmdirSync; fs.rmdirSync = function(target) { if (String(target) === ${JSON.stringify(info.state_dir)}) { const error = new Error('synthetic directory sharing violation'); error.code = 'EPERM'; throw error; } return original.apply(this, arguments); };\n`);
    const result = cli(stop, [dirname(info.state_dir)], { ...f.env, NODE_OPTIONS: `--require "${faultFile.replaceAll("\\", "/")}"` });
    assert.equal(result.status, 1);
    assert.equal(result.output.status, "error");
    assert.equal(result.output.removed, false);
    assert.equal(result.output.partial, true);
    assert.equal(result.output.retryable, false);
    assert.deepEqual(readdirSync(info.state_dir), [], "final directory failure occurs after proof removal");
    const retry = stopped(f, info);
    assert.equal(retry.status, 1);
    assert.equal(retry.output.status, "refused", "missing ownership proof must not be invented on retry");
    assert.equal(retry.output.removed, false);
    assert.equal(readFileSync(screen, "utf8"), "<p>preserve project content</p>");
  } finally { removeFixture(f); }
});
