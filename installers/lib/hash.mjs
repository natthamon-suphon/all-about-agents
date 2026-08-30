import { createHash } from "node:crypto";

export const SHA256_HEX = /^[0-9a-f]{64}$/u;

function bytes(value) {
  if (!(value instanceof Uint8Array)) throw new TypeError("hash input must be a Uint8Array");
  return value;
}

/** Hash the exact bytes supplied by a renderer; no text normalization occurs. */
export function sha256Hex(value) {
  return createHash("sha256").update(bytes(value)).digest("hex");
}

export const sha256 = sha256Hex;
export const hashBytes = sha256Hex;
export const contentHash = sha256Hex;

export function equalBytes(left, right) {
  const a = bytes(left);
  const b = bytes(right);
  if (a.byteLength !== b.byteLength) return false;
  for (let index = 0; index < a.byteLength; index += 1) if (a[index] !== b[index]) return false;
  return true;
}
