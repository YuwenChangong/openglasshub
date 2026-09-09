import { fileURLToPath } from 'node:url';

import { getArea } from '../manifest.mjs';
import { registerCheck } from '../check-registry.mjs';
import { normalizeCheckResult, QA_PROFILES } from '../contracts.mjs';
import { executeCommand } from '../process-executor.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const NODE = process.execPath;
const RISK_ORDER = Object.freeze({ LOW: 0, MEDIUM: 1, HIGH: 2 });

const FOUNDATION_IDS = Object.freeze([
  'git-diff-check',
  'qa-harness-core',
  'qa-harness-executor',
  'qa-harness-manifest',
  'qa-harness-profiles',
  'qa-harness-receipt',
  'qa-harness-risk',
]);

const AREA_CHECK_IDS = Object.freeze({
  frontend: Object.freeze(['frontend-astro-build']),
  devices: Object.freeze(['devices-library', 'devices-public-data']),
  products: Object.freeze(['products-page']),
  forum: Object.freeze(['forum-permissions', 'forum-search']),
  news: Object.freeze(['news-api-safety']),
  search: Object.freeze(['search']),
  media: Object.freeze(['media-url-privacy']),
  seo: Object.freeze(['seo']),
});

const SKIPPED_EXPENSIVE_CHECKS = Object.freeze([
  Object.freeze({ id: 'database-replay', reason: 'fast_profile_forbids_database_replay' }),
  Object.freeze({ id: 'deployment', reason: 'verification_only_no_deployment' }),
  Object.freeze({ id: 'full-browser-e2e', reason: 'fast_profile_budget' }),
  Object.freeze({ id: 'production-smoke', reason: 'local_profile_no_production_network' }),
  Object.freeze({ id: 'provider-operations', reason: 'verification_only_no_provider_operations' }),
]);

const COMMANDS = Object.freeze({
  'git-diff-check': Object.freeze(['git', 'diff', '--check']),
  'qa-harness-core': Object.freeze([NODE, '--test', 'scripts/qa/test-qa-harness-core.mjs']),
  'qa-harness-executor': Object.freeze([NODE, '--test', 'scripts/qa/test-qa-harness-executor.mjs']),
  'qa-harness-manifest': Object.freeze([NODE, '--test', 'scripts/qa/test-qa-harness-manifest.mjs']),
  'qa-harness-profiles': Object.freeze([NODE, '--test', 'scripts/qa/test-qa-harness-profiles.mjs']),
  'qa-harness-receipt': Object.freeze([NODE, '--test', 'scripts/qa/test-qa-harness-receipt.mjs']),
  'qa-harness-risk': Object.freeze([NODE, '--test', 'scripts/qa/test-qa-harness-risk.mjs']),
  'frontend-astro-build': Object.freeze([NODE, 'scripts/build-workers.mjs']),
  'devices-library': Object.freeze([NODE, 'scripts/test-device-library.mjs']),
  'devices-public-data': Object.freeze([NODE, 'scripts/test-public-device-data.mjs']),
  'products-page': Object.freeze([NODE, 'scripts/test-product-page.mjs']),
  'forum-permissions': Object.freeze([NODE, 'scripts/verify-forum-permissions.cjs']),
  'forum-search': Object.freeze([NODE, '--experimental-strip-types', 'scripts/test-search.mjs']),
  'news-api-safety': Object.freeze([NODE, 'scripts/test-public-news-api-safety.mjs']),
  search: Object.freeze([NODE, '--experimental-strip-types', 'scripts/test-search.mjs']),
  'media-url-privacy': Object.freeze([NODE, 'scripts/audit-media-url-privacy.mjs', '--strict', '--verbose']),
  seo: Object.freeze([NODE, 'scripts/verify-seo.cjs']),
});

function registerCommand(id, argv) {
  registerCheck({
    id,
    allowedProfiles: [QA_PROFILES.FAST],
    timeoutMs: id === 'frontend-astro-build' ? 180_000 : 60_000,
    retryPolicy: { classification: 'LOCAL', maxRetries: 0 },
    artifactPolicy: { onFailure: true, onSuccess: false },
    classification: 'DETERMINISTIC',
    async run(context, check) {
      const result = await executeCommand({
        argv,
        cwd: context.cwd ?? ROOT,
        env: context.env ?? {},
        timeoutMs: check.timeoutMs,
        retryPolicy: check.retryPolicy,
      });
      return normalizeCheckResult({
        id,
        status: result.exitCode === 0 && !result.timedOut && result.signal === null ? 'PASS' : 'FAIL',
        attempts: result.attempts,
        durationMs: result.durationMs,
        classification: 'DETERMINISTIC',
        diagnostics: result.diagnostics,
      });
    },
  });
}

for (const [id, argv] of Object.entries(COMMANDS)) registerCommand(id, argv);

function sortedDescriptors(ids) {
  return [...new Set(ids)].sort().map((id) => Object.freeze({ id, kind: 'command' }));
}

function effectiveRisk(context, areas) {
  if (!Object.hasOwn(RISK_ORDER, context.risk)) throw new TypeError('FAST context requires a valid risk');
  let risk = context.risk;
  for (const name of areas) {
    const declared = getArea(name);
    if (!declared) throw new TypeError(`FAST context contains unknown area: ${name}`);
    if (RISK_ORDER[declared.risk] > RISK_ORDER[risk]) risk = declared.risk;
  }
  return risk;
}

export function resolveFastChecks(context = {}) {
  if (!context || typeof context !== 'object' || Array.isArray(context)) throw new TypeError('FAST context must be an object');
  if (context.profile !== QA_PROFILES.FAST) throw new TypeError('FAST resolver requires profile FAST');
  const areas = context.expandedAreas ?? context.areas ?? [];
  if (!Array.isArray(areas) || areas.some((name) => typeof name !== 'string' || !name)) {
    throw new TypeError('FAST context areas must be an array of names');
  }
  const normalizedAreas = [...new Set(areas)].sort();
  const risk = effectiveRisk(context, normalizedAreas);
  const skippedChecks = SKIPPED_EXPENSIVE_CHECKS.map((entry) => ({ ...entry }));
  if (risk === 'HIGH') {
    return Object.freeze({
      profile: QA_PROFILES.FAST,
      risk,
      areas: Object.freeze(normalizedAreas),
      blocked: true,
      requiredProfile: 'RELEASE',
      blockedReason: 'RELEASE_REQUIRED:qa:release',
      selectedChecks: Object.freeze([]),
      skippedChecks: Object.freeze(skippedChecks),
    });
  }

  const selectedIds = [...FOUNDATION_IDS];
  for (const name of normalizedAreas) selectedIds.push(...(AREA_CHECK_IDS[name] ?? []));
  return Object.freeze({
    profile: QA_PROFILES.FAST,
    risk,
    areas: Object.freeze(normalizedAreas),
    blocked: false,
    requiredProfile: null,
    blockedReason: null,
    selectedChecks: Object.freeze(sortedDescriptors(selectedIds)),
    skippedChecks: Object.freeze(skippedChecks),
  });
}
