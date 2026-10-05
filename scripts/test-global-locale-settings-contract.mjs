import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { manifest, validateManifest, GLOBAL_LOCALE_PREREQUISITES } from './qa/manifest.mjs';
import { normalizeCheckResult } from './qa/contracts.mjs';
import { executeCommand } from './qa/process-executor.mjs';
import { createReceipt, finalizeReceipt } from './qa/receipt.mjs';
import { validateLocaleV2Evidence } from './lib/locale-v2-release-evidence.mjs';
import { ownershipManifestPath, loadLocaleOwnership, fingerprintLocaleSource } from './qa/lib/global-locale-owned-source-v2.mjs';

const ID = 'global-locale-settings-contract';
const TASK20_FILES = new Set([
  'package.json', 'scripts/qa/manifest.mjs', 'scripts/qa/profiles/release.mjs',
  'scripts/qa/test-qa-harness-manifest.mjs', 'scripts/qa/test-qa-harness-profiles.mjs',
  'scripts/test-global-locale-settings-contract.mjs', 'docs/ops/global-locale-settings-v1-acceptance.md',
  'scripts/test-auth-legal-acknowledgement.mjs', 'scripts/qa/checks/playwright.mjs',
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

export function localeReleaseEvidenceVersion(cwd) {
  return existsSync(resolve(cwd, ownershipManifestPath)) ? 2 : 1;
}

export function validateLocaleAcceptance(input, { requiredVersion, commitSha } = {}) {
  if (requiredVersion !== undefined && input?.schemaVersion !== requiredVersion) {
    return { status: 'FAIL', code: 'LOCALE_EVIDENCE_VERSION_REQUIRED' };
  }
  if (input?.schemaVersion === 2) return validateLocaleV2Evidence(input, commitSha);
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

export async function loadLocaleAcceptance({ cwd, commitSha, input, validationOnly = false, requiredVersion }) {
  if (input === undefined || input === null) return { status: 'FAIL', code: 'LOCALE_ACCEPTANCE_MISSING' };
  requiredVersion = localeReleaseEvidenceVersion(cwd) === 2 ? 2 : requiredVersion;
  const result = validateLocaleAcceptance(input, { requiredVersion, commitSha });
  if (result.status !== 'PASS') return result;
  try {
    const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (git(['rev-parse', 'HEAD']) !== commitSha) return { status: 'FAIL', code: 'LOCALE_ACCEPTANCE_SHA_MISMATCH' };
    if (input.schemaVersion === 2) {
      // V2 never uses V1's ancestor allowance or validation-only dirty-worktree exception.
      if (git(['status', '--porcelain', '--untracked-files=normal'])) return { status: 'FAIL', code: 'LOCALE_ACCEPTANCE_SOURCE_CHANGED' };
      const source = await fingerprintLocaleSource(loadLocaleOwnership(cwd), { root: cwd });
      if (!isDeepStrictEqual(source, input.source)) return { status: 'FAIL', code: 'LOCALE_V2_SOURCE_MISMATCH' };
      return result;
    }
    git(['merge-base', '--is-ancestor', input.commitSha, commitSha]);
    const changed = git(['diff', '--name-only', input.commitSha, commitSha]).split(/\r?\n/).filter(Boolean);
    const pending = [
      ...git(['diff', 'HEAD', '--name-only']).split(/\r?\n/),
      ...git(['ls-files', '--others', '--exclude-standard']).split(/\r?\n/),
    ].filter(Boolean);
    if ([...changed, ...pending].some(file => !TASK20_FILES.has(file)) ||
        (!validationOnly && git(['status', '--porcelain', '--untracked-files=normal']))) {
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

export async function runGlobalLocaleContract({ cwd = process.cwd(), qaManifest = manifest, execute = executeCommand,
  localeAcceptance, requiredVersion = localeReleaseEvidenceVersion(cwd) } = {}) {
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
    if (requiredVersion === 1) diagnostics.coverageInventoryFiles = await validateCoverageInventory(cwd);
    const commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const accepted = await loadLocaleAcceptance({ cwd, commitSha, input: localeAcceptance ?? item.acceptedEvidence,
      validationOnly: true, requiredVersion });
    if (accepted.status !== 'PASS') return finish('FAIL', accepted.code, 'VALIDATION');
    const { status, code, ...historical } = accepted;
    Object.assign(diagnostics, historical, { evidenceOrigin: requiredVersion === 2 ? 'EXPLICIT_EXACT_HEAD_V2_RECEIPT' : 'ACCEPTED_TASK19',
      freshBrowserEvidence: false, freshLocalRlsEvidence: false });
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
    let input, inputFailure = false;
    if (process.argv.length === 4 && process.argv[2] === '--locale-evidence') {
      try { input = JSON.parse(await readFile(resolve(process.argv[3]), 'utf8')); }
      catch { inputFailure = true; }
    }
    const result = !inputFailure && (process.argv.length === 2 || (process.argv.length === 4 && process.argv[2] === '--locale-evidence'))
      ? await runGlobalLocaleContract({ localeAcceptance: input }) : normalizeCheckResult({
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
