import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { manifest, validateManifest, GLOBAL_LOCALE_PREREQUISITES } from './qa/manifest.mjs';
import { normalizeCheckResult } from './qa/contracts.mjs';
import { executeCommand } from './qa/process-executor.mjs';
import { createReceipt, finalizeReceipt } from './qa/receipt.mjs';

export const LOCALE_ACCEPTANCE_PATH = 'artifacts/qa/global-locale-settings-v1/accepted-inputs.json';
const ID = 'global-locale-settings-contract';
const TASK20_FILES = new Set([
  'package.json', 'scripts/qa/manifest.mjs', 'scripts/qa/profiles/release.mjs',
  'scripts/qa/test-qa-harness-manifest.mjs', 'scripts/qa/test-qa-harness-profiles.mjs',
  'scripts/test-global-locale-settings-contract.mjs', 'docs/ops/global-locale-settings-v1-acceptance.md',
]);
const SHA = /^[a-f0-9]{40}$/;
const commands = Object.freeze([
  Object.freeze([process.execPath, '--experimental-strip-types', '--test',
    'scripts/test-locale-contract.mjs', 'scripts/test-locale-detection.mjs',
    'scripts/test-locale-cookie-store.mjs', 'scripts/test-user-preferences-api.mjs']),
  Object.freeze([process.execPath, 'scripts/test-user-preferences-schema.mjs']),
]);

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort());
}

export function validateLocaleAcceptance(input) {
  const failure = { status: 'FAIL', code: 'LOCALE_ACCEPTANCE_INVALID' };
  if (!exactKeys(input, ['schemaVersion', 'commitSha', ...Object.keys(GLOBAL_LOCALE_PREREQUISITES)]) ||
      input.schemaVersion !== 1 || typeof input.commitSha !== 'string' || !SHA.test(input.commitSha)) return failure;
  for (const [gate, required] of Object.entries(GLOBAL_LOCALE_PREREQUISITES)) {
    if (!exactKeys(input[gate], ['status', ...Object.keys(required)]) || input[gate].status !== 'PASS') return failure;
    const { status, ...observed } = input[gate];
    if (!isDeepStrictEqual(observed, required)) return failure;
  }
  return { status: 'PASS', code: 'LOCALE_ACCEPTANCE_ACCEPTED', evidenceCommitSha: input.commitSha,
    browser: 'PASS_102_OF_102', coverage: 'PASS_ACCEPTED', persistence: 'PASS_GENUINE_LOCAL_ACCEPTED',
    regressions: 'PASS_ACCEPTED_146_NODE_10_SCRIPTS' };
}

export async function loadLocaleAcceptance({ cwd, commitSha }) {
  let input;
  try {
    const file = resolve(cwd, LOCALE_ACCEPTANCE_PATH);
    const stats = await lstat(file);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size > 65_536) return { status: 'FAIL', code: 'LOCALE_ACCEPTANCE_INVALID' };
    input = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    return { status: 'FAIL', code: error?.code === 'ENOENT' ? 'LOCALE_ACCEPTANCE_MISSING' : 'LOCALE_ACCEPTANCE_INVALID' };
  }
  const result = validateLocaleAcceptance(input);
  if (result.status !== 'PASS') return result;
  try {
    const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (git(['rev-parse', 'HEAD']) !== commitSha) return { status: 'FAIL', code: 'LOCALE_ACCEPTANCE_SHA_MISMATCH' };
    git(['merge-base', '--is-ancestor', input.commitSha, commitSha]);
    const changed = git(['diff', '--name-only', input.commitSha, commitSha]).split(/\r?\n/).filter(Boolean);
    if (changed.some(file => !TASK20_FILES.has(file)) || git(['status', '--porcelain', '--untracked-files=normal'])) {
      return { status: 'FAIL', code: 'LOCALE_ACCEPTANCE_SOURCE_CHANGED' };
    }
  } catch { return { status: 'FAIL', code: 'LOCALE_ACCEPTANCE_SHA_MISMATCH' }; }
  return result;
}

function localEnvironment() {
  const allowed = ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'COMSPEC', 'ComSpec'];
  return { ...Object.fromEntries(allowed.filter(key => typeof process.env[key] === 'string').map(key => [key, process.env[key]])),
    ASTRO_TELEMETRY_DISABLED: '1', ASTRO_DISABLE_UPDATE_CHECK: 'true', WRANGLER_SEND_METRICS: 'false',
    CLOUDFLARE_CF_FETCH_ENABLED: 'false' };
}

async function validateCoverageInventory(cwd) {
  const coverage = JSON.parse(await readFile(resolve(cwd, GLOBAL_LOCALE_PREREQUISITES.coverage.manifest), 'utf8'));
  assert.equal(coverage.version, 1);
  assert.ok(Array.isArray(coverage.files) && coverage.files.length === 108);
  const paths = new Set();
  for (const entry of coverage.files) {
    assert.ok(typeof entry.path === 'string' && /^src\/[a-zA-Z0-9_./[\]-]+$/.test(entry.path) && !entry.path.split('/').includes('..'));
    assert.ok(!paths.has(entry.path)); paths.add(entry.path);
    assert.ok(typeof entry.namespace === 'string' && entry.namespace.length > 0);
    assert.ok(Array.isArray(entry.cases) && entry.cases.length > 0);
    assert.ok(Array.isArray(entry.evidence) && entry.evidence.length > 0);
    await access(resolve(cwd, entry.path));
    for (const evidence of entry.evidence) {
      assert.ok(typeof evidence === 'string' && /^scripts\/[a-zA-Z0-9_./-]+\.mjs$/.test(evidence) && !evidence.split('/').includes('..'));
      await access(resolve(cwd, evidence));
    }
  }
  for (const file of ['src/components/forum/AuthPanel.tsx',
    'src/components/starlight/ThemeProvider.astro']) assert.ok(paths.has(file));
  return coverage.files.length;
}

export async function runGlobalLocaleContract({ cwd = process.cwd(), qaManifest = manifest, execute = executeCommand } = {}) {
  const started = Date.now();
  const diagnostics = { mode: 'VALIDATION_ONLY', deterministic: 'NOT_RUN',
    browser: 'SEPARATE_ACCEPTED_INPUT_REQUIRED', coverage: 'SEPARATE_ACCEPTED_INPUT_REQUIRED',
    persistence: 'SEPARATE_ACCEPTED_INPUT_REQUIRED', regressions: 'SEPARATE_ACCEPTED_INPUT_REQUIRED',
    productionConnections: 0, productionMutations: 0 };
  const finish = (status, code, classification = 'DETERMINISTIC') => normalizeCheckResult({
    id: ID, status, attempts: 1, durationMs: Date.now() - started, classification,
    diagnostics: { ...diagnostics, code },
  });
  try {
    validateManifest(qaManifest);
    const item = qaManifest.areas['locale-settings'].checks.find(check => check.id === ID);
    assert.ok(item && isDeepStrictEqual(item.prerequisites, GLOBAL_LOCALE_PREREQUISITES));
    const pkg = JSON.parse(await readFile(resolve(cwd, 'package.json'), 'utf8'));
    for (const [name, command] of Object.entries({
      'test:global-locale-contract': 'node scripts/test-global-locale-settings-contract.mjs',
      'test:global-locale-browser': 'node scripts/test-global-locale-browser.mjs',
      'test:global-locale-persistence-local': 'node scripts/test-global-locale-persistence-local.mjs',
    })) assert.equal(pkg.scripts[name], command);
    diagnostics.coverageInventoryFiles = await validateCoverageInventory(cwd);
  } catch { return finish('FAIL', 'LOCALE_CONTRACT_INVALID', 'VALIDATION'); }
  for (const argv of commands) {
    let result;
    try {
      result = await execute({ argv: [...argv], cwd, env: localEnvironment(), timeoutMs: 90_000,
        retryPolicy: { classification: 'LOCAL', maxRetries: 0 } });
    } catch { return finish('FAIL', 'LOCALE_CONTRACT_CHILD_FAILED'); }
    if (result?.exitCode !== 0 || result.timedOut !== false || result.signal !== null || result.attempts !== 1) {
      return finish('FAIL', result?.timedOut ? 'LOCALE_CONTRACT_TIMEOUT' : 'LOCALE_CONTRACT_CHILD_FAILED');
    }
  }
  diagnostics.deterministic = 'PASS';
  return finish('PASS', 'LOCALE_DETERMINISTIC_CONTRACT_PASS');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const startedAt = new Date().toISOString();
  let commitSha;
  try { commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { process.stderr.write('LOCALE_CONTRACT=FAIL CODE=SOURCE_IDENTITY_UNAVAILABLE\n'); process.exitCode = 1; }
  if (commitSha) {
    const result = process.argv.length === 2 ? await runGlobalLocaleContract() : normalizeCheckResult({
      id: ID, status: 'FAIL', attempts: 1, classification: 'VALIDATION', diagnostics: { code: 'INVALID_INVOCATION' },
    });
    const receipt = finalizeReceipt(createReceipt({ runId: `qa-${randomUUID()}`, profile: 'RELEASE',
      areas: ['locale-settings'], expandedAreas: ['locale-settings', 'security'], risk: 'HIGH', commitSha,
      baseSha: null, changedPathsCount: 0, selectedChecks: [{ id: ID, kind: 'command' }],
      startedAt, safety: { productionReadOnly: false, productionDbConnections: 0, productionMutations: 0, providerMutations: 0 },
    }), { checkResults: [result], extensions: { mode: 'VALIDATION_ONLY', sliceBReleaseAccepted: false } });
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    if (result.status !== 'PASS') process.exitCode = 1;
  }
}
