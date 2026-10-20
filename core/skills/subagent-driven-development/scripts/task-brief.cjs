#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { checkOutFile, customOutPath, ensureSddDir, fail, planPath, readPlanLedger, sddPath, writeOutFile } = require(path.join(__dirname, 'sdd-workspace.cjs'));

function prepareBrief(planFile, taskNumStr, customOut) {
  if (!/^[0-9]+$/.test(taskNumStr) || !Number.isSafeInteger(Number(taskNumStr))) fail(`invalid task number: ${taskNumStr}`);
  const n = Number(taskNumStr);
  const sddDir = sddPath(planFile);
  const outFile = customOutPath(sddDir, customOut) ?? path.join(sddDir, `task-${n}-brief.md`);
  checkOutFile(outFile);
  const resolvedPlan = planPath(planFile);
  const lines = fs.readFileSync(resolvedPlan, 'utf8').split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();

  let fence = null;
  const outside = [];
  const headings = lines.map((line, i) => {
    const marker = line.match(/^[ \t]*(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      return null;
    }
    if (marker) {
      fence = marker[1];
      return null;
    }
    outside[i] = true;
    const heading = line.match(/^(#+)(?:[ \t]|$)/);
    return heading ? { level: heading[1].length, task: line.match(/^#+[ \t]+Task[ \t]+([0-9]+)(?:[^0-9]|$)/)?.[1] } : null;
  });
  const start = headings.findIndex((heading) => heading?.task !== undefined && Number(heading.task) === n);
  if (start === -1) {
    console.error(`task ${n} not found in ${planFile} (no heading matching 'Task ${n}')`);
    process.exit(3);
  }
  let end = start + 1;
  while (end < lines.length && (!headings[end] || (headings[end].level > headings[start].level && headings[end].task === undefined))) end++;
  const firstTask = headings.findIndex((heading) => heading?.task !== undefined);
  const context = [];
  for (let i = 0; i < firstTask; i++) {
    if (!outside[i]) continue;
    if (/^[ \t]*(?:\*\*)?(?:Spec(?:ification)?|Design(?: spec)?):(?:\*\*)?[ \t]*\S/i.test(lines[i])) context.push(lines[i], '');
    if (headings[i] && /^#+[ \t]+Global Constraints[ \t]*#*[ \t]*$/i.test(lines[i])) {
      let limit = i + 1;
      while (limit < lines.length && (!headings[limit] || headings[limit].level > headings[i].level)) limit++;
      context.push(...lines.slice(i, limit));
      if (context.at(-1) !== '') context.push('');
      i = limit - 1;
    }
  }
  const briefLines = [...context, ...lines.slice(start, end)];
  return { n, planPath: resolvedPlan, sddDir, outFile, content: briefLines.join('\n') + '\n', lineCount: briefLines.length };
}

function writeBrief(brief) {
  readPlanLedger(brief.planPath, brief.sddDir);
  ensureSddDir(brief.sddDir);
  writeOutFile(brief.outFile, brief.content);
  return brief.outFile;
}

module.exports = { prepareBrief, writeBrief };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 2 || args.length > 3) fail('usage: task-brief.cjs PLAN_FILE TASK_NUMBER [OUTFILE]');
  const brief = prepareBrief(...args);
  writeBrief(brief);
  console.log(`wrote ${brief.outFile}: ${brief.lineCount} lines`);
}
