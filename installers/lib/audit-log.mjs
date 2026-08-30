import { createHash } from "node:crypto";
import { appendFile, lstat, mkdir, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const AUDIT_FILE = "activity-audit.log";
const MAX_KEY_CODE_POINTS = 64;
const DEFAULT_MAX_BYTES = 1024 * 1024;
const DEFAULT_MAX_FILES = 5;
const SURFACES = new Set(["claude", "codex", "antigravity-2", "agy"]);
const SECRET_SHAPED_TEXT = /(?:token|password|api[_-]?key|secret|credential|authorization)\s*[:=]/iu;
const queues = new Map();
const activeStates = new Map();

function skipped() {
  return { status: "skipped", path: null, bytes: 0 };
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeActionId(value) {
  if (typeof value !== "string") return null;
  if (SECRET_SHAPED_TEXT.test(value)) return null;
  const normalized = value.normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/gu, "-")
    .replace(/[^a-z0-9:_-]/gu, "-")
    .replace(/-{2,}/gu, "-")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/gu, "")
    .slice(0, 128);
  return normalized || null;
}

function normalizeOutcome(value) {
  if (typeof value !== "string") return null;
  if (SECRET_SHAPED_TEXT.test(value)) return null;
  const normalized = value.normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/gu, "-")
    .replace(/[^a-z0-9._:-]/gu, "-")
    .replace(/-{2,}/gu, "-")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/gu, "")
    .slice(0, 64);
  return normalized || null;
}

function normalizeEvent(event) {
  if (!isPlainObject(event)) return null;
  const surface = typeof event.surface === "string" ? event.surface.trim().toLowerCase() : "";
  if (!SURFACES.has(surface)) return null;
  const actionId = normalizeActionId(event.actionId ?? event.action);
  const outcome = normalizeOutcome(event.outcome);
  const sessionKey = event.sessionKey ?? event.sessionId ?? event.session_id;
  if (!actionId || !outcome || typeof sessionKey !== "string" || sessionKey.trim().length === 0) return null;

  let timestamp = new Date().toISOString();
  if (Object.hasOwn(event, "timestamp")) {
    if (typeof event.timestamp !== "string" || !Number.isFinite(Date.parse(event.timestamp))) return null;
    timestamp = new Date(event.timestamp).toISOString();
  }
  return {
    timestamp,
    surface,
    actionId,
    outcome,
    sessionKeyHash: createHash("sha256").update(sessionKey.trim(), "utf8").digest("hex")
  };
}

function normalizeLimits(limits) {
  if (limits === undefined) return { maxBytes: DEFAULT_MAX_BYTES, maxFiles: DEFAULT_MAX_FILES };
  if (!isPlainObject(limits)) return null;
  const maxBytes = limits.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxFiles = limits.maxFiles ?? DEFAULT_MAX_FILES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isSafeInteger(maxFiles) || maxFiles < 1) return null;
  return { maxBytes, maxFiles };
}

function rotationName(index) {
  return `${AUDIT_FILE.replace(/\.log$/u, "")}.${index}.log`;
}

async function removeFileIfPresent(path) {
  try {
    const info = await lstat(path);
    if (!info.isFile()) throw new Error("audit target is not a regular file");
    await unlink(path);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function fileSize(path) {
  try {
    const info = await lstat(path);
    if (!info.isFile()) throw new Error("audit target is not a regular file");
    return info.size;
  } catch (error) {
    if (error?.code === "ENOENT") return 0;
    throw error;
  }
}

async function rotate(root, maxFiles) {
  for (let index = maxFiles - 1; index >= 1; index -= 1) {
    const destination = join(root, rotationName(index));
    await removeFileIfPresent(destination);
    const source = join(root, index === 1 ? AUDIT_FILE : rotationName(index - 1));
    try {
      const info = await lstat(source);
      if (!info.isFile()) throw new Error("audit source is not a regular file");
      await rename(source, destination);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

async function prune(root, maxFiles) {
  const names = await readdir(root);
  for (const name of names) {
    const match = new RegExp(`^${AUDIT_FILE.replace(".log", "")}\\.(\\d+)\\.log$`, "u").exec(name);
    if (match && Number(match[1]) >= maxFiles) await removeFileIfPresent(join(root, name));
  }
}

async function enforceByteCap(root, maxBytes, maxFiles) {
  const candidates = [AUDIT_FILE, ...Array.from({ length: maxFiles - 1 }, (_, index) => rotationName(index + 1))];
  for (const name of candidates) {
    const path = join(root, name);
    try {
      const info = await lstat(path);
      if (!info.isFile()) throw new Error("audit target is not a regular file");
      if (info.size > maxBytes) await unlink(path);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

async function appendAuditEventInternal(root, event, limits) {
  const normalized = normalizeEvent(event);
  const bounded = normalizeLimits(limits);
  if (!normalized || !bounded) return skipped();
  const line = `${JSON.stringify(normalized)}\n`;
  const bytes = Buffer.byteLength(line, "utf8");
  if (bytes > bounded.maxBytes) return skipped();

  await mkdir(root, { recursive: true });
  const active = join(root, AUDIT_FILE);
  const knownState = activeStates.get(root);
  const stateMatches = knownState && knownState.maxBytes === bounded.maxBytes && knownState.maxFiles === bounded.maxFiles;
  if (!stateMatches) await enforceByteCap(root, bounded.maxBytes, bounded.maxFiles);
  const currentSize = stateMatches
    ? knownState.size
    : await fileSize(active);
  let rotated = false;
  if (currentSize > 0 && currentSize + bytes > bounded.maxBytes) {
    if (bounded.maxFiles === 1) {
      await writeFile(active, line, { encoding: "utf8", flag: "w" });
      activeStates.set(root, { maxBytes: bounded.maxBytes, maxFiles: bounded.maxFiles, size: bytes });
    }
    else {
      await rotate(root, bounded.maxFiles);
      await appendFile(active, line, { encoding: "utf8", flag: "a" });
      rotated = true;
      activeStates.set(root, { maxBytes: bounded.maxBytes, maxFiles: bounded.maxFiles, size: bytes });
    }
  } else {
    await appendFile(active, line, { encoding: "utf8", flag: "a" });
    activeStates.set(root, { maxBytes: bounded.maxBytes, maxFiles: bounded.maxFiles, size: currentSize + bytes });
  }
  if (rotated || bounded.maxFiles === 1 || !stateMatches) await prune(root, bounded.maxFiles);
  return { status: "written", path: active, bytes };
}

function enqueue(root, operation) {
  const previous = queues.get(root) || Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  queues.set(root, current);
  return current.finally(() => {
    if (queues.get(root) === current) queues.delete(root);
  });
}

/** Convert an external identifier into a bounded, filename-safe key. */
export function safeLogKey(id) {
  if (typeof id !== "string") throw new TypeError("id must be a string");
  const normalized = id.normalize("NFKC")
    .replace(/[^A-Za-z0-9._-]/gu, "-")
    .replace(/-{2,}/gu, "-")
    .replace(/^[-.]+|[-.]+$/gu, "");
  const key = [...normalized].slice(0, MAX_KEY_CODE_POINTS).join("");
  return key && key !== "." && key !== ".." ? key : "unknown";
}

/** Append one bounded, redacted JSON-line event; audit failures never escape. */
export function appendAuditEvent(root, event, limits) {
  if (typeof root !== "string" || root.trim().length === 0) return Promise.resolve(skipped());
  const resolvedRoot = resolve(root);
  return enqueue(resolvedRoot, async () => {
    try {
      return await appendAuditEventInternal(resolvedRoot, event, limits);
    } catch {
      activeStates.delete(resolvedRoot);
      return skipped();
    }
  });
}

export { AUDIT_FILE };
