#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { customOutPath, ensureSddDir, fail, sddPath, writeOutFile } = require(path.join(__dirname, 'sdd-workspace.cjs'));

const args = process.argv.slice(2);
const [planFile, taskNumStr, customOut] = args;

if (args.length < 2 || args.length > 3) fail('usage: task-brief.cjs PLAN_FILE TASK_NUMBER [OUTFILE]');
if (!/^[0-9]+$/.test(taskNumStr)) fail(`invalid task number: ${taskNumStr}`);

const n = Number(taskNumStr);
const sddDir = sddPath(planFile);
const customFile = customOutPath(sddDir, customOut);

// Keep these rules in step with the awk fallback in the task-brief wrapper.
const lines = fs.readFileSync(path.resolve(planFile), 'utf8').split('\n');
if (lines.at(-1) === '') lines.pop();

let infence = false;
let taskLevel = 0;
const taskLines = [];

for (const rawLine of lines) {
  const line = rawLine.replace(/\r$/, '');
  if (/^[ \t]*```/.test(line)) infence = !infence;
  const heading = infence ? null : line.match(/^(#+)(?:[ \t]|$)/);
  if (heading) {
    const level = heading[1].length;
    const taskHeading = line.match(/^#+[ \t]+Task[ \t]+([0-9]+)(?:[^0-9]|$)/);
    const thisTask = taskHeading !== null && Number(taskHeading[1]) === n;
    if (taskLevel > 0 && (level <= taskLevel || (taskHeading && !thisTask))) break;
    if (taskLevel === 0 && thisTask) taskLevel = level;
  }
  if (taskLevel > 0) taskLines.push(line);
}

if (taskLines.length === 0) {
  console.error(`task ${n} not found in ${planFile} (no heading matching 'Task ${n}')`);
  process.exit(3);
}

ensureSddDir(sddDir);
const outFile = customFile ?? path.join(sddDir, `task-${n}-brief.md`);
writeOutFile(outFile, taskLines.join('\n') + '\n');
console.log(`wrote ${outFile}: ${taskLines.length} lines`);
