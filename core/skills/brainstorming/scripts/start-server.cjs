'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { directory, statePath, readPrivate, removeSession, readControl, controlRequest, delay } = require('./lifecycle.cjs');

function hostValue(value) {
  if (value === 'localhost' || net.isIP(value)) return value;
  if (/^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/u.test(value)) return value;
  throw new Error('host must be an IP address or plain hostname');
}

function options(argv) {
  const result = { host: '127.0.0.1', foreground: false, remote: false, open: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (['--project-dir', '--host', '--url-host', '--idle-timeout-minutes'].includes(flag)) {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
      if (flag === '--project-dir') result.project = value;
      else if (flag === '--host') result.host = hostValue(value);
      else if (flag === '--url-host') result.urlHost = hostValue(value);
      else {
        const minutes = Number(value);
        if (!/^[1-9][0-9]*$/u.test(value) || !Number.isSafeInteger(minutes) || minutes > Math.floor(2147483647 / 60000)) throw new Error('--idle-timeout-minutes must be a positive integer within the timer bound');
        result.idle = minutes * 60000;
      }
    } else if (flag === '--open') result.open = true;
    else if (flag === '--allow-remote') result.remote = true;
    else if (flag === '--foreground' || flag === '--no-daemon') result.foreground = true;
    else if (flag === '--background' || flag === '--daemon') result.foreground = false;
    else throw new Error(`Unknown argument: ${String(flag).slice(0, 160)}`);
  }
  if (!['localhost', '127.0.0.1', '::1'].includes(result.host) && !result.remote) throw new Error('non-loopback companion binding requires explicit --allow-remote');
  result.urlHost ||= ['localhost', '127.0.0.1', '::1'].includes(result.host) ? 'localhost' : result.host;
  return result;
}

function projectScreens(input) {
  const project = directory(path.resolve(input));
  let current = project;
  for (const name of ['.aaa', 'brainstorm']) {
    current = path.join(current, name);
    if (!fs.existsSync(current)) fs.mkdirSync(current, { mode: 0o700 });
    if (directory(current) !== current) throw new Error('symlinked project screen folder refused');
  }
  return current;
}

async function main() {
  const selected = options(process.argv.slice(2));
  const screenRoot = selected.project ? projectScreens(selected.project) : null;
  const temporary = fs.realpathSync(os.tmpdir());
  const session = fs.mkdtempSync(path.join(temporary, 'brainstorm-'));
  fs.chmodSync(session, 0o700);
  const state = path.join(session, 'state');
  const content = screenRoot ? path.join(screenRoot, path.basename(session)) : path.join(session, 'content');
  fs.mkdirSync(state, { mode: 0o700 });
  fs.mkdirSync(content, { mode: 0o700 });
  const instance = crypto.randomBytes(32).toString('hex');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^BRAINSTORM_/iu.test(key) && !/^NODE_(?:OPTIONS|PATH)$/iu.test(key)));
  Object.assign(env, { BRAINSTORM_DIR: session, BRAINSTORM_CONTENT_DIR: content, BRAINSTORM_HOST: selected.host, BRAINSTORM_URL_HOST: selected.urlHost });
  if (selected.idle) env.BRAINSTORM_IDLE_TIMEOUT_MS = String(selected.idle);
  if (selected.open) env.BRAINSTORM_OPEN = '1';
  const log = fs.openSync(path.join(state, 'server.log'), 'wx', 0o600);
  let child;
  try {
    const args = [path.join(__dirname, 'server.cjs'), `--brainstorm-server-id=${instance}`];
    if (selected.remote) args.push('--allow-remote');
    child = spawn(process.execPath, args, { env, detached: !selected.foreground, windowsHide: true, stdio: ['ignore', log, log], shell: false });
  } finally { fs.closeSync(log); }
  let spawnError;
  child.on('error', (error) => { spawnError = error; });
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code ?? 1)));
  const deadline = Date.now() + 5000;
  let ready;
  while (Date.now() < deadline && child.exitCode === null && !spawnError) {
    try {
      const record = readControl(statePath(session));
      if (record.instance !== instance || record.pid !== child.pid) throw new Error('startup identity mismatch');
      const status = await controlRequest(record, 'GET', '/status');
      if (status.status !== 'active') throw new Error('companion is not active');
      const info = JSON.parse(readPrivate(state, 'server-info'));
      const url = readPrivate(state, 'connection-url').trim();
      if (info.state_dir !== state || info.screen_dir !== content) throw new Error('startup paths changed');
      ready = { ...info, url };
      break;
    } catch { await delay(50); }
  }
  if (!ready) {
    if (child.exitCode === null && !spawnError) child.kill();
    const stopped = spawnError || child.exitCode !== null || await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 3000);
      exited.then(() => { clearTimeout(timer); resolve(true); });
    });
    if (stopped || spawnError) {
      removeSession(session);
      if (screenRoot && fs.existsSync(content) && directory(content) === content && fs.readdirSync(content).length === 0) fs.rmdirSync(content);
    }
    throw new Error(stopped || spawnError ? 'Server failed to start; private session removed' : `Server startup state is uncertain; retained session: ${session}`);
  }
  process.stdout.write(`${JSON.stringify(ready)}\n`);
  if (!selected.foreground) { child.unref(); return; }
  process.once('SIGINT', () => child.kill('SIGINT'));
  process.once('SIGTERM', () => child.kill('SIGTERM'));
  process.exitCode = await exited;
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({ error: String(error.message).slice(0, 512) })}\n`);
  process.exitCode = 1;
});
