#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const USAGE = 'usage: review-package.js PLAN_FILE BASE HEAD|WORKTREE [OUTFILE]\n       review-package.js --snapshot';

function runGit(args, options = {}) {
  return execFileSync('git', args, { ...options, shell: false });
}

function resolveObject(ref, type) {
  try {
    return runGit(['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{${type}}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function resolveTree(label, ref) {
  const tree = resolveObject(ref, 'tree');
  if (!tree) {
    console.error(`bad ${label} commit or tree: ${ref}`);
    process.exit(2);
  }
  return tree;
}

// Writes loose Git objects only: no ref, index, or working-tree change.
// A copy of the real index keeps tracked-but-ignored files, recorded modes, and sparse entries.
function worktreeTree() {
  const top = runGit(['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const realIndex = path.resolve(top, runGit(['rev-parse', '--git-path', 'index'], { cwd: top, encoding: 'utf8' }).trim());
  const indexDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-index-'));
  const tempIndex = path.join(indexDir, 'index');
  const env = { ...process.env, GIT_INDEX_FILE: tempIndex };
  try {
    if (fs.existsSync(realIndex)) fs.copyFileSync(realIndex, tempIndex);
    runGit(['add', '-A', '--', '.'], { cwd: top, env, stdio: ['ignore', 'ignore', 'inherit'] });
    return runGit(['write-tree'], { cwd: top, env, encoding: 'utf8' }).trim();
  } finally {
    fs.rmSync(indexDir, { recursive: true, force: true });
  }
}

if (process.argv[2] === '--snapshot') {
  if (process.argv.length !== 3) {
    console.error(USAGE);
    process.exit(2);
  }
  console.log(worktreeTree());
  process.exit(0);
}

const planFile = process.argv[2];
const base = process.argv[3];
const head = process.argv[4];
const customOut = process.argv[5];

if (!planFile || !base || !head) {
  console.error(USAGE);
  process.exit(2);
}

const resolvedPlan = path.resolve(planFile);
if (!fs.existsSync(resolvedPlan)) {
  console.error(`no such plan file: ${planFile}`);
  process.exit(2);
}

const baseTree = resolveTree('BASE', base);
const worktree = head === 'WORKTREE';
const headTree = worktree ? worktreeTree() : resolveTree('HEAD', head);
const baseCommit = resolveObject(base, 'commit');
const headCommit = worktree ? null : resolveObject(head, 'commit');

const diffOutput = runGit(['diff', '-U10', baseTree, headTree], { encoding: 'utf8' }).trim();
if (!diffOutput) {
  console.error(`empty review package: nothing changed between ${base} and ${head}; do not dispatch a review`);
  process.exit(3);
}
const statOutput = runGit(['diff', '--stat', baseTree, headTree], { encoding: 'utf8' }).trim();

let logOutput = worktree ? '(none: uncommitted working tree)' : '(none: a snapshot tree has no commits)';
let commitCount = '0';
if (baseCommit && headCommit) {
  const commitRange = `${baseCommit}..${headCommit}`;
  logOutput = runGit(['log', '--oneline', commitRange], { encoding: 'utf8' }).trim();
  commitCount = runGit(['rev-list', '--count', commitRange], { encoding: 'utf8' }).trim();
}

const planDir = path.dirname(resolvedPlan);
const sddDir = path.join(planDir, 'sdd');
if (!fs.existsSync(sddDir)) {
  fs.mkdirSync(sddDir, { recursive: true });
  fs.writeFileSync(path.join(sddDir, '.gitignore'), '*\n', 'utf8');
}

const baseShort = (baseCommit || baseTree).slice(0, 7);
const headShort = worktree ? `worktree-${headTree.slice(0, 7)}` : (headCommit || headTree).slice(0, 7);
const outFile = customOut ? path.resolve(customOut) : path.join(sddDir, `review-${baseShort}..${headShort}.diff`);

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
