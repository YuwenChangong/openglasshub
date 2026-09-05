const RISKS = new Set(['LOW', 'MEDIUM', 'HIGH']);
const AREA_NAMES = [
  'devices', 'products', 'forum', 'news', 'search', 'auth', 'media', 'admin',
  'seo', 'cloudflare', 'supabase-config', 'database', 'security', 'frontend',
];

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function area(name, pathMatchers, risk, relatedAreas, checks, e2eProjectsOrTags, releaseEscalation) {
  return {
    name,
    pathMatchers,
    risk,
    relatedAreas,
    checks,
    e2eProjectsOrTags,
    releaseEscalation,
  };
}

const check = (id, command) => ({ id, command });

const areas = {
  frontend: area('frontend', ['src/components/**', 'src/layouts/**', 'src/styles/**', 'src/plugins/**', 'src/pages/**'], 'LOW', [], [
    check('frontend-astro-build', 'npm run build'),
  ], ['frontend'], { requiredProfile: 'qa:release', rule: 'build must pass' }),
  devices: area('devices', ['src/pages/devices/**', 'src/content/docs/devices/**', 'src/data/devices.ts', 'src/lib/device-*.ts'], 'MEDIUM', ['products', 'seo', 'search'], [
    check('devices-library', 'npm run test:device-library'),
    check('devices-public-data', 'node scripts/test-public-device-data.mjs'),
  ], ['devices'], { requiredProfile: 'qa:release', rule: 'device rendering and data checks must pass' }),
  products: area('products', ['src/pages/products/**', 'src/components/products/**', 'src/data/product-public-data.json'], 'MEDIUM', [], [
    check('products-page', 'npm run test:products'),
  ], ['products'], { requiredProfile: 'qa:release', rule: 'product rendering check must pass' }),
  forum: area('forum', ['src/pages/forum/**', 'src/pages/circles/**', 'src/pages/posts/**', 'src/pages/api/forum/**', 'src/components/forum/**', 'src/lib/forum-*.ts'], 'MEDIUM', ['auth', 'media'], [
    check('forum-permissions', 'npm run test:forum-permissions'),
    check('forum-search', 'npm run test:search'),
  ], ['forum'], { requiredProfile: 'qa:release', rule: 'forum authorization checks must pass' }),
  news: area('news', ['src/pages/news/**', 'src/pages/api/news/**', 'src/components/news/**', 'src/lib/news*.ts'], 'MEDIUM', [], [
    check('news-api-safety', 'node scripts/test-public-news-api-safety.mjs'),
  ], ['news'], { requiredProfile: 'qa:release', rule: 'news API safety must pass' }),
  search: area('search', ['src/pages/search/**', 'src/components/**/GlobalSearchBox.tsx', 'src/lib/*search*.ts'], 'MEDIUM', [], [
    check('search', 'npm run test:search'),
  ], ['search'], { requiredProfile: 'qa:release', rule: 'search check must pass' }),
  auth: area('auth', ['src/pages/auth/**', 'src/pages/login/**', 'src/pages/register/**', 'src/components/auth/**', 'src/lib/auth-*.ts'], 'HIGH', ['security'], [
    check('auth-redirect-safety', 'npm run test:auth-redirect-safety'),
    check('auth-legal-consent', 'npm run test:auth-legal-consent'),
  ], ['auth'], { requiredProfile: 'qa:release', rule: 'authentication changes require release gates' }),
  media: area('media', ['src/pages/api/media/**', 'src/pages/api/forum/*media*.ts', 'src/components/**/PostMedia*.tsx', 'src/lib/*media*.ts'], 'MEDIUM', [], [
    check('media-url-privacy', 'npm run test:media-url-privacy'),
  ], ['media'], { requiredProfile: 'qa:release', rule: 'media authorization checks must pass' }),
  admin: area('admin', ['src/pages/admin/**', 'src/pages/api/admin/**', 'src/components/admin/**', 'src/lib/admin-*.ts'], 'HIGH', ['auth', 'security'], [
    check('admin-device-api', 'node scripts/test-device-admin-api.mjs'),
    check('admin-profile-role-security', 'npm run test:profile-role-security'),
  ], ['admin'], { requiredProfile: 'qa:release', rule: 'admin authorization requires release gates' }),
  seo: area('seo', ['src/pages/sitemap.xml.ts', 'src/content/docs/**', 'scripts/verify-seo.cjs'], 'LOW', [], [
    check('seo', 'node scripts/verify-seo.cjs'),
  ], ['seo'], { requiredProfile: 'qa:release', rule: 'SEO verification must pass' }),
  cloudflare: area('cloudflare', ['wrangler.toml', 'astro.config.mjs', 'functions/**', 'scripts/build-workers.mjs'], 'HIGH', ['security'], [
    check('workers-config', 'npm run test:workers-config'),
    check('workers-artifact', 'npm run test:workers-artifact'),
  ], ['cloudflare'], { requiredProfile: 'qa:release', rule: 'Workers configuration and artifact gates are required' }),
  'supabase-config': area('supabase-config', ['supabase/seed_*.sql', 'supabase/tests/**'], 'HIGH', ['database', 'security'], [
    check('supabase-config', 'npm run test:workers-env-contract'),
  ], ['supabase'], { requiredProfile: 'qa:release', rule: 'provider configuration is release-gated' }),
  database: area('database', ['supabase/migrations/**', 'supabase/*.sql'], 'HIGH', ['security'], [
    check('database-migration-versions', 'node scripts/qa/validate-supabase-migration-versions.mjs'),
  ], ['database'], { requiredProfile: 'qa:release', rule: 'database changes require release review' }),
  security: area('security', ['src/lib/server/**', 'scripts/lib/security-*.mjs', 'scripts/test-security-*.mjs', 'supabase/migrations/*security*.sql'], 'HIGH', [], [
    check('security-headers', 'node scripts/test-security-headers.mjs'),
    check('security-privilege-convergence', 'npm run test:security-privilege-convergence'),
  ], ['security'], { requiredProfile: 'qa:release', rule: 'security changes fail closed to release' }),
};

export const manifest = deepFreeze({ version: 'openglass-qa/manifest-v1', areas });

export class ManifestValidationError extends TypeError {
  constructor(message) {
    super(`INVALID_MANIFEST: ${message}`);
    this.name = 'ManifestValidationError';
    this.code = 'INVALID_MANIFEST';
  }
}

function fail(message) {
  throw new ManifestValidationError(message);
}

function getAreas(input) {
  if (!input || typeof input !== 'object' || !input.areas || typeof input.areas !== 'object') {
    fail('areas must be an object');
  }
  return input.areas;
}

export function validateManifest(input) {
  const entries = getAreas(input);
  const names = Object.keys(entries).sort();
  for (const name of names) {
    const item = entries[name];
    if (!item || item.name !== name) fail(`area name mismatch: ${name}`);
    if (!RISKS.has(item.risk)) fail(`invalid risk for ${name}: ${item.risk}`);
    if (!Array.isArray(item.pathMatchers) || item.pathMatchers.length === 0) fail(`pathMatchers required for ${name}`);
    if (!Array.isArray(item.relatedAreas)) fail(`relatedAreas required for ${name}`);
    if (!Array.isArray(item.checks) || item.checks.length === 0) fail(`checks required for ${name}`);
    if (!Array.isArray(item.e2eProjectsOrTags)) fail(`e2eProjectsOrTags required for ${name}`);
    if (!item.releaseEscalation || typeof item.releaseEscalation !== 'object') fail(`releaseEscalation required for ${name}`);
    for (const dependency of item.relatedAreas) {
      if (!Object.hasOwn(entries, dependency)) fail(`unknown area dependency: ${dependency}`);
    }
  }

  const checkIds = new Set();
  for (const name of names) {
    for (const item of entries[name].checks) {
      if (!item || typeof item.id !== 'string' || !item.id.trim() || typeof item.command !== 'string' || !item.command.trim()) {
        fail(`invalid check declaration in ${name}`);
      }
      if (checkIds.has(item.id)) fail(`duplicate check ID: ${item.id}`);
      checkIds.add(item.id);
      const production = item.environment === 'production' || item.target === 'production' || item.profile === 'PRODUCTION_SMOKE';
      if (production && item.destructive === true) fail(`destructive production check: ${item.id}`);
    }
  }

  const visiting = new Set();
  const visited = new Set();
  function visit(name, trail = []) {
    if (visiting.has(name)) fail(`dependency cycle: ${[...trail, name].join(' -> ')}`);
    if (visited.has(name)) return;
    visiting.add(name);
    for (const dependency of entries[name].relatedAreas) visit(dependency, [...trail, name]);
    visiting.delete(name);
    visited.add(name);
  }
  for (const name of names) visit(name);
  return true;
}

validateManifest(manifest);

export function getArea(name) {
  return manifest.areas[name];
}

export function expandDependencies(areaNames) {
  if (!Array.isArray(areaNames)) throw new TypeError('area names must be an array');
  const result = new Set();
  const visit = (name) => {
    if (!Object.hasOwn(manifest.areas, name)) fail(`unknown area: ${name}`);
    if (result.has(name)) return;
    result.add(name);
    for (const dependency of manifest.areas[name].relatedAreas) visit(dependency);
  };
  for (const name of areaNames) visit(name);
  return [...result].sort();
}

function globToRegExp(glob) {
  let pattern = '';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === '*' && glob[index + 1] === '*') { pattern += '.*'; index += 1; }
    else if (char === '*') pattern += '[^/]*';
    else pattern += char.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${pattern}$`);
}

export function matchPath(inputPath) {
  const normalized = String(inputPath).replaceAll('\\', '/');
  for (const name of AREA_NAMES) {
    if (manifest.areas[name].pathMatchers.some((matcher) => globToRegExp(matcher).test(normalized))) return name;
  }
  return undefined;
}
