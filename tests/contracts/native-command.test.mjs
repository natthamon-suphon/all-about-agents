import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { runProcess } from "../../scripts/lib/process-runner.mjs";
import { withTempRoot } from "../helpers/temp-root.mjs";

test("Windows npm CLI shim uses its Node entry point without executing shell text", { skip: process.platform !== "win32" }, async () => {
  await withTempRoot(async (root) => {
    const shim = join(root, "codex.cmd");
    const entry = join(root, "node_modules", "@openai", "codex", "bin", "codex.js");
    await mkdir(join(entry, ".."), { recursive: true });
    await writeFile(shim, "@echo SHELL_TEXT_MUST_NOT_EXECUTE\r\n");
    await writeFile(entry, "console.log(JSON.stringify(process.argv.slice(2)));\n");
    const value = 'ภาษาไทย spaces; $(do-not-run)';
    const result = await runProcess({ executable: shim, args: [value] });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), [value]);
    assert.doesNotMatch(result.stdout, /SHELL_TEXT_MUST_NOT_EXECUTE/u);
  });
});
