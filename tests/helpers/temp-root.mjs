import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function withTempRoot(testFn) {
  if (typeof testFn !== "function") {
    throw new TypeError("withTempRoot requires a callback function");
  }

  const root = await mkdtemp(join(tmpdir(), "aaa-test-"));
  try {
    return await testFn(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}
