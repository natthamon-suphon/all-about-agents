#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');

let input = '';
process.stdin.setEncoding('utf8');

process.stdin.on('data', (chunk) => {
  input += chunk;
});

process.stdin.on('end', () => {
  try {
    if (input.trim()) {
      const data = JSON.parse(input);
      const conversationId = data.conversationId || 'default';
      const logDir = path.join(os.tmpdir(), 'antigravity-statusline');

      fs.mkdirSync(logDir, { recursive: true });

      const toolName = data.toolCall?.name;
      if (toolName) {
        fs.appendFileSync(path.join(logDir, `${conversationId}-tools.log`), `${new Date().toISOString()} ${toolName}\n`);
      }
    }
  } catch {
    // Fail silently
  } finally {
    // PostToolUse always returns {}
    process.stdout.write(JSON.stringify({}));
  }
});
