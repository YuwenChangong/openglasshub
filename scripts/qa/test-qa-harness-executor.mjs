import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { getCheck, registerCheck, runCheck } from './check-registry.mjs';
import { executeCommand } from './process-executor.mjs';

const node = process.execPath;
let nextCheck = 0;

function check(overrides = {}) {
  nextCheck += 1;
  return {
    id: `executor-test-${nextCheck}`,
    allowedProfiles: ['FAST'],
    timeoutMs: 1_000,
    retryPolicy: { classification: 'LOCAL', maxRetries: 0 },
    artifactPolicy: { onFailure: true, onSuccess: false },
    classification: 'DETERMINISTIC',
    run: async () => ({ status: 'PASS' }),
    ...overrides,
  };
}

test('registry rejects malformed duplicates and blocks profiles outside the declaration', async () => {
  assert.throws(() => registerCheck({ id: 'missing-fields' }), /INVALID_CHECK/);

  const registered = registerCheck(check());
  assert.equal(getCheck(registered.id), registered);
  assert.throws(() => registerCheck(registered), /DUPLICATE_CHECK/);
  await assert.rejects(() => runCheck(registered.id, { profile: 'RELEASE' }), /PROFILE_NOT_ALLOWED/);
  assert.deepEqual(await runCheck(registered.id, { profile: 'FAST' }), { status: 'PASS' });
});

test('executor passes argv literally without a shell', async () => {
  const marker = join(tmpdir(), `openglass-qa-shell-${process.pid}-${Date.now()}`);
  const literal = `literal;${process.platform === 'win32' ? '&' : ''}${marker}`;
  try {
    const result = await executeCommand({
      argv: [node, '-e', 'process.stdout.write(process.argv[1])', literal],
      cwd: process.cwd(),
      env: {},
      timeoutMs: 1_000,
      retryPolicy: { classification: 'LOCAL', maxRetries: 0 },
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, literal);
    assert.equal(existsSync(marker), false);
  } finally {
    rmSync(marker, { force: true });
  }
});

test('executor terminates timed-out commands and reports the timeout', async () => {
  const result = await executeCommand({
    argv: [node, '-e', 'setTimeout(() => {}, 5_000)'],
    cwd: process.cwd(),
    env: {},
    timeoutMs: 50,
    retryPolicy: { classification: 'LOCAL', maxRetries: 0 },
  });
  assert.equal(result.timedOut, true);
  assert.equal(result.attempts, 1);
  assert.notEqual(result.exitCode, 0);
});

test('executor bounds child output and preserves the first fatal line', async () => {
  const result = await executeCommand({
    argv: [node, '-e', "process.stdout.write('x'.repeat(9000)); process.stderr.write('fatal: bounded failure\\n' + 'y'.repeat(9000)); process.exitCode = 1"],
    cwd: process.cwd(),
    env: {},
    timeoutMs: 1_000,
    retryPolicy: { classification: 'LOCAL', maxRetries: 0 },
  });
  assert.equal(result.exitCode, 1);
  assert.ok(result.stdout.length <= 4_096);
  assert.ok(result.stderr.length <= 4_096);
  assert.equal(result.firstFatalLine, 'fatal: bounded failure');
});

test('executor never retries deterministic local failures', async () => {
  const result = await executeCommand({
    argv: [node, '-e', 'process.exitCode = 1'],
    cwd: process.cwd(),
    env: {},
    timeoutMs: 1_000,
    retryPolicy: { classification: 'LOCAL', maxRetries: 0 },
  });
  assert.equal(result.attempts, 1);
  assert.equal(result.attemptResults.length, 1);
});

test('executor permits exactly one retry for network-classified failures', async () => {
  const stateFile = join(mkdtempSync(join(tmpdir(), 'openglass-qa-retry-')), 'attempted');
  try {
    const result = await executeCommand({
      argv: [node, '-e', "const fs = require('fs'); const state = process.argv[1]; if (!fs.existsSync(state)) { fs.writeFileSync(state, '1'); console.error('network unavailable'); process.exitCode = 1; }", stateFile],
      cwd: process.cwd(),
      env: {},
      timeoutMs: 1_000,
      retryPolicy: { classification: 'NETWORK', maxRetries: 1 },
    });
    assert.equal(result.attempts, 2);
    assert.equal(result.exitCode, 0);
    assert.equal(result.attemptResults[0].exitCode, 1);
    assert.equal(result.attemptResults[1].exitCode, 0);
  } finally {
    rmSync(join(stateFile, '..'), { recursive: true, force: true });
  }
});

test('executor redacts secret sentinels from diagnostics and captured output', async () => {
  const sentinel = 'qa-secret-sentinel-value';
  const result = await executeCommand({
    argv: [node, '-e', "console.error('OPENAI_API_KEY=' + process.env.QA_SECRET_SENTINEL); process.exitCode = 1"],
    cwd: process.cwd(),
    env: { QA_SECRET_SENTINEL: sentinel },
    timeoutMs: 1_000,
    retryPolicy: { classification: 'LOCAL', maxRetries: 0 },
  });
  assert.equal(result.stderr.includes(sentinel), false);
  assert.equal(JSON.stringify(result.diagnostics).includes(sentinel), false);
  assert.match(result.stderr, /\[REDACTED\]/);
});

test('executor never exposes a secret prefix split by the bounded output boundary', async () => {
  const sentinel = 'qa-secret-boundary-sentinel';
  const result = await executeCommand({
    argv: [node, '-e', "process.stdout.write('x'.repeat(4090) + process.env.QA_SECRET_SENTINEL); process.stderr.write('fatal: ' + 'y'.repeat(4083) + process.env.QA_SECRET_SENTINEL); process.exitCode = 1"],
    cwd: process.cwd(),
    env: { QA_SECRET_SENTINEL: sentinel },
    timeoutMs: 1_000,
    retryPolicy: { classification: 'LOCAL', maxRetries: 0 },
  });
  const leakedPrefix = sentinel.slice(0, 6);
  for (const value of [result.stdout, result.stderr, result.firstFatalLine, JSON.stringify(result.diagnostics)]) {
    assert.equal(value.includes(sentinel), false);
    assert.equal(value.includes(leakedPrefix), false);
    for (let length = 1; length < '[REDACTED]'.length; length += 1) {
      assert.equal(value.endsWith('[REDACTED]'.slice(0, length)), false);
    }
  }
});
