import assert from 'node:assert/strict';
import test from 'node:test';

import {
  QA_PROFILES,
  RISK_LEVELS,
  createRunContext,
  normalizeCheckResult,
  parseInvocation,
} from './contracts.mjs';

test('exports the frozen public profile and risk enums', () => {
  assert.deepEqual(QA_PROFILES, {
    FAST: 'FAST',
    FEATURE: 'FEATURE',
    RELEASE: 'RELEASE',
    PROD: 'PRODUCTION_SMOKE',
  });
  assert.deepEqual(RISK_LEVELS, { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH' });
  assert.equal(Object.isFrozen(QA_PROFILES), true);
  assert.equal(Object.isFrozen(RISK_LEVELS), true);
});

test('parses a profile and one optional feature area without executing anything', () => {
  assert.deepEqual(parseInvocation(['feature', 'devices']), {
    profile: QA_PROFILES.FEATURE,
    area: 'devices',
  });
  assert.deepEqual(parseInvocation(['release']), {
    profile: QA_PROFILES.RELEASE,
    area: null,
  });
});

test('accepts the runner process argv shape and normalizes an area', () => {
  assert.deepEqual(parseInvocation(['node', 'scripts/qa/runner.mjs', 'FAST']), {
    profile: QA_PROFILES.FAST,
    area: null,
  });
  assert.deepEqual(parseInvocation(['--profile', 'qa:feature', '--area', 'Device Detail']), {
    profile: QA_PROFILES.FEATURE,
    area: 'device-detail',
  });
});

test('rejects unknown, duplicate, and misplaced arguments with a stable typed error', () => {
  for (const argv of [
    ['unknown'],
    ['feature', 'devices', 'forum'],
    ['feature', '--profile', 'release'],
    ['--area', 'devices'],
    ['--profile', 'fast', '--profile', 'release'],
    ['--bogus'],
  ]) {
    assert.throws(
      () => parseInvocation(argv),
      (error) => error?.name === 'QAInvocationValidationError' && error.code === 'INVALID_INVOCATION',
    );
  }
});

test('normalizes check results with deterministic safe defaults', () => {
  assert.deepEqual(normalizeCheckResult({ id: 'build', status: 'PASS' }), {
    id: 'build',
    status: 'PASS',
    attempts: 1,
    durationMs: 0,
    classification: 'DETERMINISTIC',
    diagnostics: {},
  });
  assert.deepEqual(normalizeCheckResult({ id: 'api', status: 'FAIL', attempts: 2, diagnostics: { code: 'E_HTTP' } }), {
    id: 'api',
    status: 'FAIL',
    attempts: 2,
    durationMs: 0,
    classification: 'DETERMINISTIC',
    diagnostics: { code: 'E_HTTP' },
  });
});

test('rejects unsafe result fields and invalid result values', () => {
  assert.throws(() => normalizeCheckResult({ status: 'PASS' }), /id/);
  assert.throws(() => normalizeCheckResult({ id: 'x', status: 'UNKNOWN' }), /status/);
  assert.throws(() => normalizeCheckResult({ id: 'x', status: 'PASS', diagnostics: 'secret' }), /diagnostics/);
});

test('creates deterministic value-blind run context from an allowlisted input', () => {
  const input = {
    profile: QA_PROFILES.FEATURE,
    area: 'devices',
    areas: ['devices'],
    risk: RISK_LEVELS.MEDIUM,
    commitSha: 'a'.repeat(40),
    baseSha: 'b'.repeat(40),
    changedPathsCount: 2,
    environment: { NODE_ENV: 'test', SECRET_TOKEN: 'should-not-appear' },
    token: 'should-not-appear',
  };
  const context = createRunContext(input);
  assert.deepEqual(context, {
    profile: QA_PROFILES.FEATURE,
    area: 'devices',
    areas: ['devices'],
    risk: RISK_LEVELS.MEDIUM,
    commitSha: 'a'.repeat(40),
    baseSha: 'b'.repeat(40),
    changedPathsCount: 2,
  });
  assert.deepEqual(context, createRunContext({ ...input }));
  assert.equal(JSON.stringify(context).includes('should-not-appear'), false);
});
