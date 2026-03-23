import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearApprovalHandler,
  clearSessionApprovals,
  requestApproval,
  setApprovalHandler,
  setDangerouslySkipPermissions,
} from '../src/utils/approval.js';
import { runBash } from '../src/tools/bash.js';

test('approval and bash security controls', async (t) => {
  clearApprovalHandler();
  clearSessionApprovals();
  setDangerouslySkipPermissions(false);

  await t.test('approval fails closed when no handler is registered', async () => {
    clearApprovalHandler();
    const approved = await requestApproval({
      id: 'no-handler',
      type: 'file_write',
      description: 'Write file',
      sessionId: 'session-a',
    });

    assert.equal(approved, false);
  });

  await t.test('session approvals are scoped by session and operation key', async () => {
    let callCount = 0;
    setApprovalHandler(async () => {
      callCount++;
      return callCount === 1 ? 'approve_session' : 'reject';
    });

    const first = await requestApproval({
      id: 'first',
      type: 'shell_command',
      description: 'Run safe command',
      sessionId: 'session-a',
      sessionScopeKey: 'shell:git status',
    });
    const secondSameScope = await requestApproval({
      id: 'second',
      type: 'shell_command',
      description: 'Run safe command again',
      sessionId: 'session-a',
      sessionScopeKey: 'shell:git status',
    });
    const thirdDifferentSession = await requestApproval({
      id: 'third',
      type: 'shell_command',
      description: 'Run safe command in other session',
      sessionId: 'session-b',
      sessionScopeKey: 'shell:git status',
    });

    assert.equal(first, true);
    assert.equal(secondSameScope, true);
    assert.equal(thirdDifferentSession, false);
    assert.equal(callCount, 2);
  });

  await t.test('bash requires approval for chained shell commands', async () => {
    setApprovalHandler(async () => 'reject');

    const result = await runBash('git status && pwd', 5_000, 'session-a');

    assert.match(result, /Command cancelled by user/);
  });

  await t.test('bash requires approval for file-reading commands outside tool sandbox', async () => {
    setApprovalHandler(async () => 'reject');

    const result = await runBash('cat package.json', 5_000, 'session-a');

    assert.match(result, /Command cancelled by user/);
  });

  await t.test('bash abort signal stops a running command', async () => {
    setApprovalHandler(async () => 'approve_once');

    const controller = new AbortController();
    const commandPromise = runBash(
      'node -e "setTimeout(() => console.log(\'done\'), 10000)"',
      15_000,
      'session-a',
      controller.signal,
    );

    setTimeout(() => controller.abort(), 100);

    const result = await commandPromise;

    assert.match(result, /Command aborted by user/);
  });

  clearApprovalHandler();
  clearSessionApprovals();
  setDangerouslySkipPermissions(false);
});
