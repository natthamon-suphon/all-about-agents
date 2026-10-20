#!/usr/bin/env node
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const scripts = path.join(__dirname, '../../subagent-driven-development/scripts');
const { checkOutFile, ensureSddDir, fail, readPlanLedger, writeOutFile } = require(path.join(scripts, 'sdd-workspace.cjs'));
const { prepareBrief } = require(path.join(scripts, 'task-brief.cjs'));
const { resolveTree } = require(path.join(scripts, 'review-package.cjs'));

const args = process.argv.slice(2);
if (args.length < 5 || args[3] !== '--' || !args[4]) fail('usage: task-done.cjs PLAN_FILE TASK_NUMBER BASE -- EXECUTABLE [ARGS...]');
if (args.some((arg) => /[\x00-\x1f\x7f]/.test(arg))) fail('task-done: control characters are not allowed in arguments');
const [planFile, taskNum, baseRef, , executable, ...childArgs] = args;
const brief = prepareBrief(planFile, taskNum);
const base = resolveTree('BASE', baseRef);
const logPath = path.join(brief.sddDir, `task-${brief.n}-tests-${crypto.randomUUID()}.log`);
checkOutFile(logPath);
readPlanLedger(brief.planPath, brief.sddDir);
if (process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(executable)) fail('task-done: command scripts need an explicit interpreter; use a native executable or node <runner>');
ensureSddDir(brief.sddDir);
try {
  fs.writeFileSync(logPath, '', { flag: 'wx', mode: 0o600 });
} catch (error) {
  fail(`task-done: cannot reserve new log ${logPath}: ${error.code}`);
}

const MAX_LOG_BYTES = 8 * 1024 * 1024;
const chunks = [];
let bytes = 0;
let overflow = false;
let launchError;
const child = spawn(executable, childArgs, { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
function collect(chunk) {
  if (overflow) return;
  const remaining = MAX_LOG_BYTES - bytes;
  chunks.push(chunk.subarray(0, remaining));
  bytes += Math.min(chunk.length, remaining);
  if (chunk.length > remaining) {
    overflow = true;
    child.kill();
  }
}
child.stdout.on('data', collect);
child.stderr.on('data', collect);
child.once('error', (error) => { launchError = error; });
child.once('close', (code, signal) => {
  let exitCode = code ?? 128 + (os.constants.signals[signal] ?? 1);
  let diagnostic;
  if (launchError) {
    exitCode = launchError.code === 'ENOENT' ? 127 : 126;
    diagnostic = `cannot launch ${executable}: ${launchError.code}; use a native executable or node <runner>`;
  } else if (overflow) {
    exitCode = 1;
    diagnostic = `log byte limit (${MAX_LOG_BYTES}) exceeded; full verification output was not retained`;
  } else if (exitCode !== 0) {
    diagnostic = signal ? `test command stopped by ${signal}` : `test command exited ${exitCode}`;
  }
  diagnostic = diagnostic?.slice(0, 1024);
  const output = Buffer.concat(chunks);
  writeOutFile(logPath, diagnostic ? Buffer.concat([output, Buffer.from(`\n[task-done: ${diagnostic}]\n`)]) : output);
  const completed = exitCode === 0;
  if (completed) {
    const ledger = readPlanLedger(brief.planPath, brief.sddDir);
    const line = `Task ${brief.n}: completed (base: ${base}; head: WORKTREE; command: ${JSON.stringify([executable, ...childArgs])}; log: ${JSON.stringify(logPath)})\n`;
    writeOutFile(ledger.outFile, ledger.content.replace(/\n?$/, '\n') + line);
  }
  console.log(JSON.stringify({ task: brief.n, completed, exitCode, signal, base, logPath, output: output.subarray(-4096).toString('utf8'), ...(diagnostic ? { diagnostic } : {}) }));
  if (diagnostic) console.error(`task-done: ${diagnostic}; Task ${brief.n} NOT recorded (log: ${logPath})`);
  process.exitCode = exitCode;
});
