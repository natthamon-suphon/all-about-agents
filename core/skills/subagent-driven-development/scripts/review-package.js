#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const planFile = process.argv[2];
const base = process.argv[3];
const head = process.argv[4];
const customOut = process.argv[5];

if (!planFile || !base || !head) {
  console.error('usage: review-package.js PLAN_FILE BASE HEAD [OUTFILE]');
  process.exit(2);
}

const resolvedPlan = path.resolve(planFile);
if (!fs.existsSync(resolvedPlan)) {
  console.error(`no such plan file: ${planFile}`);
  process.exit(2);
}

try {
  execSync(`git rev-parse --verify --quiet "${base}"`, { stdio: 'ignore' });
} catch {
  console.error(`bad BASE commit: ${base}`);
  process.exit(2);
}

try {
  execSync(`git rev-parse --verify --quiet "${head}"`, { stdio: 'ignore' });
} catch {
  console.error(`bad HEAD commit: ${head}`);
  process.exit(2);
}

const baseShort = execSync(`git rev-parse --short "${base}"`, { encoding: 'utf8' }).trim();
const headShort = execSync(`git rev-parse --short "${head}"`, { encoding: 'utf8' }).trim();

const planDir = path.dirname(resolvedPlan);
const sddDir = path.join(planDir, 'sdd');
if (!fs.existsSync(sddDir)) {
  fs.mkdirSync(sddDir, { recursive: true });
  fs.writeFileSync(path.join(sddDir, '.gitignore'), '*\n', 'utf8');
}

const outFile = customOut ? path.resolve(customOut) : path.join(sddDir, `review-${baseShort}..${headShort}.diff`);

const logOutput = execSync(`git log --oneline "${base}..${head}"`, { encoding: 'utf8' }).trim();
const statOutput = execSync(`git diff --stat "${base}..${head}"`, { encoding: 'utf8' }).trim();
const diffOutput = execSync(`git diff -U10 "${base}..${head}"`, { encoding: 'utf8' }).trim();
const commitCount = execSync(`git rev-list --count "${base}..${head}"`, { encoding: 'utf8' }).trim();

const packageContent = [
  `# Review package: ${base}..${head}`,
  '',
  '## Commits',
  logOutput,
  '',
  '## Files changed',
  statOutput,
  '',
  '## Diff',
  diffOutput,
  ''
].join('\n');

fs.writeFileSync(outFile, packageContent, 'utf8');
const byteSize = Buffer.byteLength(packageContent, 'utf8');
console.log(`wrote ${outFile}: ${commitCount} commit(s), ${byteSize} bytes`);
