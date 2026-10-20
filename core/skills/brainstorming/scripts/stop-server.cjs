'use strict';

const fs = require('node:fs');
const { sessionPath, statePath, validateTree, removeSession, readControl, controlRequest, socketAbsent, processAbsent, closedInstance, delay } = require('./lifecycle.cjs');

async function main() {
  if (process.argv.length !== 3 || !process.argv[2] || process.argv[2].startsWith('--')) throw new Error('Usage: stop-server.cjs SESSION_DIRECTORY');
  const session = sessionPath(process.argv[2]);
  if (!fs.existsSync(session)) return { status: 'not_running', removed: false };
  validateTree(session);
  const state = statePath(session);
  const record = readControl(state);
  if (await socketAbsent(record.port)) {
    if (!closedInstance(state, record.instance) && !processAbsent(record.pid)) throw new Error('instance state is uncertain; session retained');
    removeSession(session);
    return { status: 'stale', removed: true };
  }
  const status = await controlRequest(record, 'GET', '/status');
  if (status.status !== 'active') throw new Error('instance is not active; session retained');
  const response = await controlRequest(record, 'POST', '/stop');
  if (response.status !== 'stopping') throw new Error('stop was not acknowledged; session retained');
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (closedInstance(state, record.instance) && await socketAbsent(record.port)) {
      removeSession(session);
      return { status: 'stopped', removed: true };
    }
    await delay(50);
  }
  throw new Error('matching instance did not confirm closure; session retained');
}

main().then((result) => process.stdout.write(`${JSON.stringify(result)}\n`)).catch((error) => {
  const result = error.cleanupFailure
    ? { status: 'error', removed: false, partial: error.partial, retryable: error.retryable, error: 'filesystem cleanup failed; the session may be partly removed' }
    : { status: 'refused', removed: false, error: 'stop refused: invalid path, identity, authentication or uncertain instance state' };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = 1;
});
