import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { writeFailureArtifacts } from './artifacts.mjs';
import { expandDependencies, getArea, matchPath } from './manifest.mjs';
import { executeCommand } from './process-executor.mjs';
import { validateProductionRequest, validateProductionTarget } from './production-safety.mjs';
import { resolveFastChecks } from './profiles/fast.mjs';
import { resolveFeatureChecks } from './profiles/feature.mjs';
import { createReceipt, finalizeReceipt, redactValue, renderSummary } from './receipt.mjs';
import { classifyChanges } from './risk.mjs';

const NODE = process.execPath;
const STARTED_AT = '2026-09-05T00:00:00.000Z';
const COMPLETED_AT = '2026-09-05T00:00:01.000Z';
const COMMIT_SHA = 'a'.repeat(40);
const BASE_SHA = 'b'.repeat(40);

const PUBLIC_QA_SCRIPTS = {
  'qa:fast': 'node scripts/qa/runner.mjs fast',
  'qa:feature': 'node scripts/qa/runner.mjs feature',
  'qa:release': 'node scripts/qa/runner.mjs release',
  'qa:prod': 'node scripts/qa/runner.mjs prod',
};

const PRESERVED_LOWER_LEVEL_SCRIPTS = {
  build: 'node scripts/build-workers.mjs',
  test: 'node --experimental-strip-types scripts/test-moderation.mjs && node --experimental-strip-types scripts/test-trusted-server-admin-runtime.mjs && node --experimental-strip-types scripts/test-admin-circle-lifecycle.mjs',
  'test:astro-check-ratchet': 'node scripts/test-astro-check-baseline-ratchet.mjs',
  'test:auth-legal-consent': 'node scripts/test-auth-legal-acknowledgement.mjs',
  'test:auth-redirect-safety': 'node --experimental-strip-types scripts/test-auth-redirect-safety.mjs',
  'test:device-library': 'node scripts/test-device-library.mjs',
  'test:forum-permissions': 'node scripts/verify-forum-permissions.cjs',
  'test:media-url-privacy': 'node scripts/audit-media-url-privacy.mjs --strict --verbose',
  'test:products': 'node scripts/test-product-page.mjs',
  'test:profile-role-security': 'node scripts/audit-profile-role-security.mjs --strict --verbose',
  'test:search': 'node --experimental-strip-types scripts/test-search.mjs',
  'test:security-privilege-convergence': 'node --test scripts/qa/test-security-privilege-convergence.mjs',
  'test:workers-artifact': 'node scripts/qa/test-workers-generated-artifact.mjs',
  'test:workers-config': 'node scripts/qa/test-workers-native-config.mjs',
  'test:workers-env-contract': 'node scripts/qa/test-workers-environment-contract.mjs',
};

function createDraft(overrides = {}) {
  return createReceipt({
    runId: 'qa-harness-v1-matrix',
    profile: 'FAST',
    areas: ['frontend'],
    expandedAreas: ['frontend'],
    risk: 'LOW',
    commitSha: COMMIT_SHA,
    baseSha: BASE_SHA,
    changedPathsCount: 1,
    selectedChecks: [{ id: 'git-diff-check' }],
    skippedChecks: [],
    startedAt: STARTED_AT,
    safety: {
      productionReadOnly: false,
      productionDbConnections: 0,
      productionMutations: 0,
      providerMutations: 0,
    },
    ...overrides,
  });
}

function finalizeDraft(draft, checkResults, overrides = {}) {
  return finalizeReceipt(draft, {
    completedAt: COMPLETED_AT,
    checkResults,
    ...overrides,
  });
}

test('package command contract exposes exactly four public profiles and preserves lower-level scripts', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  const publicQaScriptNames = Object.keys(packageJson.scripts).filter((name) => name.startsWith('qa:')).sort();

  assert.deepEqual(publicQaScriptNames, Object.keys(PUBLIC_QA_SCRIPTS).sort());
  for (const [name, command] of Object.entries(PUBLIC_QA_SCRIPTS)) {
    assert.equal(packageJson.scripts[name], command, name);
  }
  for (const [name, command] of Object.entries(PRESERVED_LOWER_LEVEL_SCRIPTS)) {
    assert.equal(packageJson.scripts[name], command, name);
  }
  assert.equal(packageJson.scripts['test:qa-harness-v1'], 'node --test scripts/qa/test-qa-harness-v1.mjs');
});

test('CSS-only changes stay LOW and select only FAST-safe checks', () => {
  const classification = classifyChanges({ paths: ['src/styles/theme.css'] });
  assert.deepEqual(classification.directAreas, ['frontend']);
  assert.deepEqual(classification.expandedAreas, ['frontend']);
  assert.equal(classification.risk, 'LOW');

  const selection = resolveFastChecks({
    profile: 'FAST',
    risk: classification.risk,
    expandedAreas: classification.expandedAreas,
  });
  assert.equal(selection.blocked, false);
  assert.deepEqual(selection.selectedChecks.map(({ id }) => id), [
    'frontend-astro-build',
    'git-diff-check',
    'qa-harness-core',
    'qa-harness-executor',
    'qa-harness-manifest',
    'qa-harness-profiles',
    'qa-harness-receipt',
    'qa-harness-risk',
  ]);
  assert.deepEqual(selection.skippedChecks.map(({ id }) => id), [
    'database-replay',
    'deployment',
    'full-browser-e2e',
    'production-smoke',
    'provider-operations',
  ]);
});

test('device detail changes are MEDIUM and expand to declared dependencies', () => {
  const classification = classifyChanges({ paths: ['src/pages/devices/example.astro'] });
  assert.deepEqual(classification.directAreas, ['devices']);
  assert.deepEqual(classification.expandedAreas, ['devices', 'products', 'search', 'seo']);
  assert.equal(classification.risk, 'MEDIUM');

  const selection = resolveFeatureChecks({
    profile: 'FEATURE',
    risk: classification.risk,
    expandedAreas: classification.expandedAreas,
  });
  assert.equal(selection.blocked, false);
  for (const id of ['devices-library', 'devices-public-data', 'products-page', 'search', 'seo']) {
    assert.ok(selection.selectedChecks.some((check) => check.id === id), id);
  }
});

test('compare is classified as MEDIUM only when backed by a manifest area', () => {
  const compare = getArea('compare');
  if (!compare) {
    assert.equal(matchPath('src/pages/compare/index.astro'), 'frontend');
    assert.equal(classifyChanges({ paths: ['src/pages/compare/index.astro'] }).risk, 'LOW');
    return;
  }

  const classification = classifyChanges({ paths: ['src/pages/compare/index.astro'] });
  assert.equal(classification.risk, 'MEDIUM');
  assert.ok(classification.expandedAreas.includes('compare'));
  for (const area of compare.relatedAreas) assert.ok(classification.expandedAreas.includes(area), area);
});

test('Supabase migration changes are HIGH and require RELEASE', () => {
  const classification = classifyChanges({ paths: ['supabase/migrations/20260905000000_example.sql'] });
  assert.deepEqual(classification.directAreas, ['database']);
  assert.deepEqual(classification.expandedAreas, ['database', 'security']);
  assert.equal(classification.risk, 'HIGH');
  assert.equal(classification.releaseRequired, true);
  assert.ok(classification.escalationReasons.includes('RELEASE_REQUIRED:qa:release'));
});

test('an explicit low-risk area cannot downgrade HIGH changed paths', () => {
  const classification = classifyChanges({
    paths: ['supabase/migrations/20260905000000_example.sql'],
    explicitArea: 'frontend',
  });
  const selection = resolveFeatureChecks({
    profile: 'FEATURE',
    risk: classification.risk,
    expandedAreas: classification.expandedAreas,
  });
  assert.equal(classification.risk, 'HIGH');
  assert.equal(selection.blocked, true);
  assert.equal(selection.requiredProfile, 'RELEASE');
  assert.equal(selection.blockedReason, 'RELEASE_REQUIRED:qa:release');
  assert.deepEqual(selection.selectedChecks, []);
});

test('dependency expansion is stable, sorted, and deduplicated', () => {
  assert.deepEqual(expandDependencies(['devices', 'forum', 'devices']), [
    'auth',
    'devices',
    'forum',
    'media',
    'products',
    'search',
    'security',
    'seo',
  ]);
});

test('FEATURE selection avoids unrelated admin checks', () => {
  const selection = resolveFeatureChecks({
    profile: 'FEATURE',
    risk: 'MEDIUM',
    expandedAreas: ['devices', 'products', 'search', 'seo'],
  });
  const selectedIds = selection.selectedChecks.map(({ id }) => id);
  assert.equal(selectedIds.includes('admin-device-api'), false);
  assert.equal(selectedIds.includes('admin-profile-role-security'), false);
  assert.ok(selection.skippedChecks.some(({ id, reason }) => id === 'admin-device-api' && reason === 'area_not_selected'));
});

test('one network retry retains the first failure and counts both attempts', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'openglass-qa-v1-retry-'));
  const stateFile = join(temp, 'attempted');
  try {
    const result = await executeCommand({
      argv: [NODE, '-e', "const fs = require('node:fs'); const state = process.argv[1]; if (!fs.existsSync(state)) { fs.writeFileSync(state, '1'); console.error('network unavailable'); process.exitCode = 1; } else { console.log('recovered'); }", stateFile],
      cwd: process.cwd(),
      env: {},
      timeoutMs: 1_000,
      retryPolicy: { classification: 'NETWORK', maxRetries: 1 },
    });
    assert.equal(result.attempts, 2);
    assert.equal(result.attemptResults[0].exitCode, 1);
    assert.equal(result.attemptResults[1].exitCode, 0);
    assert.equal(result.diagnostics.firstFatalLine, 'network unavailable');
    assert.match(result.stdout, /recovered/);
    const receipt = finalizeDraft(
      createDraft({ runId: 'qa-retry-matrix', selectedChecks: [{ id: 'network-check' }] }),
      [{ id: 'network-check', status: 'PASS', attempts: result.attempts, diagnostics: result.diagnostics }],
    );
    assert.equal(receipt.retryCount, 1);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('receipt generation has a stable schema and deterministic ordering', () => {
  const left = createDraft({
    areas: ['search', 'devices'],
    expandedAreas: ['seo', 'devices', 'products', 'search'],
    selectedChecks: [{ id: 'search' }, { id: 'devices-library' }],
    skippedChecks: [{ id: 'production-smoke', reason: 'local' }, { id: 'database-replay', reason: 'profile' }],
  });
  const right = createDraft({
    areas: ['devices', 'search'],
    expandedAreas: ['products', 'search', 'devices', 'seo'],
    selectedChecks: [{ id: 'devices-library' }, { id: 'search' }],
    skippedChecks: [{ id: 'database-replay', reason: 'profile' }, { id: 'production-smoke', reason: 'local' }],
  });
  assert.equal(left.schemaVersion, 'openglass-qa/v1');
  assert.deepEqual(left, right);
  assert.deepEqual(left.areas, ['devices', 'search']);
  assert.deepEqual(left.selectedChecks.map(({ id }) => id), ['devices-library', 'search']);
});

test('destructive production routes are rejected before network I/O', () => {
  let networkCalls = 0;
  const send = (request) => {
    const validated = validateProductionRequest(request);
    networkCalls += 1;
    return validated;
  };
  assert.throws(
    () => send({ url: 'https://openglasshub.ogh.workers.dev/api/admin/purge', method: 'DELETE' }),
    (error) => error?.code === 'PRODUCTION_ROUTE_REJECTED',
  );
  assert.equal(networkCalls, 0);
});

test('invalid and non-HTTPS production hosts are rejected before network I/O', () => {
  let networkCalls = 0;
  const connect = (origin) => {
    const validated = validateProductionTarget(origin);
    networkCalls += 1;
    return validated;
  };
  for (const origin of ['http://openglasshub.ogh.workers.dev', 'https://attacker.example']) {
    assert.throws(() => connect(origin), (error) => error?.code === 'PRODUCTION_ROUTE_REJECTED');
  }
  assert.equal(networkCalls, 0);
});

test('secret sentinels are redacted from values and persisted artifacts', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'openglass-qa-v1-redaction-'));
  const sentinel = 'qa-secret-sentinel-value';
  try {
    const execution = await executeCommand({
      argv: [NODE, '-e', "console.error('OPENAI_API_KEY=' + process.env.QA_SECRET_SENTINEL); process.exitCode = 1"],
      cwd: process.cwd(),
      env: { QA_SECRET_SENTINEL: sentinel },
      timeoutMs: 1_000,
      retryPolicy: { classification: 'LOCAL', maxRetries: 0 },
    });
    assert.equal(execution.stdout.includes(sentinel), false);
    assert.equal(execution.stderr.includes(sentinel), false);
    assert.equal(JSON.stringify(execution.diagnostics).includes(sentinel), false);
    const receipt = finalizeDraft(
      createDraft({ runId: 'qa-redaction-matrix', selectedChecks: [{ id: 'secret-check' }] }),
      [{ id: 'secret-check', status: 'FAIL', diagnostics: { ...execution.diagnostics, token: sentinel } }],
    );
    await writeFailureArtifacts({
      receipt,
      failures: [{ id: 'secret-check', token: sentinel, diagnostics: execution.diagnostics }],
      artifactRoot: temp,
    });
    const runDirectory = join(temp, receipt.runId);
    const artifactText = [
      readFileSync(join(runDirectory, 'receipt.json'), 'utf8'),
      readFileSync(join(runDirectory, 'failure', 'secret-check.json'), 'utf8'),
    ].join('\n');
    assert.equal(JSON.stringify(redactValue({ token: sentinel, stderr: `OPENAI_API_KEY=${sentinel}` })).includes(sentinel), false);
    assert.equal(artifactText.includes(sentinel), false);
    assert.match(artifactText, /\[REDACTED\]/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('a failed check produces exactly one run-scoped failure artifact', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'openglass-qa-v1-failure-'));
  try {
    const failure = { id: 'network-check', status: 'FAIL', diagnostics: { code: 'E_HTTP' } };
    const receipt = finalizeDraft(
      createDraft({ runId: 'qa-failure-matrix', selectedChecks: [{ id: 'network-check' }] }),
      [failure],
    );
    const artifacts = await writeFailureArtifacts({ receipt, failures: [failure], artifactRoot: temp });
    assert.equal(artifacts.failureDir, 'artifacts/qa/qa-failure-matrix/failure');
    assert.deepEqual(readdirSync(join(temp, receipt.runId), { withFileTypes: true }).map(({ name }) => name).sort(), ['failure', 'receipt.json']);
    assert.deepEqual(readdirSync(join(temp, receipt.runId, 'failure')), ['network-check.json']);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('a successful run writes only its receipt and renders one compact summary line', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'openglass-qa-v1-success-'));
  try {
    const receipt = finalizeDraft(
      createDraft({ runId: 'qa-success-matrix' }),
      [{ id: 'git-diff-check', status: 'PASS', attempts: 1 }],
    );
    const artifacts = await writeFailureArtifacts({ receipt, artifactRoot: temp });
    const summary = renderSummary(receipt);
    assert.equal(artifacts.failureDir, null);
    assert.deepEqual(readdirSync(join(temp, receipt.runId)), ['receipt.json']);
    assert.equal(summary, 'QA FAST areas=frontend risk=LOW checks=1/0 pass=1 fail=0 retry=0 readonly=false db=0 mutations=0 result=PASS');
    assert.equal(summary.includes('\n'), false);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
