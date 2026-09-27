#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { customOutPath, ensureSddDir, fail, sddPath, writeOutFile } = require(path.join(__dirname, 'sdd-workspace.cjs'));

const USAGE = 'usage: review-package.cjs PLAN_FILE BASE HEAD|WORKTREE [OUTFILE]\n       review-package.cjs --snapshot';
const DIFF = ['diff', '--no-color', '--no-ext-diff'];
const SECRET_NAME = /^(?:\.env(?:\.(?!(?:example|sample|template)$).+)?|.+\.env|.*\.(?:pem|key|p12|pfx)|id_(?:rsa|dsa|ed25519|ecdsa).*|credentials(?:\.(?:json|ya?ml|toml|ini|csv|xml|txt))?|\.git-credentials|\.npmrc|\.netrc|_netrc|\.pgpass)$/i;

function gitOrNull(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: false }).trim();
  } catch {
    return null;
  }
}

// ponytail: the whole diff is held in memory; stream it into OUTFILE if packages ever reach hundreds of MiB.
function runGit(args, options = {}) {
  try {
    return execFileSync('git', args, { maxBuffer: Infinity, stdio: ['ignore', 'pipe', 'pipe'], ...options, shell: false });
  } catch (error) {
    fail(`review-package: git ${args[0]} failed: ${String(error.stderr ?? '').trim() || error.message}`);
  }
}

function workTreeTop() {
  const top = gitOrNull(['rev-parse', '--show-toplevel']);
  if (!top) fail('review-package: not inside a Git work tree');
  return top;
}

function resolveObject(ref, type) {
  return gitOrNull(['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{${type}}`]);
}

function resolveTree(label, ref) {
  const tree = resolveObject(ref, 'tree');
  if (!tree) fail(`bad ${label} commit or tree: ${ref}`);
  return tree;
}

// Writes loose Git objects only: no ref, index, or working-tree change.
// A copy of the real index keeps tracked-but-ignored files, recorded modes, and sparse entries.
function worktreeTree(top) {
  const realIndex = path.resolve(top, runGit(['rev-parse', '--git-path', 'index'], { cwd: top, encoding: 'utf8' }).trim());
  for (const signal of ['SIGHUP', 'SIGINT', 'SIGTERM']) process.once(signal, () => process.exit(128 + os.constants.signals[signal]));
  const indexDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-index-'));
  process.once('exit', () => fs.rmSync(indexDir, { recursive: true, force: true }));
  const tempIndex = path.join(indexDir, 'index');
  const env = { ...process.env, GIT_INDEX_FILE: tempIndex };
  if (fs.existsSync(realIndex)) fs.copyFileSync(realIndex, tempIndex);
  runGit(['add', '-A', '--', '.'], { cwd: top, env });
  return runGit(['write-tree'], { cwd: top, env, encoding: 'utf8' }).trim();
}

function refuseUntrackedSecrets(top) {
  const untracked = runGit(['ls-files', '-z', '--others', '--exclude-standard'], { cwd: top, encoding: 'utf8' }).split('\0');
  const secrets = untracked.filter((name) => SECRET_NAME.test(path.posix.basename(name)));
  if (secrets.length > 0) fail(`review-package: untracked files that look like secrets would enter the package: ${secrets.join(', ')}. Move, ignore, or delete a secret first. To include a file that is not a secret, stage it with \`git add -- <path>\`, only with the human's authority.`);
}

function writePackage(args) {
  const [planFile, base, head, customOut] = args;
  if (args.length > 4 || !planFile || !base || !head) fail(USAGE);

  const top = workTreeTop();
  const sddDir = sddPath(planFile);
  const customFile = customOutPath(sddDir, customOut);
  const worktree = head === 'WORKTREE';
  const baseTree = resolveTree('BASE', base);
  const committedTree = worktree ? null : resolveTree('HEAD', head);
  if (worktree) refuseUntrackedSecrets(top);
  // An existing sdd/ gets its .gitignore back before the snapshot, so its files stay out of the package.
  if (worktree && fs.existsSync(sddDir)) ensureSddDir(sddDir);
  const headTree = committedTree ?? worktreeTree(top);
  const untracked = worktree ? runGit(['ls-files', '--others', '--exclude-standard'], { cwd: top, encoding: 'utf8' }).trim() : null;
  const baseCommit = resolveObject(base, 'commit');
  const headCommit = worktree ? null : resolveObject(head, 'commit');

  const diffOutput = runGit([...DIFF, '-U10', baseTree, headTree], { encoding: 'utf8' }).trim();
  if (!diffOutput) {
    console.error(`empty review package: nothing changed between ${base} and ${head}; do not dispatch a review`);
    process.exit(3);
  }
  ensureSddDir(sddDir);
  const statOutput = runGit([...DIFF, '--stat', baseTree, headTree], { encoding: 'utf8' }).trim();

  let logOutput = worktree ? '(none: uncommitted working tree)' : '(none: a snapshot tree has no commits)';
  let commitCount = '0';
  if (baseCommit && headCommit) {
    const commitRange = `${baseCommit}..${headCommit}`;
    logOutput = runGit(['log', '--no-color', '--oneline', commitRange], { encoding: 'utf8' }).trim();
    commitCount = runGit(['rev-list', '--count', commitRange], { encoding: 'utf8' }).trim();
  }

  const baseShort = (baseCommit || baseTree).slice(0, 7);
  const headShort = worktree ? `worktree-${headTree.slice(0, 7)}` : (headCommit || headTree).slice(0, 7);
  const outFile = customFile ?? path.join(sddDir, `review-${baseShort}..${headShort}.diff`);

  const packageContent = [
    `# Review package: ${base}..${head}`,
    '',
    '## Commits',
    logOutput,
    '',
    ...(worktree ? ['## Untracked files included', untracked || '(none)', ''] : []),
    '## Files changed',
    statOutput,
    '',
    '## Diff',
    diffOutput,
    ''
  ].join('\n');

  writeOutFile(outFile, packageContent);
  console.log(`wrote ${outFile}: ${commitCount} commit(s), ${Buffer.byteLength(packageContent, 'utf8')} bytes`);
}

if (process.argv[2] === '--snapshot') {
  if (process.argv.length !== 3) fail(USAGE);
  console.log(worktreeTree(workTreeTop()));
} else {
  writePackage(process.argv.slice(2));
}
// One event-loop turn delivers a SIGINT or SIGTERM that arrived during a synchronous git call.
setImmediate(() => {});
