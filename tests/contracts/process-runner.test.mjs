import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

let runProcess;
try {
  ({ runProcess } = await import("../../scripts/lib/process-runner.mjs"));
} catch (error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
}

test("process runner exposes the shell-free public interface", () => {
  assert.equal(typeof runProcess, "function", "runProcess must be exported");
});

test("process runner preserves spaces, quotes, and shell metacharacters as one argument", async () => {
  const literal = `space \"quote\" & ; $() \`tick\` ${randomUUID()}`;
  const result = await runProcess({
    executable: process.execPath,
    args: ["-e", "process.stdout.write(JSON.stringify(process.argv.slice(1)))", literal]
  });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(result.stdout), [literal]);
  assert.equal(result.stderr, "");
  assert.equal(result.unavailable, false);
  assert.equal(result.timedOut, false);
  assert.equal(result.signal, null);
});

test("process runner returns non-zero exit output without throwing", async () => {
  const result = await runProcess({
    executable: process.execPath,
    args: ["-e", "process.stdout.write('out'); process.stderr.write('err'); process.exit(7)"]
  });

  assert.equal(result.exitCode, 7);
  assert.equal(result.stdout, "out");
  assert.equal(result.stderr, "err");
  assert.equal(result.unavailable, false);
});

test("process runner reports an unavailable executable", async () => {
  const result = await runProcess({
    executable: `aaa-command-that-does-not-exist-${randomUUID()}`,
    args: []
  });

  assert.equal(result.exitCode, null);
  assert.equal(result.unavailable, true);
  assert.equal(result.timedOut, false);
  assert.match(result.stderr, /ENOENT|not found|cannot find/iu);
});

test("process runner reports timeout and terminates the child", async () => {
  const started = Date.now();
  const result = await runProcess({
    executable: process.execPath,
    args: ["-e", "setTimeout(() => {}, 60_000)"],
    timeoutMs: 50
  });

  assert.equal(result.exitCode, null);
  assert.equal(result.timedOut, true);
  assert.equal(result.unavailable, false);
  assert.ok(Date.now() - started < 3_000, "timeout must settle after a hard deadline");
});

test("process runner caps combined output while the child is running", async () => {
  const result = await runProcess({
    executable: process.execPath,
    args: ["-e", "process.stdout.write('x'.repeat(4096)); setInterval(() => {}, 1000)"],
    maxOutputBytes: 128,
    timeoutMs: 10_000
  });

  assert.equal(result.outputTooLarge, true);
  assert.ok(Buffer.byteLength(result.stdout, "utf8") + Buffer.byteLength(result.stderr, "utf8") <= 128);
  assert.equal(result.timedOut, false);
});

test("process runner rejects malformed inputs before spawning", async () => {
  await assert.rejects(() => runProcess({ executable: "", args: [] }), /executable/iu);
  await assert.rejects(() => runProcess({ executable: process.execPath, args: [3] }), /args/iu);
  await assert.rejects(() => runProcess({ executable: process.execPath, args: [], cwd: "" }), /cwd/iu);
  await assert.rejects(() => runProcess({ executable: process.execPath, args: [], env: [] }), /env/iu);
  await assert.rejects(() => runProcess({ executable: process.execPath, args: [], timeoutMs: 0 }), /timeout/iu);
  await assert.rejects(() => runProcess({ executable: process.execPath, args: [], maxOutputBytes: 0 }), /output/iu);
});

test("process runner accepts explicit environment overrides", async () => {
  const result = await runProcess({ executable: process.execPath, args: ["-e", "process.stdout.write(process.env.T06_EXPLICIT || '')"], envOverrides: { T06_EXPLICIT: "yes" } });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "yes");
});

test("process runner keeps ambient PATH for executable lookup with explicit overrides", async () => {
  const executable = process.platform === "win32" ? "node.exe" : "node";
  const result = await runProcess({
    executable,
    args: ["-e", "process.stdout.write(process.env.PATH || process.env.Path || '')"],
    envOverrides: { T06_EXPLICIT: "yes" }
  });
  assert.equal(result.exitCode, 0);
  assert.ok(result.stdout.length > 0);
});

test("process runner rejects conflicting or unsafe environment sources before spawning", async () => {
  await assert.rejects(
    () => runProcess({ executable: process.execPath, args: [], env: { T06_ENV: "one" }, envOverrides: { T06_ENV: "two" } }),
    (error) => error.code === "conflicting-environment"
  );
  await assert.rejects(
    () => runProcess({ executable: process.execPath, args: [], env: { T06_ENV: 1 } }),
    (error) => error.code === "invalid-environment-value"
  );
  await assert.rejects(
    () => runProcess({ executable: process.execPath, args: [], envOverrides: { T06_ENV: "bad\0value" } }),
    (error) => error.code === "invalid-environment-value"
  );
  await assert.rejects(
    () => runProcess({ executable: process.execPath, args: [], envOverrides: { [`T06${"\0"}ENV`]: "value" } }),
    (error) => error.code === "invalid-environment-key"
  );
});
