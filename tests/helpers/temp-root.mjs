import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Resolve the OS temporary directory without any symlinked component. */
export async function canonicalTmpdir() {
  return realpath(tmpdir());
}

/**
 * Create a disposable root that contains no symlinked ancestor.
 *
 * macOS exposes os.tmpdir() through the /var -> private/var symlink, and root
 * resolution fails closed on a symlinked ancestor, so an uncanonicalized
 * temporary directory is rejected as an unsafe root on that host. Every test
 * that needs a disposable root must obtain it here.
 */
export async function makeTempRoot(prefix) {
  if (typeof prefix !== "string" || prefix.trim().length === 0) {
    throw new TypeError("makeTempRoot requires a non-empty prefix");
  }

  return realpath(await mkdtemp(join(tmpdir(), prefix)));
}

export async function withTempRoot(testFn) {
  if (typeof testFn !== "function") {
    throw new TypeError("withTempRoot requires a callback function");
  }

  const root = await makeTempRoot("aaa-test-");
  try {
    return await testFn(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}
