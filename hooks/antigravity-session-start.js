#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

let input = '';
process.stdin.setEncoding('utf8');

process.stdin.on('data', (chunk) => {
  input += chunk;
});

process.stdin.on('end', () => {
  try {
    let payload = {};
    if (input.trim()) {
      try {
        payload = JSON.parse(input);
      } catch {
        payload = {};
      }
    }

    // Only inject on the first invocation of the session
    const invocationNum = payload.invocationNum ?? 1;
    const initialNumSteps = payload.initialNumSteps ?? 0;

    if (invocationNum === 1 && initialNumSteps === 0) {
      let candidates = [
        path.resolve(__dirname, '../skills/using-all-about-agents/SKILL.md'),
        path.resolve(__dirname, './skills/using-all-about-agents/SKILL.md'),
        path.join(process.env.USERPROFILE || process.env.HOME || '', '.gemini', 'config', 'plugins', 'all-about-agents', 'skills', 'using-all-about-agents', 'SKILL.md'),
        'c:/Users/natth/Workspaces/all-about-agents/skills/using-all-about-agents/SKILL.md'
      ];

      let skillContent = '';
      for (const candidate of candidates) {
        if (candidate && fs.existsSync(candidate)) {
          skillContent = fs.readFileSync(candidate, 'utf8');
          break;
        }
      }

      if (!skillContent) {
        skillContent = 'All About Agents skills are available. Check and use relevant skills before taking action.';
      }

      const message = `<EXTREMELY_IMPORTANT>\nYou have All About Agents.\n\n**Below is the full content of your 'all-about-agents:using-all-about-agents' skill - your introduction to using skills. For all other skills, use the 'view_file' tool to view SKILL.md:**\n\n${skillContent}\n</EXTREMELY_IMPORTANT>`;

      const response = {
        injectSteps: [
          {
            ephemeralMessage: message
          }
        ]
      };
      process.stdout.write(JSON.stringify(response));
    } else {
      process.stdout.write(JSON.stringify({ injectSteps: [] }));
    }
  } catch (err) {
    process.stdout.write(JSON.stringify({ injectSteps: [] }));
  }
});
