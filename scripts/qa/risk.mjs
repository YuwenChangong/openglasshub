import { execFileSync } from 'node:child_process';

import { expandDependencies, getArea, matchPath } from './manifest.mjs';

const RISK_ORDER = Object.freeze({ LOW: 0, MEDIUM: 1, HIGH: 2 });
const SOURCE_OR_CONFIG_PATH = /^(?:src\/|scripts\/|functions\/|\.github\/|(?:astro|vite|wrangler|tsconfig|package(?:-lock)?|pnpm-lock|yarn)\.|[^/]+\.(?:config\.(?:m?js|cjs|ts)|toml|ya?ml|json)$)/i;
const SECURITY_FALLBACK_PATH = /^(?:src\/(?:lib\/server|pages\/api)|scripts\/|functions\/|\.github\/|supabase\/|(?:astro|vite|wrangler|tsconfig|package(?:-lock)?|pnpm-lock|yarn)\.|[^/]+\.(?:config\.(?:m?js|cjs|ts)|toml|ya?ml|json)$)/i;
const RUNTIME_CONFIG_DIRECTORY = /(?:^|\/)(?:config|configs|configuration|infra|deploy|ops)(?:\/|$)/i;
const RUNTIME_CONFIG_FILE = /(?:^|\/)(?:\.[^/]*(?:env|vars)|public\/[^/]*(?:runtime|config|env|vars)|[^/]*(?:config|provider|wrangler|worker|cloudflare|supabase|env|vars|settings)[^/]*\.(?:json|toml|ya?ml|m?js|cjs|ts))$/i;

export class RiskClassificationError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = 'RiskClassificationError';
    this.code = code;
  }
}

function git(args, cwd) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    const detail = String(error.stderr ?? error.message ?? '').trim();
    throw new RiskClassificationError('GIT_COMMAND_FAILED', detail || `git ${args[0]} failed`);
  }
}

function gitBase(args, cwd) {
  try {
    return git(args, cwd);
  } catch (error) {
    throw new RiskClassificationError('BASE_UNRESOLVED', error.message);
  }
}

function normalizePath(value) {
  return String(value).trim().replaceAll('\\', '/').replace(/^\.\//, '');
}

function sortedUnique(values) {
  return [...new Set(values.map(normalizePath).filter(Boolean))].sort();
}

function assertSha(value, name) {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/i.test(value.trim())) {
    throw new TypeError(`${name} must be a 40-character SHA`);
  }
  return value.trim().toLowerCase();
}

export function resolveComparisonBase({ branch, mainRef, cwd = process.cwd() } = {}) {
  if (typeof branch !== 'string' || !branch.trim()) throw new TypeError('branch must be a non-empty string');
  if (typeof mainRef !== 'string' || !mainRef.trim()) throw new TypeError('mainRef must be a non-empty string');
  const resolvedMain = gitBase(['rev-parse', '--verify', `${mainRef}^{commit}`], cwd);
  const head = gitBase(['rev-parse', '--verify', 'HEAD^{commit}'], cwd);
  const mergeBase = gitBase(['merge-base', 'HEAD', mainRef], cwd);
  if (!/^[0-9a-f]{40}$/i.test(mergeBase)) {
    throw new RiskClassificationError('BASE_UNRESOLVED', 'git merge-base returned no commit');
  }

  if (branch.trim() === 'main') {
    if (head !== resolvedMain || mergeBase !== head) {
      throw new RiskClassificationError('BASE_UNRESOLVED', 'main diverges from its proven remote baseline');
    }
    const parent = gitBase(['rev-parse', '--verify', 'HEAD^'], cwd);
    if (!/^[0-9a-f]{40}$/i.test(parent)) {
      throw new RiskClassificationError('BASE_UNRESOLVED', 'main has no proven parent baseline');
    }
    return parent.toLowerCase();
  }
  return mergeBase.toLowerCase();
}

function pathLines(value) {
  return value ? value.split(/\r?\n/) : [];
}

export function collectChangedPaths({ baseSha, cwd = process.cwd() } = {}) {
  const base = assertSha(baseSha, 'baseSha');
  const committed = git(['diff', '--name-only', `${base}...HEAD`, '--'], cwd);
  const unstaged = git(['diff', '--name-only', '--'], cwd);
  const staged = git(['diff', '--cached', '--name-only', '--'], cwd);
  const untracked = git(['ls-files', '--others', '--exclude-standard'], cwd);
  return sortedUnique([
    ...pathLines(committed),
    ...pathLines(unstaged),
    ...pathLines(staged),
    ...pathLines(untracked),
  ]);
}

function fallbackArea(path) {
  if (RUNTIME_CONFIG_DIRECTORY.test(path) || RUNTIME_CONFIG_FILE.test(path)) return 'security';
  if (!SOURCE_OR_CONFIG_PATH.test(path)) return 'frontend';
  return SECURITY_FALLBACK_PATH.test(path) ? 'security' : 'frontend';
}

function classifyPath(path) {
  return matchPath(path) ?? fallbackArea(path);
}

function getMaximumRisk(areaNames) {
  return areaNames.reduce((maximum, name) => {
    const risk = getArea(name).risk;
    return RISK_ORDER[risk] > RISK_ORDER[maximum] ? risk : maximum;
  }, 'LOW');
}

export function classifyChanges({ paths, explicitArea = null } = {}) {
  if (!Array.isArray(paths)) throw new TypeError('paths must be an array');
  if (explicitArea !== null && (typeof explicitArea !== 'string' || !getArea(explicitArea))) {
    throw new TypeError('explicitArea must name a manifest area or be null');
  }
  const normalizedPaths = sortedUnique(paths);
  const directAreaSet = new Set(normalizedPaths.map(classifyPath));
  if (explicitArea) directAreaSet.add(explicitArea);
  const directAreas = [...directAreaSet].sort();
  const expandedAreas = expandDependencies(directAreas);
  const risk = getMaximumRisk(expandedAreas);
  const escalationReasons = expandedAreas
    .filter((name) => getArea(name).risk === 'HIGH')
    .map((name) => `HIGH_RISK_AREA:${name}`);
  if (risk === 'HIGH') escalationReasons.push('RELEASE_REQUIRED:qa:release');
  return Object.freeze({
    paths: Object.freeze(normalizedPaths),
    directAreas: Object.freeze(directAreas),
    expandedAreas: Object.freeze(expandedAreas),
    risk,
    releaseRequired: risk === 'HIGH',
    escalationReason: escalationReasons[0] ?? null,
    escalationReasons: Object.freeze(escalationReasons),
  });
}
