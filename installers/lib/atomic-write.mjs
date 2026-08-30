import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, basename, resolve } from "node:path";

import { hashBytes } from "./hash.mjs";

function bytes(value) {
  if (!(value instanceof Uint8Array)) throw new TypeError("atomic write content must be a Uint8Array");
  return value;
}

function operation(fileSystem, name, fallback) {
  const candidate = fileSystem?.[name];
  return typeof candidate === "function" ? candidate.bind(fileSystem) : fallback;
}

function atomicError(code, message, cause = null) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

async function removeTemp(path, remove) {
  try {
    await remove(path);
  } catch (error) {
    if (error?.code !== "ENOENT") return;
  }
}

/**
 * Replace one destination using a same-directory temporary file.
 *
 * The optional fileSystem fields are standard-library-compatible operation
 * overrides. They exist for disposable tests and must not change the
 * same-directory temporary-file and post-rename hash-verification contract.
 */
export async function atomicReplaceFile({ destination, content, expectedHash, fileSystem = {} } = {}) {
  if (typeof destination !== "string" || destination.length === 0 || destination.includes("\0")) {
    throw new TypeError("destination must be a non-empty path");
  }
  const value = bytes(content);
  if (typeof expectedHash !== "string" || !/^[0-9a-f]{64}$/u.test(expectedHash)) {
    throw new TypeError("expectedHash must be a lower-case SHA-256 hash");
  }

  const makeDirectory = operation(fileSystem, "mkdir", mkdir);
  const write = operation(fileSystem, "writeFile", writeFile);
  const replace = operation(fileSystem, "rename", rename);
  const remove = operation(fileSystem, "unlink", unlink);
  const read = operation(fileSystem, "readFile", readFile);
  const destinationPath = resolve(destination);
  const directory = dirname(destinationPath);
  const temporaryPath = resolve(directory, `.${basename(destinationPath)}.aaa-${randomUUID()}.tmp`);

  await makeDirectory(directory, { recursive: true });
  let temporaryCreated = false;
  try {
    await write(temporaryPath, value, { flag: "wx", mode: 0o600 });
    temporaryCreated = true;
    await replace(temporaryPath, destinationPath);
    temporaryCreated = false;
  } catch (error) {
    if (temporaryCreated) await removeTemp(temporaryPath, remove);
    throw error;
  }

  let finalBytes;
  try {
    finalBytes = await read(destinationPath);
  } catch (error) {
    throw atomicError("final-read-failed", `unable to verify atomically replaced file: ${error.message}`, error);
  }
  if (!(finalBytes instanceof Uint8Array)) throw atomicError("final-read-invalid", "final verification did not return Uint8Array bytes");
  const actualHash = hashBytes(finalBytes);
  if (actualHash !== expectedHash) {
    throw atomicError("hash-mismatch", `final file hash ${actualHash} does not match expected ${expectedHash}`);
  }
  return { path: destinationPath, sha256: actualHash };
}

export const atomicWrite = atomicReplaceFile;
