import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { registerCheck, runCheck } from '../check-registry.mjs';
import { normalizeCheckResult, QA_PROFILES } from '../contracts.mjs';
import { executeCommand } from '../process-executor.mjs';
import { unstable_readConfig } from 'wrangler';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const NODE = process.execPath;
const NPM = process.platform === 'win32'
  ? Object.freeze([NODE, join(dirname(NODE), 'node_modules', 'npm', 'bin', 'npm-cli.js')])
  : Object.freeze(['npm']);
const productionConfig = unstable_readConfig(
  { config: join(ROOT, 'wrangler.toml'), env: 'production' },
  { hideWarnings: true },
);
const productionSiteOrigin = (() => {
  const value = productionConfig.vars?.SITE_ORIGIN;
  if (typeof value !== 'string' || !value.trim()) return null;
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) throw new TypeError('RELEASE SITE_ORIGIN must be a credential-free origin');
  return url.origin;
})();

const COMMANDS = Object.freeze({
  'admin-device-api': Object.freeze([NODE, 'scripts/test-device-admin-api.mjs']),
  'admin-profile-role-security': Object.freeze([NODE, 'scripts/audit-profile-role-security.mjs', '--strict', '--verbose']),
  'auth-legal-consent': Object.freeze([NODE, 'scripts/test-auth-legal-acknowledgement.mjs']),
  'auth-redirect-safety': Object.freeze([NODE, '--experimental-strip-types', 'scripts/test-auth-redirect-safety.mjs']),
  'database-migration-versions': Object.freeze([NODE, 'scripts/qa/validate-supabase-migration-versions.mjs']),
  'devices-library': Object.freeze([NODE, 'scripts/test-device-library.mjs']),
  'devices-public-data': Object.freeze([NODE, 'scripts/test-public-device-data.mjs']),
  'forum-permissions': Object.freeze([NODE, 'scripts/verify-forum-permissions.cjs']),
  'forum-search': Object.freeze([NODE, '--experimental-strip-types', 'scripts/test-search.mjs']),
  'frontend-astro-build': Object.freeze([NODE, 'scripts/build-workers.mjs']),
  'git-diff-check': Object.freeze(['git', 'diff', '--check']),
  'media-url-privacy': Object.freeze([NODE, 'scripts/audit-media-url-privacy.mjs', '--strict', '--verbose']),
  'news-api-safety': Object.freeze([NODE, 'scripts/test-public-news-api-safety.mjs']),
  'products-page': Object.freeze([NODE, 'scripts/test-product-page.mjs']),
  'project-test': Object.freeze([...NPM, 'test']),
  'qa-harness-core': Object.freeze([NODE, '--test', 'scripts/qa/test-qa-harness-core.mjs']),
  'qa-harness-executor': Object.freeze([NODE, '--test', 'scripts/qa/test-qa-harness-executor.mjs']),
  'qa-harness-manifest': Object.freeze([NODE, '--test', 'scripts/qa/test-qa-harness-manifest.mjs']),
  'qa-harness-profiles': Object.freeze([NODE, '--test', 'scripts/qa/test-qa-harness-profiles.mjs']),
  'qa-harness-receipt': Object.freeze([NODE, '--test', 'scripts/qa/test-qa-harness-receipt.mjs']),
  'qa-harness-risk': Object.freeze([NODE, '--test', 'scripts/qa/test-qa-harness-risk.mjs']),
  search: Object.freeze([NODE, '--experimental-strip-types', 'scripts/test-search.mjs']),
  'security-headers': Object.freeze([NODE, 'scripts/test-security-headers.mjs']),
  'security-privilege-convergence': Object.freeze([NODE, '--test', 'scripts/qa/test-security-privilege-convergence.mjs']),
  seo: Object.freeze([NODE, 'scripts/verify-seo.cjs']),
  'supabase-config': Object.freeze([NODE, 'scripts/qa/test-workers-environment-contract.mjs']),
  'targeted-browser-contracts': Object.freeze([
    NODE,
    '--test',
    '--test-name-pattern=targeted browser|targeted Chromium|targeted group',
    'scripts/qa/test-qa-harness-profiles.mjs',
  ]),
  'user-profile-api-safety': Object.freeze([NODE, 'scripts/test-user-profile-api-safety.mjs']),
  'user-summary-api-safety': Object.freeze([NODE, 'scripts/test-user-summary-api-safety.mjs']),
  'workers-artifact': Object.freeze([NODE, 'scripts/qa/test-workers-generated-artifact.mjs']),
  'workers-config': Object.freeze([NODE, 'scripts/qa/test-workers-native-config.mjs']),
  'workers-release-guard': Object.freeze([NODE, 'scripts/qa/test-workers-builds-release-guard.mjs']),
});

const SELECTED_IDS = Object.freeze(Object.keys(COMMANDS).sort());
const FORBIDDEN_CHECKS = Object.freeze([
  Object.freeze({ id: 'database-replay', reason: 'release_verification_forbids_database_replay' }),
  Object.freeze({ id: 'deployment', reason: 'release_verification_forbids_deployment' }),
  Object.freeze({ id: 'production-smoke', reason: 'release_profile_has_no_production_network' }),
  Object.freeze({ id: 'provider-operations', reason: 'release_verification_forbids_provider_operations' }),
]);

function registerReleaseCommand(id, argv) {
  registerCheck({
    id: `release:${id}`,
    allowedProfiles: [QA_PROFILES.RELEASE],
    timeoutMs: id === 'frontend-astro-build' ? 240_000 : id === 'project-test' ? 180_000 : 90_000,
    retryPolicy: { classification: 'LOCAL', maxRetries: 0 },
    artifactPolicy: { onFailure: true, onSuccess: false },
    classification: 'DETERMINISTIC',
    async run(context, check) {
      const commandEnvironment = id === 'seo' && productionSiteOrigin
        ? { ...(context.env ?? {}), SITE_ORIGIN: productionSiteOrigin }
        : context.env ?? {};
      const result = await executeCommand({
        argv,
        cwd: context.cwd ?? ROOT,
        env: commandEnvironment,
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

for (const [id, argv] of Object.entries(COMMANDS)) registerReleaseCommand(id, argv);

export function resolveReleaseChecks(context = {}) {
  if (!context || typeof context !== 'object' || Array.isArray(context)) throw new TypeError('RELEASE context must be an object');
  if (context.profile !== QA_PROFILES.RELEASE) throw new TypeError('RELEASE resolver requires profile RELEASE');
  if (!['LOW', 'MEDIUM', 'HIGH'].includes(context.risk)) throw new TypeError('RELEASE context requires a valid risk');
  const areas = context.expandedAreas ?? [];
  if (!Array.isArray(areas) || areas.some((name) => typeof name !== 'string' || !name)) {
    throw new TypeError('RELEASE context areas must be an array of names');
  }

  const databaseRequired = areas.includes('database');
  const selectedIds = databaseRequired
    ? SELECTED_IDS
    : SELECTED_IDS.filter((id) => id !== 'database-migration-versions');
  const skippedChecks = databaseRequired
    ? FORBIDDEN_CHECKS
    : [...FORBIDDEN_CHECKS, Object.freeze({ id: 'database-migration-versions', reason: 'database_area_not_changed' })]
      .sort((left, right) => left.id.localeCompare(right.id));
  return Object.freeze({
    profile: QA_PROFILES.RELEASE,
    risk: context.risk,
    areas: Object.freeze([...new Set(areas)].sort()),
    blocked: false,
    requiredProfile: null,
    blockedReason: null,
    selectedChecks: Object.freeze(selectedIds.map((id) => Object.freeze({ id, kind: 'command' }))),
    skippedChecks: Object.freeze(skippedChecks.map((entry) => Object.freeze({ ...entry }))),
  });
}

export async function runReleaseCheck(id, context = {}) {
  if (!SELECTED_IDS.includes(id)) {
    const error = new TypeError(`RELEASE_CHECK_UNAVAILABLE: ${id}`);
    error.code = 'RELEASE_CHECK_UNAVAILABLE';
    throw error;
  }
  return runCheck(`release:${id}`, context);
}
