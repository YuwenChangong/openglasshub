const SCHEMA_VERSION = 'openglass-qa/v1';
const REDACTED = '[REDACTED]';
const PROFILES = new Set(['FAST', 'FEATURE', 'RELEASE', 'PRODUCTION_SMOKE']);
const RISKS = new Set(['LOW', 'MEDIUM', 'HIGH']);
const RESULTS = new Set(['PASS', 'FAIL', 'BLOCKED']);
const CHECK_STATUSES = new Set(['PASS', 'FAIL', 'SKIP']);
const SENSITIVE_KEY = /(?:authorization|password|secret|token|api[_-]?key|service[_-]?role|anon[_-]?key|dsn|credential|connection[_-]?string|pgpassword|private[_-]?key|access[_-]?key|client[_-]?secret)/i;
const JWT = /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g;
const DSN = /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s"']+/gi;
const ASSIGNMENT = /\b([A-Z][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY|SERVICE_ROLE|ANON_KEY|DATABASE_URL|POSTGRES_URL)[A-Z0-9_]*)=([^\s]+)/gi;
const BEARER = /\bBearer\s+[^\s"']+/gi;
const RAW_TOKEN = /\b(?:sk|rk|pk|ghp|xox[baprs])[-_][a-z0-9_-]{16,}\b/gi;
const LABELLED_VALUE = /\b(?:token|secret|password|api[_-]?key|service[_-]?role|anon[_-]?key|credential|private[_-]?key|access[_-]?key|client[_-]?secret)\s*[:=]\s*[^\s,;"']+/gi;

function fail(message) {
  throw new TypeError(`INVALID_RECEIPT: ${message}`);
}

function stableEntries(entries, name) {
  if (!Array.isArray(entries)) fail(`${name} must be an array`);
  return entries.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.id !== 'string' || !entry.id) {
      fail(`${name} entries require an id`);
    }
    return redactValue(entry);
  }).sort((left, right) => left.id.localeCompare(right.id));
}

function stableStrings(values, name) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string' || !value)) fail(`${name} must be strings`);
  return [...new Set(values)].sort();
}

function iso(value, name) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) fail(`${name} must be an ISO timestamp`);
  return new Date(value).toISOString();
}

function sha(value, name, nullable = false) {
  if (nullable && (value === null || value === undefined)) return null;
  if (typeof value !== 'string' || !/^[a-f0-9]{40}$/i.test(value)) fail(`${name} must be a 40-character SHA`);
  return value.toLowerCase();
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function redactValue(value, key = '') {
  if (SENSITIVE_KEY.test(key)) return REDACTED;
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((entryKey) => [entryKey, redactValue(value[entryKey], entryKey)]));
  }
  if (typeof value !== 'string') return value;
  return value
    .replace(DSN, REDACTED)
    .replace(BEARER, `Bearer ${REDACTED}`)
    .replace(JWT, REDACTED)
    .replace(RAW_TOKEN, REDACTED)
    .replace(LABELLED_VALUE, REDACTED)
    .replace(ASSIGNMENT, `$1=${REDACTED}`);
}

function canonicalSafety(input = {}) {
  const safety = {
    productionReadOnly: Boolean(input.productionReadOnly),
    productionDbConnections: input.productionDbConnections ?? 0,
    productionMutations: input.productionMutations ?? 0,
    providerMutations: input.providerMutations ?? 0,
  };
  for (const [key, value] of Object.entries(safety)) {
    if (key !== 'productionReadOnly' && (!Number.isInteger(value) || value < 0)) fail(`safety.${key} must be a non-negative integer`);
  }
  return safety;
}

function receiptPath(runId) {
  return `artifacts/qa/${runId}/receipt.json`;
}

export function createReceipt(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('input must be an object');
  if (typeof input.runId !== 'string' || !/^qa-[a-z0-9-]+$/i.test(input.runId)) fail('runId must be a qa run identifier');
  const qaProfile = input.qaProfile ?? input.profile;
  if (!PROFILES.has(qaProfile)) fail('profile is invalid');
  if (!RISKS.has(input.risk)) fail('risk is invalid');
  if (!Number.isInteger(input.changedPathsCount) || input.changedPathsCount < 0) fail('changedPathsCount must be a non-negative integer');
  const runId = input.runId;
  return deepFreeze({
    schemaVersion: SCHEMA_VERSION,
    runId,
    qaProfile,
    areas: stableStrings(input.areas ?? [], 'areas'),
    expandedAreas: stableStrings(input.expandedAreas ?? [], 'expandedAreas'),
    risk: input.risk,
    commitSha: sha(input.commitSha, 'commitSha'),
    baseSha: sha(input.baseSha, 'baseSha', true),
    changedPathsCount: input.changedPathsCount,
    selectedChecks: stableEntries(input.selectedChecks ?? [], 'selectedChecks'),
    skippedChecks: stableEntries(input.skippedChecks ?? [], 'skippedChecks'),
    startedAt: iso(input.startedAt ?? new Date().toISOString(), 'startedAt'),
    completedAt: null,
    durationMs: 0,
    passCount: 0,
    failCount: 0,
    retryCount: 0,
    result: null,
    safety: canonicalSafety(input.safety),
    artifacts: { receipt: receiptPath(runId), failureDir: null },
    error: null,
    extensions: redactValue(input.extensions ?? {}),
  });
}

function normalizeCheckResults(checkResults) {
  if (!Array.isArray(checkResults)) fail('checkResults must be an array');
  return checkResults.map((check) => {
    if (!check || typeof check !== 'object' || typeof check.id !== 'string' || !CHECK_STATUSES.has(check.status ?? 'PASS')) fail('check results require id and valid status');
    const attempts = check.attempts ?? 1;
    const durationMs = check.durationMs ?? 0;
    if (!Number.isInteger(attempts) || attempts < 1 || !Number.isFinite(durationMs) || durationMs < 0) fail('check result attempts and duration are invalid');
    return redactValue({ ...check, attempts, durationMs, status: check.status ?? 'PASS' });
  }).sort((left, right) => left.id.localeCompare(right.id));
}

export function finalizeReceipt(receipt, input = {}) {
  if (!receipt || receipt.schemaVersion !== SCHEMA_VERSION) fail('receipt must be a v1 receipt');
  const completedAt = iso(input.completedAt ?? new Date().toISOString(), 'completedAt');
  const durationMs = Date.parse(completedAt) - Date.parse(receipt.startedAt);
  if (durationMs < 0) fail('completedAt must not precede startedAt');
  const checkResults = normalizeCheckResults(input.checkResults ?? []);
  const passCount = checkResults.filter(({ status }) => status === 'PASS').length;
  const failCount = checkResults.filter(({ status }) => status === 'FAIL').length;
  const retryCount = checkResults.reduce((total, { attempts }) => total + Math.max(0, attempts - 1), 0);
  const result = input.result ?? (failCount > 0 ? 'FAIL' : 'PASS');
  if (!RESULTS.has(result)) fail('result is invalid');
  if (result === 'PASS' && failCount > 0) fail('PASS result cannot contain failed checks');
  if (result === 'FAIL' && failCount === 0 && input.error == null) fail('FAIL result requires a failed check or error');
  return deepFreeze({
    ...receipt,
    completedAt,
    durationMs,
    passCount,
    failCount,
    retryCount,
    result,
    error: input.error == null ? null : redactValue(input.error),
    extensions: redactValue({ ...receipt.extensions, ...input.extensions }),
  });
}

export function renderSummary(receipt) {
  if (!receipt || receipt.schemaVersion !== SCHEMA_VERSION || !receipt.result) fail('receipt must be finalized');
  const safety = receipt.safety;
  return `QA ${receipt.qaProfile} areas=${receipt.areas.join(',') || '-'} risk=${receipt.risk} checks=${receipt.selectedChecks.length}/${receipt.skippedChecks.length} pass=${receipt.passCount} fail=${receipt.failCount} retry=${receipt.retryCount} readonly=${safety.productionReadOnly} db=${safety.productionDbConnections} mutations=${safety.productionMutations + safety.providerMutations} result=${receipt.result}`;
}
