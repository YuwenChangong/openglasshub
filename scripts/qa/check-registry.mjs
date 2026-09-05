import { QA_PROFILES } from './contracts.mjs';

const checks = new Map();
const KNOWN_PROFILES = new Set(Object.values(QA_PROFILES));
const KNOWN_CLASSIFICATIONS = new Set(['DETERMINISTIC', 'NETWORK', 'SAFETY', 'VALIDATION', 'TRANSIENT']);

export class CheckRegistryError extends TypeError {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = 'CheckRegistryError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new CheckRegistryError(code, message);
}

function requireString(value, name) {
  if (typeof value !== 'string' || !value.trim()) fail('INVALID_CHECK', `${name} must be a non-empty string`);
  return value.trim();
}

function validateRetryPolicy(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_CHECK', 'retryPolicy must be an object');
  if (!['LOCAL', 'NETWORK'].includes(value.classification)) fail('INVALID_CHECK', 'retryPolicy classification must be LOCAL or NETWORK');
  if (!Number.isInteger(value.maxRetries) || value.maxRetries < 0 || value.maxRetries > 1) {
    fail('INVALID_CHECK', 'retryPolicy maxRetries must be 0 or 1');
  }
  if (value.classification === 'LOCAL' && value.maxRetries !== 0) fail('INVALID_CHECK', 'local checks cannot retry');
  return Object.freeze({ classification: value.classification, maxRetries: value.maxRetries });
}

function validateCheck(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_CHECK', 'check must be an object');
  const id = requireString(input.id, 'id');
  if (!Array.isArray(input.allowedProfiles) || input.allowedProfiles.length === 0) {
    fail('INVALID_CHECK', 'allowedProfiles must be a non-empty array');
  }
  const allowedProfiles = [...new Set(input.allowedProfiles)];
  if (allowedProfiles.length !== input.allowedProfiles.length || allowedProfiles.some((profile) => !KNOWN_PROFILES.has(profile))) {
    fail('INVALID_CHECK', 'allowedProfiles contains an invalid or duplicate profile');
  }
  if (!Number.isInteger(input.timeoutMs) || input.timeoutMs <= 0) fail('INVALID_CHECK', 'timeoutMs must be a positive integer');
  const retryPolicy = validateRetryPolicy(input.retryPolicy);
  if (!input.artifactPolicy || typeof input.artifactPolicy !== 'object' || Array.isArray(input.artifactPolicy) ||
      typeof input.artifactPolicy.onFailure !== 'boolean' || typeof input.artifactPolicy.onSuccess !== 'boolean') {
    fail('INVALID_CHECK', 'artifactPolicy must declare boolean onFailure and onSuccess');
  }
  const classification = requireString(input.classification, 'classification');
  if (!KNOWN_CLASSIFICATIONS.has(classification)) fail('INVALID_CHECK', 'classification is invalid');
  if (typeof input.run !== 'function') fail('INVALID_CHECK', 'run must be a function');
  return Object.freeze({
    id,
    allowedProfiles: Object.freeze(allowedProfiles),
    timeoutMs: input.timeoutMs,
    retryPolicy,
    artifactPolicy: Object.freeze({ onFailure: input.artifactPolicy.onFailure, onSuccess: input.artifactPolicy.onSuccess }),
    classification,
    run: input.run,
  });
}

export function registerCheck(input) {
  const check = validateCheck(input);
  if (checks.has(check.id)) fail('DUPLICATE_CHECK', check.id);
  checks.set(check.id, check);
  return check;
}

export function getCheck(id) {
  const normalizedId = requireString(id, 'id');
  const check = checks.get(normalizedId);
  if (!check) fail('UNKNOWN_CHECK', normalizedId);
  return check;
}

export async function runCheck(id, context = {}) {
  const check = getCheck(id);
  if (!check.allowedProfiles.includes(context.profile)) {
    fail('PROFILE_NOT_ALLOWED', `${check.id} is not allowed for ${context.profile ?? 'unknown profile'}`);
  }
  return check.run(Object.freeze({ ...context }), check);
}
