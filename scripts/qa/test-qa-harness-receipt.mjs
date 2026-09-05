import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { createReceipt, finalizeReceipt, redactValue, renderSummary } from './receipt.mjs';
import { writeFailureArtifacts } from './artifacts.mjs';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const RUN_ID = 'qa-00000000-0000-4000-8000-000000000001';

function draft(overrides = {}) {
  return createReceipt({
    runId: RUN_ID,
    profile: 'FEATURE',
    areas: ['devices', 'auth'],
    expandedAreas: ['seo', 'devices', 'auth', 'products'],
    risk: 'MEDIUM',
    commitSha: SHA,
    baseSha: null,
    changedPathsCount: 2,
    selectedChecks: [{ id: 'z-build', kind: 'command' }, { id: 'a-unit', kind: 'command' }],
    skippedChecks: [{ id: 'z-e2e', reason: 'profile_budget' }, { id: 'a-replay', reason: 'not_selected' }],
    startedAt: '2026-09-05T00:00:00.000Z',
    ...overrides,
  });
}

test('receipt freezes the v1 schema and orders selections deterministically', () => {
  const receipt = finalizeReceipt(draft(), {
    completedAt: '2026-09-05T00:00:01.250Z',
    checkResults: [
      { id: 'z-build', status: 'PASS', attempts: 1, durationMs: 100 },
      { id: 'a-unit', status: 'SKIP', attempts: 1, durationMs: 0 },
    ],
  });

  assert.equal(receipt.schemaVersion, 'openglass-qa/v1');
  assert.equal(receipt.qaProfile, 'FEATURE');
  assert.deepEqual(receipt.areas, ['auth', 'devices']);
  assert.deepEqual(receipt.expandedAreas, ['auth', 'devices', 'products', 'seo']);
  assert.deepEqual(receipt.selectedChecks.map(({ id }) => id), ['a-unit', 'z-build']);
  assert.deepEqual(receipt.skippedChecks.map(({ id }) => id), ['a-replay', 'z-e2e']);
  assert.equal(Object.hasOwn(receipt, 'checkResults'), false);
  assert.equal(receipt.durationMs, 1250);
  assert.equal(receipt.passCount, 1);
  assert.equal(receipt.failCount, 0);
  assert.equal(receipt.retryCount, 0);
  assert.equal(receipt.result, 'PASS');
  assert.deepEqual(receipt.safety, {
    productionReadOnly: false,
    productionDbConnections: 0,
    productionMutations: 0,
    providerMutations: 0,
  });
  assert.equal(receipt.artifacts.receipt, `artifacts/qa/${RUN_ID}/receipt.json`);
  assert.equal(receipt.artifacts.failureDir, null);
  assert.equal(Object.isFrozen(receipt), true);
});

test('summary remains compact and never renders diagnostics', () => {
  const receipt = finalizeReceipt(draft(), {
    completedAt: '2026-09-05T00:00:00.010Z',
    checkResults: [{ id: 'a-unit', status: 'PASS', diagnostics: { token: 'should-not-render' } }],
  });
  const summary = renderSummary(receipt);
  assert.match(summary, /QA FEATURE/);
  assert.match(summary, /result=PASS/);
  assert.equal(summary.includes('should-not-render'), false);
  assert.equal(summary.length < 500, true);
});

test('redaction is value-blind for secret names, DSNs, tokens, and nested values', () => {
  const sentinel = 'qa-secret-sentinel-abcdefghijklmnop';
  const value = redactValue({
    password: sentinel,
    dsn: `postgresql://user:${sentinel}@db.example.test/postgres?sslmode=require`,
    authorization: `Bearer ${sentinel}`,
    nested: [`OPENAI_API_KEY=${sentinel}`, `eyJ${'a'.repeat(20)}.${'b'.repeat(20)}.${'c'.repeat(20)}`, `token=${sentinel}`],
  });
  const serialized = JSON.stringify(value);
  assert.equal(serialized.includes(sentinel), false);
  assert.equal(serialized.includes('postgresql://user:'), false);
  assert.match(serialized, /\[REDACTED\]/);
  assert.doesNotMatch(JSON.stringify(redactValue({ privateKey: 'SENTINEL_PRIVATE', text: 'privateKey=SENTINEL_PRIVATE', access: 'AWS_ACCESS_KEY_ID=SENTINEL_ACCESS' })), /SENTINEL_(PRIVATE|ACCESS)/);
});

test('redaction covers serialized assignments, Supabase secrets, PEM payloads, and authorization queries', () => {
  const sentinel = 'qa-sensitive-value-abcdefghijklmnop';
  const samples = [
    `{"password":"${sentinel}","safe":"visible"}`,
    `config={"client_secret": "${sentinel}"}`,
    `OPENAI_API_KEY="${sentinel} with spaces"`,
    `sb_secret_${sentinel}`,
    `-----BEGIN PRIVATE KEY-----\n${sentinel}\n-----END PRIVATE KEY-----`,
    `https://example.test/callback?authorization=${sentinel}&next=%2Fdevices`,
  ];

  const redacted = redactValue(samples);
  const serialized = JSON.stringify(redacted);
  assert.equal(serialized.includes(sentinel), false);
  assert.equal(serialized.includes('BEGIN PRIVATE KEY'), false);
  assert.equal(serialized.includes('authorization=qa-sensitive'), false);
  assert.equal(redacted[0].includes('"safe":"visible"'), true);
});

test('receipt cannot claim PASS when a check failed', () => {
  assert.throws(() => finalizeReceipt(draft(), {
    completedAt: '2026-09-05T00:00:01.000Z',
    result: 'PASS',
    checkResults: [{ id: 'a-unit', status: 'FAIL' }],
  }), /PASS result cannot contain failed checks/);
});

test('failure artifacts are bounded, run-scoped, and redacted', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'openglass-qa-receipt-'));
  const sentinel = 'qa-secret-sentinel-abcdefghijklmnop';
  try {
    const receipt = finalizeReceipt(draft(), {
      completedAt: '2026-09-05T00:00:00.010Z',
      checkResults: [{ id: 'a-unit', status: 'FAIL', attempts: 1, diagnostics: { stderr: `fatal ${sentinel} ${'x'.repeat(9000)}` } }],
    });
    const artifacts = await writeFailureArtifacts({
      receipt,
      artifactRoot: temp,
      failures: [{ id: 'a-unit', stderr: `DATABASE_URL=postgresql://user:${sentinel}@db.example.test/postgres` }],
    });
    const runDirectory = join(temp, RUN_ID);
    assert.equal(artifacts.receipt, `artifacts/qa/${RUN_ID}/receipt.json`);
    assert.equal(artifacts.failureDir, `artifacts/qa/${RUN_ID}/failure`);
    assert.equal(existsSync(join(runDirectory, 'receipt.json')), true);
    assert.equal(existsSync(join(runDirectory, 'failure', 'a-unit.json')), true);
    assert.equal(readdirSync(join(runDirectory, 'failure')).length, 1);
    const payload = readFileSync(join(runDirectory, 'failure', 'a-unit.json'), 'utf8');
    assert.equal(payload.includes(sentinel), false);
    assert.equal(payload.length < 5_000, true);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('receipt serialization remains bounded for megabyte error and extension inputs', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'openglass-qa-receipt-'));
  const sentinel = 'qa-megabyte-secret-abcdefghijklmnop';
  try {
    const receipt = finalizeReceipt(draft(), {
      completedAt: '2026-09-05T00:00:00.010Z',
      result: 'FAIL',
      checkResults: [],
      error: { message: `safe failure detail ${'e'.repeat(1_000_000)}` },
      extensions: { diagnostics: `sb_secret_${sentinel}${'x'.repeat(1_000_000)}` },
    });
    await writeFailureArtifacts({ receipt, artifactRoot: temp });
    const payload = readFileSync(join(temp, RUN_ID, 'receipt.json'), 'utf8');
    assert.equal(payload.includes(sentinel), false);
    assert.equal(payload.length < 50_000, true);
    assert.equal(receipt.error.message.length < 10_000, true);
    assert.equal(receipt.extensions.diagnostics.length < 10_000, true);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('successful runs write only the receipt and no failure directory', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'openglass-qa-receipt-'));
  try {
    const receipt = finalizeReceipt(draft(), {
      completedAt: '2026-09-05T00:00:00.010Z',
      checkResults: [{ id: 'a-unit', status: 'PASS' }],
    });
    const artifacts = await writeFailureArtifacts({ receipt, artifactRoot: temp, failures: [] });
    const runDirectory = join(temp, RUN_ID);
    assert.equal(artifacts.failureDir, null);
    assert.deepEqual(readdirSync(runDirectory), ['receipt.json']);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('failure artifact writer rejects draft receipts', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'openglass-qa-receipt-'));
  try {
    await assert.rejects(() => writeFailureArtifacts({ receipt: draft(), artifactRoot: temp }), /finalized v1 receipt/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
