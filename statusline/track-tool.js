#!/usr/bin/env node
// Claude Code PostToolUse hook - tracks agents and skills used per session
const fs = require('fs');
const os = require('os');
const path = require('path');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const sessionId = data.session_id || 'default';
    const logDir = path.join(os.tmpdir(), 'claude-statusline');

    fs.mkdirSync(logDir, { recursive: true });

    const toolName = data.tool_name;

    if (toolName === 'Agent') {
      const agent = data.tool_input?.subagent_type || data.tool_input?.description || 'unknown';
      fs.appendFileSync(path.join(logDir, `${sessionId}-agents.log`), agent + '\n');
    } else if (toolName === 'Skill') {
      const skill = data.tool_input?.skill || 'unknown';
      fs.appendFileSync(path.join(logDir, `${sessionId}-skills.log`), skill + '\n');
    }
  } catch {
    // Silently fail - don't disrupt the session
  }
});
