const QA_PROFILES = Object.freeze({
  FAST: 'FAST',
  FEATURE: 'FEATURE',
  RELEASE: 'RELEASE',
  PROD: 'PRODUCTION_SMOKE',
});

const RISK_LEVELS = Object.freeze({ LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH' });
const PROFILE_VALUES = new Set(Object.values(QA_PROFILES));
const PROFILE_ALIASES = new Map([
  ['fast', QA_PROFILES.FAST],
  ['qa:fast', QA_PROFILES.FAST],
  ['feature', QA_PROFILES.FEATURE],
  ['qa:feature', QA_PROFILES.FEATURE],
  ['release', QA_PROFILES.RELEASE],
  ['qa:release', QA_PROFILES.RELEASE],
  ['prod', QA_PROFILES.PROD],
  ['production', QA_PROFILES.PROD],
  ['qa:prod', QA_PROFILES.PROD],
]);

export class QAInvocationValidationError extends TypeError {
  constructor(message) {
    super(message);
    this.name = 'QAInvocationValidationError';
    this.code = 'INVALID_INVOCATION';
  }
}

function fail(message) {
  throw new QAInvocationValidationError(`INVALID_INVOCATION: ${message}`);
}

function normalizeProfile(value) {
  if (typeof value !== 'string') fail('profile must be a string');
  const profile = PROFILE_ALIASES.get(value.trim().toLowerCase()) ??
    (PROFILE_VALUES.has(value.trim().toUpperCase()) ? value.trim().toUpperCase() : null);
  if (!profile) fail(`unknown profile: ${value}`);
  return profile;
}

function normalizeArea(value) {
  if (typeof value !== 'string' || !value.trim()) fail('area must be a non-empty string');
  const area = value.trim().toLowerCase().replace(/[_\s]+/g, '-');
  if (!/^[a-z][a-z0-9-]*$/.test(area)) fail(`invalid area: ${value}`);
  return area;
}

function stripProcessArgv(argv) {
  if (!Array.isArray(argv)) fail('argv must be an array');
  const args = [...argv];
  if (args.length >= 2 && typeof args[0] === 'string' &&
      /(?:^|[\\/])node(?:\.exe)?$/i.test(args[0]) &&
      typeof args[1] === 'string' && /runner\.mjs$/i.test(args[1])) {
    return args.slice(2);
  }
  return args;
}

export function parseInvocation(argv) {
  const args = stripProcessArgv(argv);
  if (args.length === 0) fail('profile is required');

  let profile;
  let area = null;
  let positional = [];
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--profile' || token === '--area') {
      if (seen.has(token)) fail(`duplicate flag: ${token}`);
      seen.add(token);
      const value = args[++index];
      if (value === undefined || String(value).startsWith('--')) fail(`missing value for ${token}`);
      if (token === '--profile') profile = normalizeProfile(value);
      else area = normalizeArea(value);
    } else if (typeof token === 'string' && token.startsWith('-')) {
      fail(`unknown flag: ${token}`);
    } else {
      positional.push(token);
    }
  }

  if (positional.length > 0) {
    if (profile) fail('profile cannot be combined with positional profile');
    profile = normalizeProfile(positional.shift());
  }
  if (positional.length > 0) {
    if (area) fail('area specified more than once');
    area = normalizeArea(positional.shift());
  }
  if (positional.length > 0) fail('too many positional arguments');
  if (!profile) fail('profile is required');
  if (area && profile !== QA_PROFILES.FEATURE) fail('area is only valid for FEATURE profile');
  return Object.freeze({ profile, area });
}

const CHECK_STATUSES = new Set(['PASS', 'FAIL', 'SKIP']);
const CLASSIFICATIONS = new Set(['DETERMINISTIC', 'TRANSIENT', 'TRANSIENT_RECOVERED', 'SAFETY', 'VALIDATION']);

function cloneDiagnostics(value) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('diagnostics must be an object');
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]]));
}

export function normalizeCheckResult(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('check result must be an object');
  if (typeof input.id !== 'string' || !input.id.trim()) throw new TypeError('id must be a non-empty string');
  if (!CHECK_STATUSES.has(input.status)) throw new TypeError('status must be PASS, FAIL, or SKIP');
  const attempts = input.attempts ?? 1;
  const durationMs = input.durationMs ?? 0;
  if (!Number.isInteger(attempts) || attempts < 1) throw new TypeError('attempts must be a positive integer');
  if (!Number.isFinite(durationMs) || durationMs < 0) throw new TypeError('durationMs must be a non-negative number');
  const classification = input.classification ?? 'DETERMINISTIC';
  if (typeof classification !== 'string' || !CLASSIFICATIONS.has(classification)) throw new TypeError('invalid classification');
  return {
    id: input.id,
    status: input.status,
    attempts,
    durationMs,
    classification,
    diagnostics: cloneDiagnostics(input.diagnostics),
  };
}

function optionalSha(value, field) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !/^[a-f0-9]{40}$/i.test(value)) throw new TypeError(`${field} must be a 40-character SHA or null`);
  return value.toLowerCase();
}

export function createRunContext(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('context input must be an object');
  const profile = input.profile === undefined ? QA_PROFILES.FAST : normalizeProfile(input.profile);
  const area = input.area == null ? null : normalizeArea(input.area);
  if (area && profile !== QA_PROFILES.FEATURE) throw new QAInvocationValidationError('INVALID_INVOCATION: area is only valid for FEATURE profile');
  const areas = Array.isArray(input.areas) ? [...new Set(input.areas.map(normalizeArea))].sort() : (area ? [area] : []);
  if (areas.length > 0 && profile !== QA_PROFILES.FEATURE) throw new QAInvocationValidationError('INVALID_INVOCATION: area is only valid for FEATURE profile');
  const risk = input.risk ?? RISK_LEVELS.LOW;
  if (!Object.values(RISK_LEVELS).includes(risk)) throw new TypeError('invalid risk');
  const changedPathsCount = input.changedPathsCount ?? 0;
  if (!Number.isInteger(changedPathsCount) || changedPathsCount < 0) throw new TypeError('changedPathsCount must be a non-negative integer');
  return Object.freeze({
    profile,
    area,
    areas: Object.freeze(areas),
    risk,
    commitSha: optionalSha(input.commitSha, 'commitSha'),
    baseSha: optionalSha(input.baseSha, 'baseSha'),
    changedPathsCount,
  });
}

export { QA_PROFILES, RISK_LEVELS };
