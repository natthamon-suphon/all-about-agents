'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const OPCODES = Object.freeze({ TEXT: 0x01, CLOSE: 0x08, PING: 0x09, PONG: 0x0a });
const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME_PAYLOAD_BYTES = 64 * 1024;
const MAX_EVENT_BYTES = 4096;
const MAX_EVENT_TEXT_LENGTH = 512;
const MAX_EVENT_QUEUE_LENGTH = 64;
const MAX_EVENT_LOG_BYTES = 256 * 1024;
const MAX_CONNECTIONS = 16;

const SESSION_DIR = path.resolve(process.env.BRAINSTORM_DIR || path.join(os.tmpdir(), 'brainstorm'));
const CONTENT_DIR = path.join(SESSION_DIR, 'content');
const STATE_DIR = path.join(SESSION_DIR, 'state');
const PORT_FILE = process.env.BRAINSTORM_PORT_FILE || null;
const TOKEN_FILE = process.env.BRAINSTORM_TOKEN_FILE || null;
const HOST = process.env.BRAINSTORM_HOST || '127.0.0.1';
const URL_HOST = process.env.BRAINSTORM_URL_HOST || (HOST === '127.0.0.1' ? 'localhost' : HOST);
const ALLOW_REMOTE = process.env.BRAINSTORM_ALLOW_REMOTE === '1';
const OWNER_PID = process.env.BRAINSTORM_OWNER_PID ? Number(process.env.BRAINSTORM_OWNER_PID) : null;
const IDLE_TIMEOUT_MS = Number.isFinite(Number(process.env.BRAINSTORM_IDLE_TIMEOUT_MS)) && Number(process.env.BRAINSTORM_IDLE_TIMEOUT_MS) > 0
  ? Number(process.env.BRAINSTORM_IDLE_TIMEOUT_MS)
  : 4 * 60 * 60 * 1000;
const LIFECYCLE_CHECK_MS = Number.isFinite(Number(process.env.BRAINSTORM_LIFECYCLE_CHECK_MS)) && Number(process.env.BRAINSTORM_LIFECYCLE_CHECK_MS) > 0
  ? Number(process.env.BRAINSTORM_LIFECYCLE_CHECK_MS)
  : 60 * 1000;

const MIME_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml'
});
const CONTENT_SECURITY_POLICY = "default-src 'none'; base-uri 'none'; connect-src 'self'; img-src 'self' data:; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'; form-action 'none'; object-src 'none'; font-src 'none'; media-src 'none'";

function isLoopbackHost(host) {
  const normalized = String(host || '').trim().toLowerCase().replace(/^\[|\]$/gu, '');
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function assertBindPolicy() {
  if (!isLoopbackHost(HOST) && !ALLOW_REMOTE) {
    throw new Error('non-loopback companion binding requires BRAINSTORM_ALLOW_REMOTE=1');
  }
}

function compareText(left, right) {
  return left === right ? 0 : left < right ? -1 : 1;
}

function computeAcceptKey(clientKey) {
  return crypto.createHash('sha1').update(String(clientKey) + WS_MAGIC).digest('base64');
}

function encodeFrame(opcode, payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || '');
  if (body.length > MAX_FRAME_PAYLOAD_BYTES) throw new RangeError('WebSocket frame payload exceeds maximum allowed size');
  const first = 0x80 | (opcode & 0x0f);
  if (body.length < 126) return Buffer.concat([Buffer.from([first, body.length]), body]);
  if (body.length < 65536) {
    const header = Buffer.alloc(4);
    header[0] = first;
    header[1] = 126;
    header.writeUInt16BE(body.length, 2);
    return Buffer.concat([header, body]);
  }
  const header = Buffer.alloc(10);
  header[0] = first;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(body.length), 2);
  return Buffer.concat([header, body]);
}

function decodeFrame(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError('WebSocket frame must be a Buffer');
  if (buffer.length < 2) return null;
  const first = buffer[0];
  const second = buffer[1];
  const fin = (first & 0x80) !== 0;
  const opcode = first & 0x0f;
  const masked = (second & 0x80) !== 0;
  let payloadLength = second & 0x7f;
  let offset = 2;
  if (!fin || (first & 0x70) !== 0) throw new Error('fragmented or reserved WebSocket frames are not supported');
  if (!masked) throw new Error('Client frames must be masked');
  if (![OPCODES.TEXT, OPCODES.CLOSE, OPCODES.PING, OPCODES.PONG].includes(opcode)) throw new Error('unsupported WebSocket opcode');
  if (opcode >= 0x08 && (payloadLength > 125 || !fin)) throw new Error('invalid WebSocket control frame');
  if (payloadLength === 126) {
    if (buffer.length < 4) return null;
    payloadLength = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLength === 127) {
    if (buffer.length < 10) return null;
    const extendedLength = buffer.readBigUInt64BE(2);
    if (extendedLength > BigInt(MAX_FRAME_PAYLOAD_BYTES)) throw new Error('WebSocket frame payload exceeds maximum allowed size');
    payloadLength = Number(extendedLength);
    offset = 10;
  }
  if (payloadLength > MAX_FRAME_PAYLOAD_BYTES) throw new Error('WebSocket frame payload exceeds maximum allowed size');
  const maskOffset = offset;
  const dataOffset = offset + 4;
  const totalLength = dataOffset + payloadLength;
  if (buffer.length < totalLength) return null;
  const mask = buffer.subarray(maskOffset, dataOffset);
  const payload = Buffer.alloc(payloadLength);
  for (let index = 0; index < payloadLength; index += 1) payload[index] = buffer[dataOffset + index] ^ mask[index % 4];
  return { opcode, payload, bytesConsumed: totalLength };
}

function boundedText(value, fallback = '') {
  const text = typeof value === 'string' ? value : String(value ?? fallback);
  return [...text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')]
    .slice(0, MAX_EVENT_TEXT_LENGTH).join('');
}

function redactToken(value, token = TOKEN) {
  const text = String(value ?? '');
  return token && text.includes(token) ? text.split(token).join('[redacted]') : text;
}

function eventBytes(event) {
  return Buffer.byteLength(JSON.stringify(event), 'utf8');
}

function normalizeEvent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const type = value.type === 'click' || value.type === 'choice' ? value.type : null;
  if (!type) return null;
  const event = { type, timestamp: Date.now() };
  for (const key of ['choice', 'id', 'text', 'value']) {
    if (value[key] !== undefined && value[key] !== null) event[key] = redactToken(boundedText(value[key]));
  }
  if (type === 'click' && typeof event.choice !== 'string') return null;
  return eventBytes(event) <= MAX_EVENT_BYTES ? event : null;
}

function timingSafeEqualString(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseCookies(header) {
  const cookies = {};
  if (typeof header !== 'string') return cookies;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator > 0) cookies[part.slice(0, separator).trim()] = part.slice(separator + 1).trim();
  }
  return cookies;
}

function queryValue(url, key) {
  try { return new URL(url, 'http://localhost').searchParams.get(key); } catch { return null; }
}

function pathnameOf(url) {
  try { return new URL(url, 'http://localhost').pathname; } catch { return '/'; }
}

function isAuthorized(req) {
  const queryKey = queryValue(req.url, 'key');
  if (queryKey && timingSafeEqualString(queryKey, TOKEN)) return true;
  const cookie = parseCookies(req.headers.cookie)[COOKIE_NAME];
  return Boolean(cookie && timingSafeEqualString(cookie, TOKEN));
}

function securityHeaders(extra = {}) {
  return {
    'Cache-Control': 'no-store',
    'Content-Security-Policy': CONTENT_SECURITY_POLICY,
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), geolocation=(), microphone=()',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    ...extra
  };
}

function safeRealpath(filePath) {
  try { return fs.realpathSync(filePath); } catch { return null; }
}

function isContained(root, target) {
  const relative = path.relative(root, target);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function isRegularFileInsideContentDir(filePath) {
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) return false;
    const root = safeRealpath(CONTENT_DIR);
    const target = safeRealpath(filePath);
    return Boolean(root && target && isContained(root, target));
  } catch { return false; }
}

function newestScreen() {
  let entries;
  try { entries = fs.readdirSync(CONTENT_DIR); } catch { return null; }
  return entries
    .filter((name) => !name.startsWith('.') && name.endsWith('.html'))
    .map((name) => {
      const filePath = path.join(CONTENT_DIR, name);
      if (!isRegularFileInsideContentDir(filePath)) return null;
      try { return { filePath, name, mtime: fs.statSync(filePath).mtimeMs }; } catch { return null; }
    })
    .filter(Boolean)
    .sort((left, right) => right.mtime - left.mtime || compareText(right.name, left.name))[0]?.filePath || null;
}

function isFullDocument(html) {
  return html.trimStart().toLowerCase().startsWith('<!doctype') || html.trimStart().toLowerCase().startsWith('<html');
}

function companionUrl(port) {
  const host = String(URL_HOST).replace(/[\u0000-\u001f\u007f]/gu, '');
  const displayHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return `http://${displayHost}:${port}/?key=${TOKEN}`;
}

function browserLauncherForPlatform(url, { platform = process.platform, osRelease = os.release(), env = process.env } = {}) {
  const isWsl = platform === 'linux' && /microsoft/iu.test(osRelease);
  if (platform === 'darwin') return { bin: 'open', args: [url] };
  if (platform === 'win32' || isWsl) return { bin: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] };
  if (env.DISPLAY || env.WAYLAND_DISPLAY) return { bin: 'xdg-open', args: [url] };
  return null;
}

function loadTemplates() {
  const frame = fs.readFileSync(path.join(__dirname, 'frame-template.html'), 'utf8');
  const helper = fs.readFileSync(path.join(__dirname, 'helper.js'), 'utf8');
  return { frame, helperInjection: `<script>\n${helper}\n</script>` };
}

function waitingPage() {
  return '<!doctype html><html><head><meta charset="utf-8"><title>Brainstorm Companion</title></head><body><h1>Brainstorm Companion</h1><p>Waiting for the agent to push a screen...</p></body></html>';
}

const FORBIDDEN_PAGE = '<!doctype html><html><head><meta charset="utf-8"><title>Session key required</title></head><body><h1>Session key required</h1><p>Open the complete URL supplied by the coding agent.</p></body></html>';

function bootstrapPage(key) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Opening Brainstorm Companion</title></head><body><script>try{sessionStorage.setItem('brainstorm-session-key',${JSON.stringify(String(key))})}catch{}location.replace('/')</script></body></html>`;
}

function appendEvent(event) {
  const eventsPath = path.join(STATE_DIR, 'events');
  try {
    if (fs.existsSync(eventsPath)) {
      const stat = fs.lstatSync(eventsPath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) return false;
      if (stat.size + eventBytes(event) + 1 > MAX_EVENT_LOG_BYTES) return false;
    }
    fs.appendFileSync(eventsPath, `${JSON.stringify(event)}\n`, { encoding: 'utf8', flag: 'a', mode: 0o600 });
    return true;
  } catch { return false; }
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'http:' && parsed.host === req.headers.host;
  } catch { return false; }
}

function startServer() {
  assertBindPolicy();
  fs.mkdirSync(CONTENT_DIR, { recursive: true });
  fs.mkdirSync(STATE_DIR, { recursive: true });
  if (!safeRealpath(CONTENT_DIR) || !safeRealpath(STATE_DIR)) throw new Error('companion session roots could not be canonicalized');

  let port = Number(process.env.BRAINSTORM_PORT);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    try { port = Number(fs.readFileSync(PORT_FILE, 'utf8').trim()); } catch { port = 0; }
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535) port = 0;
  let tokenSource = 'generated';
  let token = process.env.BRAINSTORM_TOKEN;
  if (typeof token === 'string' && /^[0-9a-f]{32,}$/iu.test(token.trim())) {
    token = token.trim();
    tokenSource = 'environment';
  } else {
    token = null;
    if (TOKEN_FILE) {
      try {
        const saved = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
        if (/^[0-9a-f]{32,}$/iu.test(saved)) { token = saved; tokenSource = 'file'; }
      } catch { /* first start */ }
    }
    if (!token) token = crypto.randomBytes(32).toString('hex');
  }

  TOKEN = token;
  COOKIE_NAME = 'brainstorm-key-pending';
  const templates = loadTemplates();
  const clients = new Set();
  let lastActivity = Date.now();
  let browserOpened = false;
  let actualPort = port;
  let fallbackTried = false;
  let lifecycleCheck;

  function touchActivity() { lastActivity = Date.now(); }
  function shutdown(reason) {
    watcher.close();
    clearInterval(lifecycleCheck);
    for (const socket of clients) { try { socket.destroy(); } catch { /* already closed */ } }
    try { fs.rmSync(path.join(STATE_DIR, 'server-info'), { force: true }); } catch { /* best effort */ }
    fs.writeFileSync(path.join(STATE_DIR, 'server-stopped'), JSON.stringify({ reason: redactToken(reason) }) + '\n', { mode: 0o600 });
    server.close(() => process.exit(0));
  }
  function ownerAlive() {
    if (!OWNER_PID) return true;
    try { process.kill(OWNER_PID, 0); return true; } catch (error) { return error?.code === 'EPERM'; }
  }
  function maybeOpenBrowser() {
    if (browserOpened || process.env.BRAINSTORM_OPEN !== '1' || !isLoopbackHost(HOST) || clients.size > 0) return;
    browserOpened = true;
    const launcher = browserLauncherForPlatform(companionUrl(actualPort));
    if (!launcher) return;
    try { require('child_process').execFile(launcher.bin, launcher.args, { windowsHide: true }, () => {}); } catch { /* optional browser launch */ }
  }
  function handleMessage(socket, text) {
    if (Buffer.byteLength(text, 'utf8') > MAX_EVENT_BYTES) return;
    let parsed;
    try { parsed = JSON.parse(text); } catch { return; }
    const event = normalizeEvent(parsed);
    if (!event || !appendEvent(event)) return;
    touchActivity();
    // Log only the event type. Event values may contain private user input.
    console.log(JSON.stringify({ type: 'user-event', eventType: event.type }));
  }
  function handleUpgrade(req, socket) {
    if (clients.size >= MAX_CONNECTIONS || !isAuthorized(req) || !sameOrigin(req)) { socket.destroy(); return; }
    const websocketKey = req.headers['sec-websocket-key'];
    if (typeof websocketKey !== 'string' || websocketKey.length > 128) { socket.destroy(); return; }
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${computeAcceptKey(websocketKey)}\r\n\r\n`);
    let buffer = Buffer.alloc(0);
    clients.add(socket);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > MAX_FRAME_PAYLOAD_BYTES + 14) { socket.destroy(); return; }
      while (buffer.length > 0) {
        let frame;
        try { frame = decodeFrame(buffer); } catch { socket.end(encodeFrame(OPCODES.CLOSE, Buffer.alloc(0))); return; }
        if (!frame) return;
        buffer = buffer.subarray(frame.bytesConsumed);
        if (frame.opcode === OPCODES.TEXT) handleMessage(socket, frame.payload.toString('utf8'));
        else if (frame.opcode === OPCODES.CLOSE) { socket.end(encodeFrame(OPCODES.CLOSE, Buffer.alloc(0))); return; }
        else if (frame.opcode === OPCODES.PING) socket.write(encodeFrame(OPCODES.PONG, frame.payload));
      }
    });
    socket.on('close', () => clients.delete(socket));
    socket.on('error', () => clients.delete(socket));
  }
  function handleRequest(req, res) {
    if (!isAuthorized(req)) { res.writeHead(403, securityHeaders({ 'Content-Type': 'text/html; charset=utf-8' })); res.end(FORBIDDEN_PAGE); return; }
    touchActivity();
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=${TOKEN}; HttpOnly; SameSite=Strict; Path=/`);
    const pathname = pathnameOf(req.url);
    const queryKey = queryValue(req.url, 'key');
    if (req.method === 'GET' && pathname === '/' && queryKey && timingSafeEqualString(queryKey, TOKEN)) {
      res.writeHead(200, securityHeaders({ 'Content-Type': 'text/html; charset=utf-8' }));
      res.end(bootstrapPage(queryKey));
      return;
    }
    if (req.method === 'GET' && pathname === '/') {
      const screenPath = newestScreen();
      let html = screenPath ? fs.readFileSync(screenPath, 'utf8') : waitingPage();
      if (!isFullDocument(html)) html = templates.frame.replace('<!-- CONTENT -->', html);
      html = html.includes('</body>') ? html.replace('</body>', `${templates.helperInjection}\n</body>`) : `${html}${templates.helperInjection}`;
      res.writeHead(200, securityHeaders({ 'Content-Type': 'text/html; charset=utf-8' }));
      res.end(html);
      return;
    }
    if (req.method === 'GET' && pathname.startsWith('/files/')) {
      let fileName;
      try { fileName = decodeURIComponent(pathname.slice('/files/'.length)); } catch { fileName = ''; }
      const filePath = path.resolve(CONTENT_DIR, fileName);
      if (!fileName || fileName.startsWith('.') || fileName !== path.basename(fileName) || !isRegularFileInsideContentDir(filePath)) {
        res.writeHead(404, securityHeaders());
        res.end('Not found');
        return;
      }
      const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, securityHeaders({ 'Content-Type': contentType }));
      res.end(fs.readFileSync(filePath));
      return;
    }
    res.writeHead(404, securityHeaders());
    res.end('Not found');
  }

  const server = http.createServer(handleRequest);
  server.on('upgrade', handleUpgrade);
  const knownFiles = new Set();
  const watcher = fs.watch(CONTENT_DIR, (_eventType, filename) => {
    if (!filename || !filename.endsWith('.html') || filename.startsWith('.')) return;
    const filePath = path.join(CONTENT_DIR, filename);
    if (!isRegularFileInsideContentDir(filePath)) return;
    touchActivity();
    if (!knownFiles.has(filename)) { knownFiles.add(filename); try { fs.rmSync(path.join(STATE_DIR, 'events'), { force: true }); } catch { /* best effort */ } maybeOpenBrowser(); }
    const message = encodeFrame(OPCODES.TEXT, Buffer.from(JSON.stringify({ type: 'reload' })));
    for (const socket of clients) { try { socket.write(message); } catch { clients.delete(socket); } }
  });
  watcher.on('error', () => {});
  lifecycleCheck = setInterval(() => {
    if (!ownerAlive()) shutdown('owner process exited');
    else if (Date.now() - lastActivity > IDLE_TIMEOUT_MS) shutdown('idle timeout');
  }, LIFECYCLE_CHECK_MS);
  lifecycleCheck.unref();

  function onListen() {
    COOKIE_NAME = `brainstorm-key-${actualPort}`;
    if (PORT_FILE && !fallbackTried) {
      try { fs.writeFileSync(PORT_FILE, String(actualPort), { mode: 0o600 }); } catch { /* optional persistence */ }
      if (TOKEN_FILE) { try { fs.writeFileSync(TOKEN_FILE, TOKEN + '\n', { mode: 0o600 }); } catch { /* optional persistence */ } }
    }
    const info = {
      type: 'server-started',
      port: actualPort,
      host: HOST,
      url_host: URL_HOST,
      screen_dir: CONTENT_DIR,
      state_dir: STATE_DIR,
      idle_timeout_ms: IDLE_TIMEOUT_MS,
      token_source: tokenSource
    };
    fs.writeFileSync(path.join(STATE_DIR, 'server-info'), JSON.stringify(info) + '\n', { mode: 0o600 });
    fs.writeFileSync(path.join(STATE_DIR, 'connection-url'), companionUrl(actualPort) + '\n', { mode: 0o600 });
    console.log(JSON.stringify(info));
  }
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE' && !fallbackTried && !process.env.BRAINSTORM_PORT) {
      fallbackTried = true;
      actualPort = 0;
      server.listen(actualPort, HOST, onListen);
      return;
    }
    console.error(`Server failed to bind: ${redactToken(error.message)}`);
    process.exit(1);
  });
  server.listen(actualPort, HOST, onListen);
  return server;
}

let TOKEN = '';
let COOKIE_NAME = 'brainstorm-key-pending';

if (require.main === module) {
  try { startServer(); } catch (error) { console.error(redactToken(error.message)); process.exitCode = 1; }
}

module.exports = {
  OPCODES,
  MAX_FRAME_PAYLOAD_BYTES,
  MAX_EVENT_BYTES,
  MAX_EVENT_TEXT_LENGTH,
  MAX_EVENT_QUEUE_LENGTH,
  MAX_EVENT_LOG_BYTES,
  computeAcceptKey,
  encodeFrame,
  decodeFrame,
  browserLauncherForPlatform,
  isLoopbackHost,
  normalizeEvent,
  securityHeaders,
  isContained
};
