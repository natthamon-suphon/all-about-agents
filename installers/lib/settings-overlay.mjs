import { lstat, readFile } from "node:fs/promises";
import { dirname, relative, resolve, isAbsolute, sep } from "node:path";

import { hashBytes } from "./hash.mjs";
import { atomicReplaceFile } from "./atomic-write.mjs";
import { assertSafeDestinationRoot } from "./roots.mjs";

/** Maximum UTF-8 size accepted for a native settings overlay. */
export const MAX_OVERLAY_BYTES = 64 * 1024;
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function operation(fileSystem, name, fallback) {
  const candidate = fileSystem?.[name];
  return typeof candidate === "function" ? candidate.bind(fileSystem) : fallback;
}

function contained(root, candidate) {
  const path = relative(root, candidate);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function validatePathInput(value, label, invalidCode) {
  if (typeof value !== "string" || value.trim() === "" || value.includes("\0")) {
    const error = new TypeError(`${label} must be a non-empty path`);
    error.code = invalidCode;
    throw error;
  }
  if (!isAbsolute(value)) {
    const error = new TypeError(`${label} must be absolute`);
    error.code = invalidCode;
    throw error;
  }
  if (value.split(/[\\/]/u).some((segment) => segment === "..")) {
    const error = new TypeError(`${label} may not contain raw '..' traversal segments`);
    error.code = "root-traversal";
    throw error;
  }
}

function validateKeyTree(value, path = "") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateKeyTree(entry, `${path}/${index}`));
    return;
  }
  if (!object(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      const error = new TypeError(`settings overlay contains forbidden key ${key} at ${path || "/"}`);
      error.code = "forbidden-prototype-key";
      throw error;
    }
    validateKeyTree(child, `${path}/${key}`);
  }
}

function parseJson(bytes, label) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError(`${label} must be read as bytes`);
  if (bytes.byteLength > MAX_OVERLAY_BYTES) {
    const error = new RangeError(`${label} exceeds the maximum size of ${MAX_OVERLAY_BYTES} bytes`);
    error.code = "overlay-too-large";
    throw error;
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    const error = new TypeError(`${label} is not valid UTF-8`, { cause });
    error.code = "invalid-utf8";
    throw error;
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    const error = new TypeError(`${label} is not valid JSON`, { cause });
    error.code = "invalid-json";
    throw error;
  }
  if (!object(value)) {
    const error = new TypeError(`${label} must contain a JSON object`);
    error.code = "overlay-object-required";
    throw error;
  }
  validateKeyTree(value);
  return value;
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (!object(value)) return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) result[key] = clone(child);
  return result;
}

function merge(base, overlay) {
  if (!object(base) || !object(overlay)) return clone(overlay);
  const result = clone(base);
  for (const [key, value] of Object.entries(overlay)) {
    result[key] = object(result[key]) && object(value) ? merge(result[key], value) : clone(value);
  }
  return result;
}

async function inspectPath(path, label, fileSystem) {
  const stat = operation(fileSystem, "lstat", lstat);
  try {
    const metadata = await stat(path);
    if (metadata.isSymbolicLink?.()) {
      const error = new Error(`${label} may not be a symlink, junction, or reparse point`);
      error.code = "unsafe-symlink";
      throw error;
    }
    return metadata;
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
    throw error;
  }
}

async function checkTarget(root, target, fileSystem) {
  if (!contained(root, target)) {
    const error = new Error("settings target escapes the allowed root");
    error.code = "root-escape";
    throw error;
  }
  assertSafeDestinationRoot(dirname(target), { allowedProductRoots: [root] });
  return inspectPath(target, "settings target", fileSystem);
}

async function readOptional(path, label, fileSystem) {
  const read = operation(fileSystem, "readFile", readFile);
  try {
    return await read(path);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
    throw new Error(`unable to read ${label}: ${error.message}`, { cause: error });
  }
}

/**
 * Merge one repository-owned sparse JSON overlay into one documented product
 * settings file. The target is replaced atomically and no backup is created.
 */
export async function mergeSettingsOverlay({ targetPath, overlayPath, allowedRoot, expectedOverlayHash = null, fileSystem = {} } = {}) {
  validatePathInput(allowedRoot, "allowedRoot", "invalid-root");
  validatePathInput(targetPath, "targetPath", "invalid-target-path");
  validatePathInput(overlayPath, "overlayPath", "invalid-overlay-path");
  if (!(expectedOverlayHash === null || (typeof expectedOverlayHash === "string" && /^[0-9a-f]{64}$/u.test(expectedOverlayHash)))) {
    throw new TypeError("expectedOverlayHash must be null or a lower-case SHA-256 hash");
  }

  const root = resolve(allowedRoot);
  const target = resolve(targetPath);
  const overlay = resolve(overlayPath);
  assertSafeDestinationRoot(root, { allowedProductRoots: [root] });
  await checkTarget(root, target, fileSystem);

  // The overlay is trusted only as a regular file under its own validated
  // package root. It need not share the product root with the target.
  const overlayParent = dirname(overlay);
  assertSafeDestinationRoot(overlayParent, { allowedProductRoots: [overlayParent] });
  const overlayMetadata = await inspectPath(overlay, "settings overlay", fileSystem);
  if (!overlayMetadata || !overlayMetadata.isFile?.()) {
    const error = new Error("settings overlay must be an existing regular file");
    error.code = "overlay-missing";
    throw error;
  }
  const overlayBytes = await readOptional(overlay, "settings overlay", fileSystem);
  if (expectedOverlayHash !== null && hashBytes(overlayBytes) !== expectedOverlayHash) {
    const error = new Error("settings overlay does not match its managed source hash");
    error.code = "overlay-hash-mismatch";
    throw error;
  }
  const overlayObject = parseJson(overlayBytes, "settings overlay");

  const targetBytes = await readOptional(target, "settings target", fileSystem);
  let targetObject = {};
  let beforeHash = null;
  if (targetBytes !== null) {
    if (targetBytes.byteLength > MAX_OVERLAY_BYTES) {
      const error = new RangeError(`settings target exceeds the maximum size of ${MAX_OVERLAY_BYTES} bytes`);
      error.code = "target-too-large";
      throw error;
    }
    beforeHash = hashBytes(targetBytes);
    targetObject = parseJson(targetBytes, "settings target");
  }

  const merged = merge(targetObject, overlayObject);
  const content = new TextEncoder().encode(`${JSON.stringify(merged, null, 2)}\n`);
  const afterHash = hashBytes(content);
  if (beforeHash === afterHash) return { beforeHash, afterHash, changed: false, bytes: content.byteLength };
  await atomicReplaceFile({
    destination: target,
    content,
    expectedHash: afterHash,
    allowedProductRoots: [root],
    fileSystem
  });
  return { beforeHash, afterHash, changed: true, bytes: content.byteLength };
}

export { validateKeyTree };
