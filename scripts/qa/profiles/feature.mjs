import { getCheck, registerCheck, runCheck } from '../check-registry.mjs';
import { QA_PROFILES } from '../contracts.mjs';
import { expandDependencies, getArea, manifest } from '../manifest.mjs';
import './fast.mjs';

const RISK_ORDER = Object.freeze({ LOW: 0, MEDIUM: 1, HIGH: 2 });

const FOUNDATION_IDS = Object.freeze([
  'frontend-astro-build',
  'git-diff-check',
  'qa-harness-core',
  'qa-harness-executor',
  'qa-harness-manifest',
  'qa-harness-profiles',
  'qa-harness-receipt',
  'qa-harness-risk',
]);

const EXPENSIVE_SKIPS = Object.freeze([
  Object.freeze({ id: 'database-replay', reason: 'feature_profile_forbids_database_replay' }),
  Object.freeze({ id: 'deployment', reason: 'verification_only_no_deployment' }),
  Object.freeze({ id: 'full-browser-e2e', reason: 'targeted_browser_adapter_not_selected' }),
  Object.freeze({ id: 'production-smoke', reason: 'local_profile_no_production_network' }),
  Object.freeze({ id: 'provider-operations', reason: 'verification_only_no_provider_operations' }),
]);

const MANIFEST_CHECK_IDS = Object.freeze(Object.values(manifest.areas)
  .flatMap(({ checks }) => checks.map(({ id }) => id))
  .sort());

const FEATURE_EXECUTABLE_IDS = Object.freeze([...new Set([
  ...FOUNDATION_IDS,
  ...MANIFEST_CHECK_IDS,
])].filter((id) => {
  try {
    getCheck(id);
    return true;
  } catch {
    return false;
  }
}).sort());

for (const id of FEATURE_EXECUTABLE_IDS) {
  const source = getCheck(id);
  registerCheck({
    ...source,
    id: `feature:${id}`,
    allowedProfiles: [QA_PROFILES.FEATURE],
    async run(context) {
      const result = await source.run(context, source);
      return { ...result, id };
    },
  });
}

function sortedDescriptors(ids) {
  return [...new Set(ids)].sort().map((id) => Object.freeze({ id, kind: 'command' }));
}

function effectiveRisk(context, areas) {
  if (!Object.hasOwn(RISK_ORDER, context.risk)) throw new TypeError('FEATURE context requires a valid risk');
  let risk = context.risk;
  for (const name of areas) {
    const declared = getArea(name);
    if (!declared) throw new TypeError(`FEATURE context contains unknown area: ${name}`);
    if (RISK_ORDER[declared.risk] > RISK_ORDER[risk]) risk = declared.risk;
  }
  return risk;
}

export function resolveFeatureChecks(context = {}) {
  if (!context || typeof context !== 'object' || Array.isArray(context)) throw new TypeError('FEATURE context must be an object');
  if (context.profile !== QA_PROFILES.FEATURE) throw new TypeError('FEATURE resolver requires profile FEATURE');
  const areas = context.expandedAreas ?? context.areas ?? [];
  if (!Array.isArray(areas) || areas.some((name) => typeof name !== 'string' || !name)) {
    throw new TypeError('FEATURE context areas must be an array of names');
  }
  const normalizedAreas = expandDependencies(areas);
  if (normalizedAreas.length === 0) {
    const error = new TypeError('FEATURE_AREA_REQUIRED: pass an explicit area or change a recognized area');
    error.code = 'FEATURE_AREA_REQUIRED';
    throw error;
  }

  const risk = effectiveRisk(context, normalizedAreas);
  const selectedIds = risk === 'HIGH'
    ? []
    : [...FOUNDATION_IDS, ...normalizedAreas.flatMap((name) => getArea(name).checks.map(({ id }) => id))];
  const selectedSet = new Set(selectedIds);
  const skippedChecks = [
    ...MANIFEST_CHECK_IDS
      .filter((id) => !selectedSet.has(id))
      .map((id) => ({ id, reason: risk === 'HIGH' ? 'release_required' : 'area_not_selected' })),
    ...EXPENSIVE_SKIPS.map((entry) => ({ ...entry })),
  ].sort((left, right) => left.id.localeCompare(right.id));

  return Object.freeze({
    profile: QA_PROFILES.FEATURE,
    risk,
    areas: Object.freeze(normalizedAreas),
    blocked: risk === 'HIGH',
    requiredProfile: risk === 'HIGH' ? 'RELEASE' : null,
    blockedReason: risk === 'HIGH' ? 'RELEASE_REQUIRED:qa:release' : null,
    selectedChecks: Object.freeze(sortedDescriptors(selectedIds)),
    skippedChecks: Object.freeze(skippedChecks.map((entry) => Object.freeze(entry))),
  });
}

export async function runFeatureCheck(id, context = {}) {
  if (!FEATURE_EXECUTABLE_IDS.includes(id)) {
    const error = new TypeError(`FEATURE_CHECK_UNAVAILABLE: ${id}`);
    error.code = 'FEATURE_CHECK_UNAVAILABLE';
    throw error;
  }
  return runCheck(`feature:${id}`, context);
}
