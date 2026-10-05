import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadLocaleAcceptance, validateLocaleAcceptance, runGlobalLocaleContract } from './test-global-locale-settings-contract.mjs';
import { fingerprintLocaleSource, loadLocaleOwnership } from './qa/lib/global-locale-owned-source-v2.mjs';
import { createLegacyLocaleContractFixture, createLocaleV2SourceFixture, legacyLocaleEvidence } from './qa/lib/locale-release-test-fixtures.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const source = await fingerprintLocaleSource(loadLocaleOwnership(root), { root });
const behaviors = ['LOCALE_PRECEDENCE','COUNTRY_MAPPING','ACCEPT_LANGUAGE_FALLBACK','INVALID_LOCALE_FALLBACK',
  'COUNTRY_IP_NOT_PERSISTED','ANON_COOKIE_PERSISTENCE','ACCOUNT_A_PERSISTENCE','ACCOUNT_B_PERSISTENCE',
  'CROSS_USER_ISOLATION','LOGOUT_RELOGIN','PREFERENCE_CONFLICT_HANDLING','PREFERENCE_READ_FAILURE',
  'PREFERENCE_WRITE_FAILURE','ANON_ACCOUNT_WRITE_DENY','CROSS_ACCOUNT_WRITE_DENY','ADMIN_CATALOG_ZH_CN',
  'ADMIN_CATALOG_FACT_PARITY','DOCUMENT_LANG_SCOPE','EDITORIAL_VARIANT_SELECTION','GLOBAL_PREFERENCE_UNCHANGED_BY_DOCUMENT_LANG',
  'ADMIN_CATALOG_EN','SSR_LOCALE_PROPAGATION','LEGACY_DEVICE_LOCALE_CONTINUITY','REDIRECT_LOCALE_CONTINUITY',
  'LOCALE_404_BEHAVIOR','LOCALE_CACHE_POLICY','LOCALE_PRIVATE_RESPONSE_POLICY','CATALOG_ZH_CN','CATALOG_EN',
  'CATALOG_FACT_PARITY','TRANSLATION_FALLBACK_POLICY','SEARCH_LOCALE','SEARCH_CANONICAL_DEVICE_LINKS',
  'HEADER_LOCALE','SETTINGS_LOCALE','SEARCH_STALE_RESPONSE_GUARD'];
function fixture() {
  const runId = randomUUID();
  const timestamp = '2026-10-05T10:00:00.000Z', finishedAt = '2026-10-05T10:01:00.000Z';
  return { schemaVersion: 2, runId, timestamp, finishedAt, candidateCommit: head, source: structuredClone(source),
    status: 'PASS', executionKind: 'FULL_FIVE_CONTEXT_ACCEPTANCE', maxRetries: 0, reusedEvidence: [],
    productionRequests: 0, externalRequests: 0, cleanup: 'PASS', documentEvidenceFinalization: 'COMPLETE',
    localAccounts: { genuineAuth: true, genuineRls: true },
    bootstrap: { result: 'PASS', browserReleased: true }, browserStarted: true, context1Entered: true,
    behaviors: Object.fromEntries(behaviors.map(name => [name, 'PASS'])),
    behaviorProvenance: Object.fromEntries(behaviors.map(name => [name, { origin: 'FRESH_THIS_RUN', runId }])),
    assertions: ['FIXTURE_ONLY'], assertionProvenance: [{ name: 'FIXTURE_ONLY', origin: 'FRESH_THIS_RUN', runId, contextId: null }],
    browserContexts: [['chromium',1280,'zh-CN'],['chromium',1280,'en'],['chromium',390,'zh-CN'],['chromium',390,'en'],['firefox',1280,'en']]
      .map(([engine,width,locale], index) => ({ number: index + 1, contextId: randomUUID(), engine, width, locale,
        status: 'PASS', startedAt: timestamp, finishedAt, assertionsTotal: 1, assertionsPassed: 1, failures: [] })),
  };
}
const select = input => validateLocaleAcceptance(input, { requiredVersion: 2, commitSha: head });
test('VALID_V2_ACCEPTED', () => {
  const result = select(fixture()); assert.equal(result.status, 'PASS');
  assert.equal(result.evidenceVersion, 2); assert.equal(result.evidenceCommitSha, head);
  assert.equal(result.browser, 'PASS_5_OF_5');
});
for (const [name, mutate, code] of [
  ['V2_BLOCKED_REJECTED', r => { r.status = 'BLOCKED'; }, 'LOCALE_V2_ACCEPTANCE_NOT_PASS'],
  ['V2_PARTIAL_CONTEXTS_REJECTED', r => { r.browserContexts.pop(); }, 'LOCALE_V2_CONTEXTS_INVALID'],
  ['V2_WRONG_FINGERPRINT_REJECTED', r => { r.source.fingerprint = 'f'.repeat(64); }, 'LOCALE_V2_FINGERPRINT_MISMATCH'],
  ['V2_WRONG_CONTRACT_SHA_REJECTED', r => { r.source.contractSha256 = 'f'.repeat(64); }, 'LOCALE_V2_CONTRACT_MISMATCH'],
  ['V2_WRONG_OWNERSHIP_VERSION_REJECTED', r => { r.source.ownershipVersion = 1; }, 'LOCALE_V2_OWNERSHIP_MISMATCH'],
  ['V2_WRONG_CANDIDATE_COMMIT_REJECTED', r => { r.candidateCommit = 'a'.repeat(40); }, 'LOCALE_V2_CANDIDATE_MISMATCH'],
  ['V2_MALFORMED_RECEIPT_REJECTED', r => { delete r.source; }, 'LOCALE_V2_RECEIPT_MALFORMED'],
  ['V2_WRONG_OWNED_COUNT_REJECTED', r => { r.source.fileHashes.pop(); }, 'LOCALE_V2_OWNED_COUNT_MISMATCH'],
  ['V2_NON_TERMINAL_CONTEXT_REJECTED', r => { delete r.browserContexts[0].finishedAt; }, 'LOCALE_V2_CONTEXTS_INVALID'],
  ['V2_FAILED_CONTEXT_REJECTED', r => { r.browserContexts[0].status = 'BLOCKED'; }, 'LOCALE_V2_CONTEXTS_INVALID'],
  ['V2_DUPLICATE_CONTEXT_REJECTED', r => { r.browserContexts[4] = r.browserContexts[0]; }, 'LOCALE_V2_CONTEXTS_INVALID'],
  ['V2_RETRY_REJECTED', r => { r.maxRetries = 1; }, 'LOCALE_V2_RETRY_OR_REUSE_INVALID'],
  ['V2_REUSED_EVIDENCE_REJECTED', r => { r.reusedEvidence.push('prior'); }, 'LOCALE_V2_RETRY_OR_REUSE_INVALID'],
  ['V2_PARTIAL_EXECUTION_REJECTED', r => { r.executionKind = 'CONTEXT1_PREFLIGHT_NOT_FULL_ACCEPTANCE'; }, 'LOCALE_V2_ACCEPTANCE_NOT_PASS'],
  ['V2_WRONG_PROVENANCE_REJECTED', r => { r.behaviorProvenance.LOCALE_PRECEDENCE.runId = randomUUID(); }, 'LOCALE_V2_PROVENANCE_INVALID'],
  ['V2_MISSING_BEHAVIOR_REJECTED', r => { delete r.behaviors.SEARCH_STALE_RESPONSE_GUARD; }, 'LOCALE_V2_BEHAVIORS_INVALID'],
  ['V2_MISSING_RLS_REJECTED', r => { r.localAccounts.genuineRls = false; }, 'LOCALE_V2_LOCAL_SAFETY_INVALID'],
  ['V2_INCOMPLETE_CLEANUP_REJECTED', r => { r.cleanup = 'BLOCKED'; }, 'LOCALE_V2_LOCAL_SAFETY_INVALID'],
  ['V2_EXTERNAL_REQUEST_REJECTED', r => { r.externalRequests = 1; }, 'LOCALE_V2_LOCAL_SAFETY_INVALID'],
]) test(name, () => { const input = fixture(); mutate(input); assert.deepEqual(select(input), { status: 'FAIL', code }); });
test('V1_CANNOT_SATISFY_V2_GATE', () => {
  assert.deepEqual(select(legacyLocaleEvidence(head)), { status: 'FAIL', code: 'LOCALE_EVIDENCE_VERSION_REQUIRED' });
});
test('V1_BACKWARD_PARSE_IF_REQUIRED', () => assert.equal(validateLocaleAcceptance(legacyLocaleEvidence(head)).status, 'PASS'));
test('V2 commit binding rejects an incorrect current Git HEAD before fingerprint access', async () => {
  const input = fixture(); input.candidateCommit = 'a'.repeat(40);
  assert.deepEqual(await loadLocaleAcceptance({ cwd: root, commitSha: input.candidateCommit, input, requiredVersion: 2 }),
    { status: 'FAIL', code: 'LOCALE_ACCEPTANCE_SHA_MISMATCH' });
});
test('V1 historical deterministic parsing uses an isolated source fixture, never the current V2 candidate', async () => {
  const owned = createLegacyLocaleContractFixture();
  try {
    const result = await runGlobalLocaleContract({ ...owned, execute: async () => ({ exitCode: 0, timedOut: false, signal: null, attempts: 1 }) });
    assert.equal(result.status, 'PASS'); assert.equal(result.diagnostics.browser, 'PASS_102_OF_102');
  } finally { rmSync(owned.cwd, { recursive: true, force: true }); }
});
test('V2 actual source selection binds exact Git HEAD and every owned byte, and preserves the full clean-worktree gate', async () => {
  const owned = createLocaleV2SourceFixture(root);
  try {
    const input = fixture(); input.candidateCommit = owned.head;
    const context = { cwd: owned.cwd, commitSha: owned.head, input, requiredVersion: 2 };
    assert.equal((await loadLocaleAcceptance(context)).status, 'PASS');
    const changed = structuredClone(input); changed.source.fileHashes[0][1] = 'a'.repeat(64);
    assert.deepEqual(await loadLocaleAcceptance({ ...context, input: changed }), { status: 'FAIL', code: 'LOCALE_V2_SOURCE_MISMATCH' });
    assert.deepEqual(await loadLocaleAcceptance({ ...context, input: legacyLocaleEvidence(owned.head) }),
      { status: 'FAIL', code: 'LOCALE_EVIDENCE_VERSION_REQUIRED' });
    assert.deepEqual(await loadLocaleAcceptance({ ...context, requiredVersion: undefined, input: legacyLocaleEvidence(owned.head) }),
      { status: 'FAIL', code: 'LOCALE_EVIDENCE_VERSION_REQUIRED' });
    writeFileSync(join(owned.cwd, 'untracked.tmp'), 'owned test artifact');
    assert.deepEqual(await loadLocaleAcceptance(context), { status: 'FAIL', code: 'LOCALE_ACCEPTANCE_SOURCE_CHANGED' });
    assert.deepEqual(await loadLocaleAcceptance({ ...context, validationOnly: true }), { status: 'FAIL', code: 'LOCALE_ACCEPTANCE_SOURCE_CHANGED' });
  } finally { rmSync(owned.cwd, { recursive: true, force: true }); }
});
