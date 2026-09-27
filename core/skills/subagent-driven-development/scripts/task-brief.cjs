#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { customOutPath, ensureSddDir, fail, sddPath, writeOutFile } = require(path.join(__dirname, 'sdd-workspace.cjs'));

const [planFile, taskNumStr, customOut] = process.argv.slice(2);

if (!planFile || taskNumStr === undefined) fail('usage: task-brief.cjs PLAN_FILE TASK_NUMBER [OUTFILE]');
if (!/^[0-9]+$/.test(taskNumStr)) fail(`invalid task number: ${taskNumStr}`);

const n = Number(taskNumStr);
const sddDir = sddPath(planFile);
const customFile = customOutPath(sddDir, customOut);

const content = fs.readFileSync(path.resolve(planFile), 'utf8');
const lines = content.split(/\r?\n/);

let infence = false;
let intask = false;
let taskLines = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.trim().startsWith('```')) {
    infence = !infence;
  }

  if (!infence) {
    const taskHeaderMatch = line.match(/^#+\s+Task\s+(\d+)(?:[^0-9]|$)/i);
    if (taskHeaderMatch) {
      const currentTaskNum = parseInt(taskHeaderMatch[1], 10);
      if (currentTaskNum === n) {
        intask = true;
      } else if (intask) {
        break;
      }
    }
  }

  if (intask) {
    taskLines.push(line);
  }
}

if (taskLines.length === 0) {
  console.error(`task ${n} not found in ${planFile} (no heading matching 'Task ${n}')`);
  process.exit(3);
}

ensureSddDir(sddDir);
const outFile = customFile ?? path.join(sddDir, `task-${n}-brief.md`);
writeOutFile(outFile, taskLines.join('\n') + '\n');
console.log(`wrote ${outFile}: ${taskLines.length} lines`);
