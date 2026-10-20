'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const HEX_ID = /^[0-9a-f]{64}$/u;

function directory(target) {
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('linked or non-directory companion root refused');
  return fs.realpathSync(target);
}

function temporaryRoots() {
  const roots = [os.tmpdir()];
  if (process.platform !== 'win32') roots.push('/tmp');
  return [...new Set(roots.filter((root) => fs.existsSync(root)).map((root) => fs.realpathSync(root)))];
}

function sessionPath(input) {
  const requested = path.resolve(input);
  if (!/^brainstorm-[A-Za-z0-9_-]{6,}$/u.test(path.basename(requested))) throw new Error('not a disposable brainstorm session');
  const parent = fs.realpathSync(path.dirname(requested));
  if (!temporaryRoots().includes(parent)) throw new Error('session is outside the canonical temporary roots');
  const canonical = path.join(parent, path.basename(requested));
  if (fs.existsSync(requested) && directory(requested) !== canonical) throw new Error('linked session root refused');
  return canonical;
}

function statePath(session) {
  const state = path.join(session, 'state');
  if (directory(state) !== state) throw new Error('linked state root refused');
  return state;
}

function readPrivate(state, name) {
  if (directory(state) !== state) throw new Error('linked state root refused');
  const file = path.join(state, name);
  const before = fs.lstatSync(file, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size > 16384n) throw new Error('linked, oversized or non-regular state file refused');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const after = fs.fstatSync(fd, { bigint: true });
    const distinctVolume = before.dev !== 0n && after.dev !== 0n && after.dev !== before.dev;
    if (!after.isFile() || after.nlink !== 1n || after.ino !== before.ino || after.birthtimeNs !== before.birthtimeNs || distinctVolume || after.size > 16384n) throw new Error('state file changed while reading');
    const buffer = Buffer.alloc(16385);
    const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const current = fs.lstatSync(file, { bigint: true });
    if (bytes > 16384 || current.isSymbolicLink() || current.nlink !== 1n || current.ino !== after.ino || current.birthtimeNs !== after.birthtimeNs || directory(state) !== state) throw new Error('state file changed while reading');
    return buffer.subarray(0, bytes).toString('utf8');
  } finally { fs.closeSync(fd); }
}

function writePrivate(state, name, value) {
  if (directory(state) !== state) throw new Error('linked state root refused');
  const file = path.join(state, name);
  if (fs.existsSync(file)) readPrivate(state, name);
  const temporary = path.join(state, `.write-${crypto.randomBytes(12).toString('hex')}`);
  fs.writeFileSync(temporary, value, { flag: 'wx', mode: 0o600 });
  try { fs.renameSync(temporary, file); } finally {
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

function validateTree(session) {
  if (sessionPath(session) !== session) throw new Error('session path changed');
  let count = 0;
  function visit(target, depth) {
    if (++count > 10000 || depth > 16) throw new Error('session cleanup bounds exceeded');
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) throw new Error('linked cleanup target refused');
    if (stat.isDirectory()) {
      if (fs.realpathSync(target) !== target) throw new Error('redirected cleanup root refused');
      for (const name of fs.readdirSync(target)) visit(path.join(target, name), depth + 1);
    } else if (!stat.isFile() || stat.nlink !== 1) throw new Error('linked or non-regular cleanup target refused');
  }
  visit(session, 0);
}

function removeSession(session) {
  validateTree(session);
  const state = path.join(session, 'state');
  let removedEntries = 0;
  function remove(target) {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) throw new Error('cleanup target changed to a link');
    if (stat.isDirectory()) {
      if (directory(target) !== target) throw new Error('cleanup root changed');
      const names = fs.readdirSync(target);
      const last = target === session ? ['state'] : target === state ? ['control.json', 'server-stopped'] : [];
      for (const name of names.filter((name) => !last.includes(name))) remove(path.join(target, name));
      for (const name of last.filter((name) => names.includes(name))) remove(path.join(target, name));
      fs.rmdirSync(target);
    } else {
      if (!stat.isFile() || stat.nlink !== 1) throw new Error('cleanup target changed');
      fs.unlinkSync(target);
    }
    removedEntries += 1;
  }
  try { remove(session); } catch (error) {
    error.cleanupFailure = true;
    error.partial = removedEntries > 0;
    try { error.retryable = closedInstance(state, readControl(state).instance); } catch { error.retryable = false; }
    throw error;
  }
}

function readControl(state) {
  const record = JSON.parse(readPrivate(state, 'control.json'));
  if (record.version !== 1 || typeof record.instance !== 'string' || !HEX_ID.test(record.instance) || typeof record.secret !== 'string' || !HEX_ID.test(record.secret) || !Number.isInteger(record.port) || record.port < 1 || record.port > 65535 || !Number.isSafeInteger(record.pid) || record.pid < 1 || record.pid > 2147483647) throw new Error('invalid control identity');
  return record;
}

function controlRequest(record, method, endpoint) {
  return new Promise((resolve, reject) => {
    let deadline;
    const req = http.request({
      host: '127.0.0.1', port: record.port, method, path: endpoint,
      headers: { 'X-Brainstorm-Control': record.secret, 'X-Brainstorm-Instance': record.instance },
      agent: false, timeout: 1500
    }, (res) => {
      let bytes = 0;
      const chunks = [];
      res.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > 4096) res.destroy(new Error('control response exceeds bound'));
        else chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => {
        clearTimeout(deadline);
        try {
          if (res.statusCode !== 200) throw new Error('control request refused');
          const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (value.instance !== record.instance) throw new Error('control instance mismatch');
          resolve(value);
        } catch (error) { reject(error); }
      });
    });
    deadline = setTimeout(() => req.destroy(new Error('control total deadline exceeded')), 1500);
    req.on('timeout', () => req.destroy(new Error('control request timed out')));
    req.on('error', (error) => { clearTimeout(deadline); reject(error); });
    req.end();
  });
}

function socketAbsent(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(700);
    socket.on('connect', () => { socket.destroy(); resolve(false); });
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.on('error', (error) => resolve(error.code === 'ECONNREFUSED'));
  });
}

function processAbsent(pid) {
  try { process.kill(pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; }
}

function closedInstance(state, instance) {
  try { return JSON.parse(readPrivate(state, 'server-stopped')).instance === instance; } catch { return false; }
}

function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

module.exports = { HEX_ID, directory, temporaryRoots, sessionPath, statePath, readPrivate, writePrivate, validateTree, removeSession, readControl, controlRequest, socketAbsent, processAbsent, closedInstance, delay };
