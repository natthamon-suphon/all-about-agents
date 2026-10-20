#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const scripts = path.join(__dirname, '../../subagent-driven-development/scripts');
const { fail, readPlanLedger, writeOutFile } = require(path.join(scripts, 'sdd-workspace.cjs'));
const { prepareBrief, writeBrief } = require(path.join(scripts, 'task-brief.cjs'));
const { snapshot } = require(path.join(scripts, 'review-package.cjs'));

const args = process.argv.slice(2);
if (args.length !== 2) fail('usage: task-start.cjs PLAN_FILE TASK_NUMBER');
const brief = prepareBrief(...args);
const ledger = readPlanLedger(brief.planPath, brief.sddDir);
const base = snapshot(brief.sddDir);
if (!fs.existsSync(ledger.outFile)) writeOutFile(ledger.outFile, ledger.content);
writeBrief(brief);
console.log(JSON.stringify({ briefPath: brief.outFile, base }));
setImmediate(() => {});
