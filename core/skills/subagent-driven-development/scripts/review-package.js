#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function runGit(args, options = {}) {
  return execFileSync('git', args, { ...options, shell: false });
}

function resolveCommit(label, ref) {
  try {
    return runGit(['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`], { encoding: 'utf8' }).trim();
  } catch {
    console.error(`bad ${label} commit: ${ref}`);
    process.exit(2);
  }
}

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

const baseCommit = resolveCommit('BASE', base);
const headCommit = resolveCommit('HEAD', head);
const baseShort = runGit(['rev-parse', '--short', baseCommit], { encoding: 'utf8' }).trim();
const headShort = runGit(['rev-parse', '--short', headCommit], { encoding: 'utf8' }).trim();

const planDir = path.dirname(resolvedPlan);
const sddDir = path.join(planDir, 'sdd');
if (!fs.existsSync(sddDir)) {
  fs.mkdirSync(sddDir, { recursive: true });
  fs.writeFileSync(path.join(sddDir, '.gitignore'), '*\n', 'utf8');
}

const outFile = customOut ? path.resolve(customOut) : path.join(sddDir, `review-${baseShort}..${headShort}.diff`);

const commitRange = `${baseCommit}..${headCommit}`;
const logOutput = runGit(['log', '--oneline', commitRange], { encoding: 'utf8' }).trim();
const statOutput = runGit(['diff', '--stat', commitRange], { encoding: 'utf8' }).trim();
const diffOutput = runGit(['diff', '-U10', commitRange], { encoding: 'utf8' }).trim();
const commitCount = runGit(['rev-list', '--count', commitRange], { encoding: 'utf8' }).trim();

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
