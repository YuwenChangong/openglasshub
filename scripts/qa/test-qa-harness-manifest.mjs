import assert from 'node:assert/strict';
import test from 'node:test';

import { expandDependencies, getArea, manifest, matchPath, validateManifest } from './manifest.mjs';

const REQUIRED_AREAS = [
  'frontend', 'devices', 'products', 'forum', 'news', 'search', 'auth',
  'media', 'admin', 'seo', 'cloudflare', 'supabase-config', 'database', 'security',
];

test('exports a frozen evidence-backed manifest with complete area declarations', () => {
  assert.equal(Object.isFrozen(manifest), true);
  assert.deepEqual(Object.keys(manifest.areas).sort(), [...REQUIRED_AREAS].sort());
  for (const name of REQUIRED_AREAS) {
    const area = getArea(name);
    assert.equal(area.name, name);
    assert.ok(Array.isArray(area.pathMatchers) && area.pathMatchers.length > 0);
    assert.match(area.risk, /^(LOW|MEDIUM|HIGH)$/);
    assert.ok(Array.isArray(area.relatedAreas));
    assert.ok(Array.isArray(area.checks) && area.checks.length > 0);
    assert.ok(area.checks.every((check) => typeof check.id === 'string' && typeof check.command === 'string'));
    assert.ok(Array.isArray(area.e2eProjectsOrTags));
    assert.equal(typeof area.releaseEscalation, 'object');
  }
  assert.equal(getArea('compare'), undefined);
  assert.equal(validateManifest(manifest), true);
});

test('manifest path matchers cover representative real repository paths', () => {
  const representatives = {
    frontend: 'src/components/CommunityCTA.astro',
    devices: 'src/pages/devices/[slug].astro',
    products: 'src/pages/products/[brand].astro',
    forum: 'src/pages/api/forum/posts.ts',
    news: 'src/pages/news/[slug].astro',
    search: 'src/pages/search/index.astro',
    auth: 'src/pages/auth/callback.astro',
    media: 'src/pages/api/media/post/[mediaId].ts',
    admin: 'src/pages/admin/devices/index.astro',
    seo: 'src/pages/sitemap.xml.ts',
    cloudflare: 'wrangler.toml',
    'supabase-config': 'supabase/seed_circles.sql',
    database: 'supabase/migrations/20260902042807_forward_reconcile_devices.sql',
    security: 'scripts/lib/security-headers-artifact.mjs',
  };
  for (const [name, path] of Object.entries(representatives)) {
    assert.equal(matchPath(path), name, `${path} should classify as ${name}`);
  }
});

test('expands dependencies to a deterministic sorted deduplicated closure', () => {
  assert.deepEqual(expandDependencies(['devices', 'forum', 'devices']), [
    'auth', 'devices', 'forum', 'media', 'products', 'search', 'security', 'seo',
  ]);
  assert.deepEqual(expandDependencies(['seo', 'frontend']), ['frontend', 'seo']);
});

test('rejects unknown dependencies, dependency cycles, invalid risks, and duplicate check IDs', () => {
  const cases = [
    ['unknown dependency', (copy) => { copy.areas.frontend.relatedAreas = ['missing']; }, /unknown area dependency.*missing/i],
    ['dependency cycle', (copy) => { copy.areas.frontend.relatedAreas = ['security']; copy.areas.security.relatedAreas = ['frontend']; }, /dependency cycle/i],
    ['invalid risk', (copy) => { copy.areas.frontend.risk = 'CRITICAL'; }, /invalid risk/i],
    ['duplicate check ID', (copy) => { copy.areas.security.checks.push({ ...copy.areas.frontend.checks[0] }); }, /duplicate check id/i],
    ['destructive production check', (copy) => { copy.areas.security.checks.push({ id: 'bad-production', command: 'node cleanup.mjs', environment: 'production', destructive: true }); }, /destructive.*production/i],
  ];
  for (const [label, mutate, expected] of cases) {
    const copy = structuredClone(manifest);
    mutate(copy);
    assert.throws(() => validateManifest(copy), expected, label);
  }
});

test('rejects unknown areas during dependency expansion', () => {
  assert.throws(() => expandDependencies(['missing']), /unknown area/i);
});
