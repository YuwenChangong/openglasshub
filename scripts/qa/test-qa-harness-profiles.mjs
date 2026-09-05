import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { getCheck } from './check-registry.mjs';
import { resolveFastChecks } from './profiles/fast.mjs';
import { renderProfileOutput } from './runner.mjs';

const FOUNDATION = [
  'git-diff-check',
  'qa-harness-core',
  'qa-harness-executor',
  'qa-harness-manifest',
  'qa-harness-profiles',
  'qa-harness-receipt',
  'qa-harness-risk',
];

const FORBIDDEN_EXPENSIVE = [
  'database-replay',
  'deployment',
  'full-browser-e2e',
  'production-smoke',
  'provider-operations',
];

test('FAST selects only its deterministic foundation for an area-free local run', () => {
  const selection = resolveFastChecks({ profile: 'FAST', risk: 'LOW', expandedAreas: [] });

  assert.equal(selection.blocked, false);
  assert.equal(selection.risk, 'LOW');
  assert.deepEqual(selection.selectedChecks.map(({ id }) => id), FOUNDATION);
  assert.deepEqual(selection.skippedChecks.map(({ id }) => id), FORBIDDEN_EXPENSIVE);
});

test('FAST adds only cheap checks for expanded medium-risk areas', () => {
  const selection = resolveFastChecks({
    profile: 'FAST',
    risk: 'MEDIUM',
    expandedAreas: ['devices', 'products', 'search', 'seo'],
  });

  assert.equal(selection.blocked, false);
  assert.deepEqual(selection.selectedChecks.map(({ id }) => id), [
    'devices-library',
    'devices-public-data',
    'git-diff-check',
    'products-page',
    'qa-harness-core',
    'qa-harness-executor',
    'qa-harness-manifest',
    'qa-harness-profiles',
    'qa-harness-receipt',
    'qa-harness-risk',
    'search',
    'seo',
  ]);
  assert.equal(selection.selectedChecks.some(({ id }) => /admin|auth|e2e|replay|production|provider/i.test(id)), false);
});

test('FAST includes the build only when a frontend change requires it', () => {
  const plain = resolveFastChecks({ profile: 'FAST', risk: 'LOW', expandedAreas: [] });
  const frontend = resolveFastChecks({ profile: 'FAST', risk: 'LOW', expandedAreas: ['frontend'] });

  assert.equal(plain.selectedChecks.some(({ id }) => id === 'frontend-astro-build'), false);
  assert.equal(frontend.selectedChecks.some(({ id }) => id === 'frontend-astro-build'), true);
});

test('FAST fails closed before selecting checks for high-risk input', () => {
  const selection = resolveFastChecks({ profile: 'FAST', risk: 'HIGH', expandedAreas: ['database'] });

  assert.equal(selection.blocked, true);
  assert.equal(selection.requiredProfile, 'RELEASE');
  assert.equal(selection.blockedReason, 'RELEASE_REQUIRED:qa:release');
  assert.deepEqual(selection.selectedChecks, []);
  assert.deepEqual(selection.skippedChecks.map(({ id }) => id), FORBIDDEN_EXPENSIVE);
});

test('every FAST selection is an executable registry ID allowed for FAST', () => {
  const selection = resolveFastChecks({
    profile: 'FAST',
    risk: 'MEDIUM',
    expandedAreas: ['devices', 'products', 'search', 'seo'],
  });

  for (const { id } of selection.selectedChecks) {
    const registered = getCheck(id);
    assert.equal(registered.id, id);
    assert.equal(registered.allowedProfiles.includes('FAST'), true);
  }
});

test('FAST summary names profile risk exact selections skips and result', () => {
  const output = renderProfileOutput({
    qaProfile: 'FAST',
    risk: 'MEDIUM',
    selectedChecks: [{ id: 'b-check' }, { id: 'a-check' }],
    skippedChecks: [{ id: 'full-browser-e2e', reason: 'profile_budget' }],
    result: 'PASS',
  });

  assert.equal(output, [
    'QA_PROFILE=FAST',
    'RISK=MEDIUM',
    'SELECTED_CHECKS=a-check,b-check',
    'SKIPPED_EXPENSIVE_CHECKS=full-browser-e2e:profile_budget',
    'QA_RESULT=PASS',
  ].join('\n'));
});

test('package exposes qa:fast without prematurely adding the other public profiles', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  const qaScripts = Object.keys(packageJson.scripts).filter((name) => name.startsWith('qa:')).sort();

  assert.deepEqual(qaScripts, ['qa:fast']);
  assert.equal(packageJson.scripts['qa:fast'], 'node scripts/qa/runner.mjs fast');
});
