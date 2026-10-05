const sha = /^[a-f0-9]{40}$/;
const hash = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const localeV2ReleaseIdentity = Object.freeze({
  ownershipVersion: 2, ownedFileCount: 218,
  contractSha256: 'a14c9cc458f6d898d4de07130faf92cd884475927841a89d6cb0c0cd0d15b4a1',
  fingerprint: 'eaf5dc60f0fdfbc8097077d5a6222262eb7727e299e23286a450b2c273a06b38',
});
const contexts = [['chromium',1280,'zh-CN'],['chromium',1280,'en'],['chromium',390,'zh-CN'],['chromium',390,'en'],['firefox',1280,'en']];
const behaviors = ['LOCALE_PRECEDENCE','COUNTRY_MAPPING','ACCEPT_LANGUAGE_FALLBACK','INVALID_LOCALE_FALLBACK',
  'COUNTRY_IP_NOT_PERSISTED','ANON_COOKIE_PERSISTENCE','ACCOUNT_A_PERSISTENCE','ACCOUNT_B_PERSISTENCE',
  'CROSS_USER_ISOLATION','LOGOUT_RELOGIN','PREFERENCE_CONFLICT_HANDLING','PREFERENCE_READ_FAILURE',
  'PREFERENCE_WRITE_FAILURE','ANON_ACCOUNT_WRITE_DENY','CROSS_ACCOUNT_WRITE_DENY','ADMIN_CATALOG_ZH_CN',
  'ADMIN_CATALOG_FACT_PARITY','DOCUMENT_LANG_SCOPE','EDITORIAL_VARIANT_SELECTION','GLOBAL_PREFERENCE_UNCHANGED_BY_DOCUMENT_LANG',
  'ADMIN_CATALOG_EN','SSR_LOCALE_PROPAGATION','LEGACY_DEVICE_LOCALE_CONTINUITY','REDIRECT_LOCALE_CONTINUITY',
  'LOCALE_404_BEHAVIOR','LOCALE_CACHE_POLICY','LOCALE_PRIVATE_RESPONSE_POLICY','CATALOG_ZH_CN','CATALOG_EN',
  'CATALOG_FACT_PARITY','TRANSLATION_FALLBACK_POLICY','SEARCH_LOCALE','SEARCH_CANONICAL_DEVICE_LINKS',
  'HEADER_LOCALE','SETTINGS_LOCALE','SEARCH_STALE_RESPONSE_GUARD'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const time = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(value) && Number.isFinite(Date.parse(value));
const fail = code => ({ status: 'FAIL', code });

export function validateLocaleV2Evidence(input, commitSha) {
  if (!object(input) || input.schemaVersion !== 2 || !uuid.test(input.runId ?? '') ||
      !sha.test(input.candidateCommit ?? '') || !object(input.source) ||
      !time(input.timestamp) || !time(input.finishedAt) || Date.parse(input.finishedAt) < Date.parse(input.timestamp)) {
    return fail('LOCALE_V2_RECEIPT_MALFORMED');
  }
  if (!sha.test(commitSha ?? '') || input.candidateCommit !== commitSha) return fail('LOCALE_V2_CANDIDATE_MISMATCH');
  if (input.status !== 'PASS' || input.executionKind !== 'FULL_FIVE_CONTEXT_ACCEPTANCE' || input.firstFailure || input.primaryError) {
    return fail('LOCALE_V2_ACCEPTANCE_NOT_PASS');
  }
  if (input.maxRetries !== 0 || !Array.isArray(input.reusedEvidence) || input.reusedEvidence.length ||
      (Object.hasOwn(input, 'retries') && input.retries !== 0) || (Object.hasOwn(input, 'attempts') && input.attempts !== 1)) {
    return fail('LOCALE_V2_RETRY_OR_REUSE_INVALID');
  }
  const source = input.source;
  if (source.ownershipVersion !== 2) return fail('LOCALE_V2_OWNERSHIP_MISMATCH');
  if (source.contractSha256 !== localeV2ReleaseIdentity.contractSha256) return fail('LOCALE_V2_CONTRACT_MISMATCH');
  if (source.fingerprint !== localeV2ReleaseIdentity.fingerprint) return fail('LOCALE_V2_FINGERPRINT_MISMATCH');
  if (!Array.isArray(source.fileHashes) || source.fileHashes.length !== 218) return fail('LOCALE_V2_OWNED_COUNT_MISMATCH');
  if (source.algorithmVersion !== 'locale-owned-content-sha256-v1' ||
      source.fileHashes.some(row => !Array.isArray(row) || row.length !== 2 || typeof row[0] !== 'string' || !hash.test(row[1])) ||
      new Set(source.fileHashes.map(row => row[0])).size !== 218 ||
      source.fileHashes.map(row => row[0]).join('\0') !== source.fileHashes.map(row => row[0]).sort().join('\0')) {
    return fail('LOCALE_V2_RECEIPT_MALFORMED');
  }
  if (!Array.isArray(input.browserContexts) || input.browserContexts.length !== 5) return fail('LOCALE_V2_CONTEXTS_INVALID');
  const contextIds = new Set();
  for (const [index, context] of input.browserContexts.entries()) {
    if (!object(context) || context.number !== index + 1 || !uuid.test(context.contextId ?? '') || contextIds.has(context.contextId) ||
        JSON.stringify([context.engine,context.width,context.locale]) !== JSON.stringify(contexts[index]) || context.status !== 'PASS' ||
        !time(context.startedAt) || !time(context.finishedAt) || Date.parse(context.finishedAt) < Date.parse(context.startedAt) ||
        Date.parse(context.startedAt) < Date.parse(input.timestamp) || Date.parse(context.finishedAt) > Date.parse(input.finishedAt) ||
        !Number.isInteger(context.assertionsTotal) || context.assertionsTotal < 1 || context.assertionsPassed !== context.assertionsTotal ||
        !Array.isArray(context.failures) || context.failures.length) return fail('LOCALE_V2_CONTEXTS_INVALID');
    contextIds.add(context.contextId);
  }
  if (input.productionRequests !== 0 || input.externalRequests !== 0 || input.cleanup !== 'PASS' ||
      input.documentEvidenceFinalization !== 'COMPLETE' || input.localAccounts?.genuineAuth !== true ||
      input.localAccounts?.genuineRls !== true || input.bootstrap?.result !== 'PASS' || input.bootstrap?.browserReleased !== true ||
      input.browserStarted !== true || input.context1Entered !== true) return fail('LOCALE_V2_LOCAL_SAFETY_INVALID');
  if (!object(input.behaviors) || behaviors.some(name => input.behaviors[name] !== 'PASS')) return fail('LOCALE_V2_BEHAVIORS_INVALID');
  const fresh = value => object(value) && value.origin === 'FRESH_THIS_RUN' && value.runId === input.runId;
  if (!object(input.behaviorProvenance) || behaviors.some(name => !fresh(input.behaviorProvenance[name])) ||
      !Array.isArray(input.assertions) || !input.assertions.length || input.assertions.some(name => typeof name !== 'string') ||
      !Array.isArray(input.assertionProvenance) || !input.assertionProvenance.length ||
      input.assertionProvenance.some(value => !fresh(value) || !input.assertions.includes(value.name) ||
        (value.contextId !== null && !contextIds.has(value.contextId)))) return fail('LOCALE_V2_PROVENANCE_INVALID');
  return { status: 'PASS', code: 'LOCALE_ACCEPTANCE_ACCEPTED', evidenceVersion: 2, evidenceCommitSha: input.candidateCommit,
    evidenceRunId: input.runId, browser: 'PASS_5_OF_5', coverage: 'PASS_218_OWNERS',
    persistence: 'PASS_GENUINE_LOCAL_ACCEPTED', sourceFingerprint: source.fingerprint,
    sourceContractSha256: source.contractSha256 };
}
