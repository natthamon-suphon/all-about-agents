import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

test("PowerShell and POSIX launchers forward argv without policy logic", async () => {
  const powershell = await readFile(resolve(process.cwd(), "installers", "install.ps1"), "utf8");
  const shell = await readFile(resolve(process.cwd(), "installers", "install.sh"), "utf8");
  assert.match(powershell, /@Arguments/u);
  assert.match(powershell, /LASTEXITCODE/u);
  assert.match(shell, /"\$@"/u);
  for (const source of [powershell, shell]) {
    assert.doesNotMatch(source, /--surface|--profile|statusline|dangerously|portable|template/u);
  }
});

test("launchers preserve representative JSON output and exit-code parity", async (t) => {
  const launcherArgs = [
    ["validate", "--scope", "all", "--format", "json"],
    ["install", "--unknown", "--format", "json"]
  ];
  const expected = [
    { status: 0, action: "validate", statusValue: "pass" },
    { status: 2, action: undefined, statusValue: "fail" }
  ];
  const outcomes = (run) => launcherArgs.map((args) => {
    const result = run(args);
    const stdout = JSON.parse(result.stdout);
    return { status: result.status, action: stdout.action, statusValue: stdout.status };
  });

  const pwshProbe = spawnSync("pwsh", ["--version"], { cwd: process.cwd(), encoding: "utf8" });
  const powershellUnavailable = pwshProbe.status !== 0
    ? `NOT_RUN_UNAVAILABLE: PowerShell launcher not run, pwsh unavailable (status ${pwshProbe.status ?? "spawn-error"})`
    : null;
  await t.test("PowerShell", { skip: powershellUnavailable || false }, async () => {
    const runPowerShell = (args) => spawnSync("pwsh", ["-NoProfile", "-File", resolve(process.cwd(), "installers", "install.ps1"), ...args], { cwd: process.cwd(), encoding: "utf8" });
    assert.deepEqual(outcomes(runPowerShell), expected);
  });

  const bashProbe = spawnSync("bash", ["--version"], { cwd: process.cwd(), encoding: "utf8" });
  const nodeProbe = bashProbe.status === 0
    ? spawnSync("bash", ["-c", "command -v node"], { cwd: process.cwd(), encoding: "utf8" })
    : null;
  const posixUnavailable = bashProbe.status !== 0
    ? `POSIX launcher not run: bash unavailable (status ${bashProbe.status ?? "spawn-error"})`
    : nodeProbe.status !== 0
      ? `POSIX launcher not run: node unavailable in bash PATH (status ${nodeProbe.status ?? "spawn-error"})`
      : null;
  await t.test("POSIX", { skip: posixUnavailable || false }, async () => {
    const runShell = (args) => spawnSync("bash", [resolve(process.cwd(), "installers", "install.sh"), ...args], { cwd: process.cwd(), encoding: "utf8" });
    assert.deepEqual(outcomes(runShell), expected);
  });
});
