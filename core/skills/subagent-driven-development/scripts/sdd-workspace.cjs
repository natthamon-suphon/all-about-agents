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

function workspaceProblem(sddDir) {
  const container = path.dirname(sddDir);
  return (path.basename(container) === 'sdd' ? sddProblem(container) : null) || sddProblem(sddDir);
}

function planPath(planFile) {
  if (typeof planFile !== 'string' || /[\x00-\x1f\x7f]/.test(planFile)) fail('invalid PLAN_FILE: control characters are not allowed');
  const resolvedPlan = path.resolve(planFile);
  const stat = fs.lstatSync(resolvedPlan, { throwIfNoEntry: false });
  if (!stat?.isFile()) fail(`no such plan file: ${planFile}`);
  return fs.realpathSync(resolvedPlan);
}

function sddPath(planFile) {
  const resolvedPlan = planPath(planFile);
  const sddDir = path.join(path.dirname(resolvedPlan), 'sdd', path.basename(resolvedPlan));
  const problem = workspaceProblem(sddDir);
  if (problem) fail(problem);
  return sddDir;
}

function ensureSddDir(sddDir) {
  const before = workspaceProblem(sddDir);
  if (before) fail(before);
  fs.mkdirSync(sddDir, { recursive: true });
  const problem = workspaceProblem(sddDir);
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
  const inside = path.basename(parent) === path.basename(sddDir) && path.basename(path.dirname(parent)) === 'sdd' && realpathOrNull(path.dirname(path.dirname(parent))) === fs.realpathSync(path.dirname(path.dirname(sddDir)));
  if (!inside || path.basename(outFile).startsWith('.')) fail(`OUTFILE must be inside ${sddDir} and not start with ".": ${customOut}`);
  return path.join(sddDir, path.basename(outFile));
}

function checkOutFile(outFile) {
  const stat = fs.lstatSync(outFile, { throwIfNoEntry: false });
  if (stat && (!stat.isFile() || stat.nlink !== 1)) fail(`refusing ${outFile}: not a regular file with one link`);
  const problem = workspaceProblem(path.dirname(outFile));
  if (problem) fail(problem);
}

// Writes a new temp file, then renames it over the target, so an existing link is replaced, never written through.
function writeOutFile(outFile, content) {
  checkOutFile(outFile);
  const folder = path.dirname(outFile);
  let problem;
  const tempFile = path.join(folder, `.tmp-${crypto.randomBytes(8).toString('hex')}`);
  try {
    fs.writeFileSync(tempFile, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    problem = workspaceProblem(folder);
    if (!problem) fs.renameSync(tempFile, outFile);
  } finally {
    fs.rmSync(tempFile, { force: true });
  }
  if (problem) fail(problem);
}

function readPlanLedger(resolvedPlan, sddDir) {
  const outFile = path.join(sddDir, 'progress.md');
  checkOutFile(outFile);
  const header = `# SDD ledger — plan: ${resolvedPlan}`;
  const content = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : `${header}\n`;
  if (content.split(/\r?\n/, 1)[0] !== header) fail(`ledger does not name this plan: ${outFile}; expected ${resolvedPlan}`);
  return { outFile, content };
}

module.exports = { checkOutFile, customOutPath, ensureSddDir, fail, planPath, readPlanLedger, sddPath, writeOutFile };

if (require.main === module) {
  if (process.argv.length !== 3) fail('usage: sdd-workspace.cjs PLAN_FILE');
  console.log(ensureSddDir(sddPath(process.argv[2])));
}
