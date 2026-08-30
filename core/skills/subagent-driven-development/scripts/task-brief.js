#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const planFile = process.argv[2];
const taskNumStr = process.argv[3];
const customOut = process.argv[4];

if (!planFile || !taskNumStr) {
  console.error('usage: task-brief.js PLAN_FILE TASK_NUMBER [OUTFILE]');
  process.exit(2);
}

const resolvedPlan = path.resolve(planFile);
if (!fs.existsSync(resolvedPlan)) {
  console.error(`no such plan file: ${planFile}`);
  process.exit(2);
}

const n = parseInt(taskNumStr, 10);
if (isNaN(n)) {
  console.error(`invalid task number: ${taskNumStr}`);
  process.exit(2);
}

const planDir = path.dirname(resolvedPlan);
const sddDir = path.join(planDir, 'sdd');
if (!fs.existsSync(sddDir)) {
  fs.mkdirSync(sddDir, { recursive: true });
  fs.writeFileSync(path.join(sddDir, '.gitignore'), '*\n', 'utf8');
}

const outFile = customOut ? path.resolve(customOut) : path.join(sddDir, `task-${n}-brief.md`);

const content = fs.readFileSync(resolvedPlan, 'utf8');
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
        // Reached next task
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

fs.writeFileSync(outFile, taskLines.join('\n') + '\n', 'utf8');
console.log(`wrote ${outFile}: ${taskLines.length} lines`);
