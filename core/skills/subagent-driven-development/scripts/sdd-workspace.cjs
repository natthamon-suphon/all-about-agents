#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function fail(message) {
  console.error(message);
  process.exit(2);
}

function sddProblem(sddDir) {
  const stat = fs.lstatSync(sddDir, { throwIfNoEntry: false });
  if (stat?.isSymbolicLink()) return `refusing a symlinked sdd/ folder: ${sddDir}`;
  if (stat && !stat.isDirectory()) return `sdd/ is not a folder: ${sddDir}`;
  return null;
}

function sddPath(planFile) {
  const resolvedPlan = path.resolve(planFile);
  if (!fs.existsSync(resolvedPlan) || !fs.statSync(resolvedPlan).isFile()) fail(`no such plan file: ${planFile}`);
  const sddDir = path.join(path.dirname(resolvedPlan), 'sdd');
  const problem = sddProblem(sddDir);
  if (problem) fail(problem);
  return sddDir;
}

function ensureSddDir(sddDir) {
  fs.mkdirSync(sddDir, { recursive: true });
  const problem = sddProblem(sddDir);
  if (problem) fail(problem);
  try {
    fs.writeFileSync(path.join(sddDir, '.gitignore'), '*\n', { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  return sddDir;
}

function realpathOrNull(target) {
  return fs.existsSync(target) ? fs.realpathSync(target) : null;
}

function customOutPath(sddDir, customOut) {
  if (!customOut) return null;
  const outFile = path.resolve(customOut);
  const parent = path.dirname(outFile);
  const inside = path.basename(parent) === 'sdd' && realpathOrNull(path.dirname(parent)) === fs.realpathSync(path.dirname(sddDir));
  if (!inside || path.basename(outFile).startsWith('.')) fail(`OUTFILE must be inside ${sddDir} and not start with ".": ${customOut}`);
  return outFile;
}

// Writes a new temp file, then renames it over the target, so an existing link is replaced, never written through.
function writeOutFile(outFile, content) {
  const stat = fs.lstatSync(outFile, { throwIfNoEntry: false });
  if (stat && (!stat.isFile() || stat.nlink !== 1)) fail(`refusing ${outFile}: not a regular file with one link`);
  const folder = path.dirname(outFile);
  const tempFile = path.join(folder, `.tmp-${crypto.randomBytes(8).toString('hex')}`);
  let problem = null;
  try {
    fs.writeFileSync(tempFile, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    problem = sddProblem(folder);
    if (!problem) fs.renameSync(tempFile, outFile);
  } finally {
    fs.rmSync(tempFile, { force: true });
  }
  if (problem) fail(problem);
}

module.exports = { customOutPath, ensureSddDir, fail, sddPath, writeOutFile };

if (require.main === module) {
  if (process.argv.length !== 3) fail('usage: sdd-workspace.cjs PLAN_FILE');
  console.log(ensureSddDir(sddPath(process.argv[2])));
}
