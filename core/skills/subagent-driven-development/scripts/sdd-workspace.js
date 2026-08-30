#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const planFile = process.argv[2];
if (!planFile) {
  console.error('usage: sdd-workspace.js PLAN_FILE');
  process.exit(2);
}

const resolvedPlan = path.resolve(planFile);
if (!fs.existsSync(resolvedPlan)) {
  console.error(`no such plan file: ${planFile}`);
  process.exit(2);
}

const planDir = path.dirname(resolvedPlan);
const sddDir = path.join(planDir, 'sdd');

if (!fs.existsSync(sddDir)) {
  fs.mkdirSync(sddDir, { recursive: true });
}

const gitignorePath = path.join(sddDir, '.gitignore');
if (!fs.existsSync(gitignorePath)) {
  fs.writeFileSync(gitignorePath, '*\n', 'utf8');
}

console.log(sddDir);
