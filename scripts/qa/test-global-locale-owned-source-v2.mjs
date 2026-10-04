import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import test from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const manifestPath = 'scripts/qa/contracts/global-locale-settings-v2-owned-source.json';
const helperUrl = new URL('./lib/global-locale-owned-source-v2.mjs', import.meta.url);
const knownGaps = [
  'src/components/admin/CatalogSpecificationEditor.tsx',
  'src/components/admin/CatalogMediaEditor.tsx',
  'src/lib/catalog-presentation.ts',
];
const changedEight = [
  'src/components/admin/AdminDevicesDashboard.tsx',
  'src/components/community/GlobalSearchBox.tsx',
  'src/components/site/SiteHeader.astro',
  'src/lib/i18n/messages/catalog.ts',
  'src/middleware.ts',
  'src/pages/devices/[slug].astro',
  'src/pages/products/[brand].astro',
  'src/pages/products/index.astro',
];

async function contract() {
  assert.ok(fs.existsSync(path.join(root, manifestPath)), 'V2 ownership manifest is not implemented');
  assert.ok(fs.existsSync(helperUrl), 'V2 ownership validator is not implemented');
  const api = await import(helperUrl.href);
  return { api, manifest: api.loadLocaleOwnership(root) };
}

function fixtureRead(overrides = new Map()) {
  return relative => {
    if (overrides.has(relative)) {
      const value = overrides.get(relative);
      if (value === null) throw Object.assign(new Error('Fixture file missing'), { code: 'ENOENT' });
      return Buffer.from(value);
    }
    return fs.readFileSync(path.join(root, relative));
  };
}

test('current V2 manifest validates all current files and required roots without runtime execution', async () => {
  const { api, manifest } = await contract();
  assert.equal(api.validateLocaleOwnership(manifest, { root }), true);
  assert.equal(manifest.version, 2);
  assert.equal(manifest.behaviorDomains.length, 15);
  for (const file of [...knownGaps, ...changedEight]) assert.ok(manifest.ownedFiles.includes(file), file);
  for (const file of ['src/lib/i18n/locale.ts', 'src/lib/i18n/preference-cookie.ts',
    'src/lib/i18n/preference-sync.ts', 'src/lib/server/user-preferences.server.ts',
    'src/components/settings/SettingsPage.tsx', 'src/starlightRouteData.ts']) {
    assert.ok(manifest.behaviorDomains.some(domain => domain.roots.some(owner => owner.path === file)), file);
  }
});

test('current reviewed direct and transitive dependency graph closes', async () => {
  const { api, manifest } = await contract();
  assert.equal(await api.validateLocaleDependencyClosure(manifest, { root }), true);
});

for (const [name, mutate, code] of [
  ['duplicate paths', m => m.ownedFiles.splice(1, 0, m.ownedFiles[0]), 'DUPLICATE_OWNED_PATH'],
  ['unsorted paths', m => m.ownedFiles.reverse(), 'UNSORTED_OWNED_PATHS'],
  ['absolute paths', m => m.ownedFiles[0] = 'C:/private/source.ts', 'INVALID_SOURCE_PATH'],
  ['parent traversal', m => m.ownedFiles[0] = '../outside.ts', 'INVALID_SOURCE_PATH'],
  ['non-normalized paths', m => m.ownedFiles[0] = 'src/../src/middleware.ts', 'INVALID_SOURCE_PATH'],
  ['backslashes', m => m.ownedFiles[0] = 'src\\middleware.ts', 'INVALID_SOURCE_PATH'],
  ['generated artifacts', m => m.ownedFiles[0] = 'artifacts/qa/generated.json', 'INVALID_SOURCE_PATH'],
  ['generated source artifacts', m => m.ownedFiles[0] = 'src/generated/generated.json', 'INVALID_SOURCE_PATH'],
  ['generated source filename', m => m.ownedFiles[0] = 'src/lib/catalog.generated.ts', 'INVALID_SOURCE_PATH'],
  ['environment files', m => m.ownedFiles[0] = '.env.production', 'INVALID_SOURCE_PATH'],
  ['nested environment files', m => m.ownedFiles[0] = 'src/lib/.env.production.ts', 'INVALID_SOURCE_PATH'],
  ['credential filename', m => m.ownedFiles[0] = 'src/lib/credentials.json', 'INVALID_SOURCE_PATH'],
  ['provider configuration', m => m.ownedFiles[0] = 'wrangler.toml', 'INVALID_SOURCE_PATH'],
  ['credential value fields', m => m.secret = 'fixture-not-a-real-secret', 'INVALID_MANIFEST_SCHEMA'],
  ['unknown schema versions', m => m.schemaVersion = 100, 'INVALID_MANIFEST_SCHEMA'],
  ['missing known dependency', m => m.ownedFiles = m.ownedFiles.filter(p => p !== knownGaps[2]), 'REQUIRED_SOURCE_MISSING'],
  ['missing root module', m => m.ownedFiles = m.ownedFiles.filter(p => p !== 'src/lib/i18n/locale.ts'), 'REQUIRED_SOURCE_MISSING'],
  ['unclassified owned source', m => m.fileReviews.pop(), 'INVALID_SOURCE_REVIEWS'],
  ['unreviewed dependency owner', m => m.dependencyReviews.pop(), 'INVALID_DEPENDENCY_REVIEWS'],
]) {
  test(`validator rejects ${name}`, async () => {
    const { api, manifest } = await contract();
    const changed = structuredClone(manifest);
    mutate(changed);
    assert.throws(() => api.validateLocaleOwnership(changed, { root }), error => error.code === code);
  });
}

test('excluded support boundaries must also be safe normalized source paths', async () => {
  const { api, manifest } = await contract();
  for (const path of ['/outside.ts', 'src/../../outside.ts', 'src\\outside.ts', 'wrangler.toml']) {
    const changed = structuredClone(manifest);
    changed.excludedFiles[0].path = path;
    changed.excludedFiles.sort((a, b) => a.path < b.path ? -1 : 1);
    assert.throws(() => api.validateLocaleOwnership(changed, { root }),
      error => error.code === 'INVALID_DEPENDENCY_REVIEWS', path);
  }
});

test('missing owned source fails validation and fingerprinting, not an empty hash', async () => {
  const { api, manifest } = await contract();
  const options = { root, readFile: fixtureRead(new Map([['src/lib/catalog-presentation.ts', null]])) };
  assert.throws(() => api.validateLocaleOwnership(manifest, options), error => error.code === 'OWNED_FILE_MISSING');
  await assert.rejects(api.fingerprintLocaleSource(manifest, options), error => error.code === 'OWNED_FILE_MISSING');
});

for (const owned of ['src/lib/i18n/locale.ts', 'src/lib/catalog-presentation.ts']) {
  test(`fingerprint detects exact content change in ${owned}`, async () => {
    const { api, manifest } = await contract();
    const before = await api.fingerprintLocaleSource(manifest, { root });
    const source = fs.readFileSync(path.join(root, owned));
    const readFile = fixtureRead(new Map([[owned, Buffer.concat([source, Buffer.from('\n// Controlled fingerprint mutation.\n')])]]));
    const after = await api.fingerprintLocaleSource(manifest, { root, readFile });
    assert.notEqual(after.fingerprint, before.fingerprint);
    assert.notDeepEqual(after.fileHashes, before.fileHashes);
  });
}

test('unrelated source content does not affect owned fingerprint', async () => {
  const { api, manifest } = await contract();
  const unrelated = 'src/lib/moderation/sensitive-terms.server.ts';
  assert.ok(!manifest.ownedFiles.includes(unrelated));
  const before = await api.fingerprintLocaleSource(manifest, { root });
  const readFile = fixtureRead(new Map([[unrelated, 'export const unrelatedFixture = true;\n']]));
  const after = await api.fingerprintLocaleSource(manifest, { root, readFile });
  assert.equal(after.fingerprint, before.fingerprint);
});

test('contract review changes invalidate identity even when owned bytes are identical', async () => {
  const { api, manifest } = await contract();
  const before = await api.fingerprintLocaleSource(manifest, { root });
  const changed = structuredClone(manifest);
  changed.fileReviews[0].reason += ' Reviewed contract revision.';
  const after = await api.fingerprintLocaleSource(changed, { root });
  assert.notEqual(after.fingerprint, before.fingerprint);
  assert.deepEqual(after.fileHashes, before.fileHashes);
});

test('stable serialization does not depend on object key insertion order', async () => {
  const { api, manifest } = await contract();
  const reordered = Object.fromEntries(Object.entries(manifest).reverse());
  const before = await api.fingerprintLocaleSource(manifest, { root });
  const after = await api.fingerprintLocaleSource(reordered, { root });
  assert.equal(after.fingerprint, before.fingerprint);
  assert.equal(before.algorithmVersion, 'locale-owned-content-sha256-v1');
  assert.match(before.fingerprint, /^[a-f0-9]{64}$/);
});

test('fingerprint record binds independently computed exact-byte content digests', async () => {
  const { api, manifest } = await contract();
  const record = await api.fingerprintLocaleSource(manifest, { root });
  assert.deepEqual(record.fileHashes.map(([file]) => file), manifest.ownedFiles);
  for (const [file, digest] of record.fileHashes) {
    assert.equal(digest, createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'));
  }
  const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
    : value && typeof value === 'object'
      ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
      : JSON.stringify(value);
  assert.equal(record.contractSha256, createHash('sha256').update(canonical(manifest), 'utf8').digest('hex'));
  const { fingerprint, ...identity } = record;
  assert.equal(fingerprint, createHash('sha256').update(canonical(identity), 'utf8').digest('hex'));
});

for (const [owner, addition] of [
  ['src/components/admin/AdminDevicesDashboard.tsx', 'import NewLocaleEditor from "./NewLocaleEditor";\n'],
  ['src/components/admin/CatalogSpecificationEditor.tsx', 'import { translateSpec } from "../../lib/unreviewed-locale";\n'],
  ['src/lib/catalog-presentation.ts', 'export { translate } from "./unreviewed-locale";\n'],
  ['src/lib/catalog-presentation.ts', 'const pendingLocale = import("./unreviewed-locale");\n'],
]) {
  test(`closure rejects unreviewed dependency from ${owner}: ${addition.trim()}`, async () => {
    const { api, manifest } = await contract();
    const text = fs.readFileSync(path.join(root, owner), 'utf8');
    const readFile = fixtureRead(new Map([[owner, addition + text]]));
    await assert.rejects(api.validateLocaleDependencyClosure(manifest, { root, readFile }),
      error => error.code === 'UNREVIEWED_LOCALE_DEPENDENCY');
  });
}

test('Astro template script dependency cannot evade the closure review', async () => {
  const { api, manifest } = await contract();
  const owner = 'src/pages/products/[brand].astro';
  const source = fs.readFileSync(path.join(root, owner), 'utf8') + '\n<script>import "../../lib/unreviewed-locale";</script>\n';
  await assert.rejects(api.validateLocaleDependencyClosure(manifest, { root, readFile: fixtureRead(new Map([[owner, source]])) }),
    error => error.code === 'UNREVIEWED_LOCALE_DEPENDENCY');
});

test('reclassifying an owned transitive locale helper as support-only fails validation', async () => {
  const { api, manifest } = await contract();
  const changed = structuredClone(manifest);
  const edge = changed.dependencyReviews.find(r => r.path === knownGaps[0]).imports.find(i => i.target === knownGaps[2]);
  edge.classification = 'NOT_OWNED_SUPPORT_ONLY';
  assert.throws(() => api.validateLocaleOwnership(changed, { root }), error => error.code === 'INVALID_DEPENDENCY_CLASSIFICATION');
});

test('changing a reviewed import target cannot reuse the old edge classification', async () => {
  const { api, manifest } = await contract();
  const changed = structuredClone(manifest);
  const edge = changed.dependencyReviews.find(r => r.path === knownGaps[0]).imports.find(i => i.target === knownGaps[2]);
  edge.target = 'src/lib/i18n/locale.ts';
  await assert.rejects(api.validateLocaleDependencyClosure(changed, { root }), error => error.code === 'LOCALE_DEPENDENCY_TARGET_CHANGED');
});

test('nonliteral imports fail closed instead of claiming complete static analysis', async () => {
  const { api, manifest } = await contract();
  const owner = 'src/lib/catalog-presentation.ts';
  const source = fs.readFileSync(path.join(root, owner), 'utf8') + '\nconst injectedLocale = import(somePath);\n';
  await assert.rejects(api.validateLocaleDependencyClosure(manifest, { root, readFile: fixtureRead(new Map([[owner, source]])) }),
    error => error.code === 'UNREVIEWED_DYNAMIC_DEPENDENCY');
});

test('Starlight string-configured component paths require dependency review', async () => {
  const { api, manifest } = await contract();
  const owner = 'astro.config.mjs';
  const source = fs.readFileSync(path.join(root, owner), 'utf8')
    .replace("Header: './src/components/starlight/Header.astro'", "Header: './src/components/starlight/NewLocaleHeader.astro'");
  assert.ok(source.includes('NewLocaleHeader.astro'));
  await assert.rejects(api.validateLocaleDependencyClosure(manifest, { root, readFile: fixtureRead(new Map([[owner, source]])) }),
    error => error.code === 'UNREVIEWED_LOCALE_DEPENDENCY');
});

test('support boundary cannot acquire Locale behavior without a new review', async () => {
  const { api, manifest } = await contract();
  const owner = 'src/lib/circle-data.ts';
  const source = fs.readFileSync(path.join(root, owner), 'utf8') + '\nexport const localeAdded = useLocale();\n';
  await assert.rejects(api.validateLocaleDependencyClosure(manifest, { root, readFile: fixtureRead(new Map([[owner, source]])) }),
    error => error.code === 'LOCALE_SUPPORT_BOUNDARY_CHANGED');
});

for (const [file, source] of [
  ['src/components/admin/FutureLocaleEditor.tsx', 'export const labels = getUiMessages("en");\n'],
  ['src/content/docs/guides/future-original.mdx', '# Future original\n'],
  ['supabase/migrations/20990101000000_future_preferences.sql', 'alter table public.user_preferences add column future_flag boolean;\n'],
]) {
  test(`new Locale root cannot evade ownership discovery: ${file}`, async () => {
    const { api, manifest } = await contract();
    await assert.rejects(api.validateLocaleDependencyClosure(manifest, {
      root, readFile: fixtureRead(new Map([[file, source]])), inventory: [...manifest.ownedFiles, file],
    }), error => error.code === 'UNREVIEWED_LOCALE_ROOT');
  });
}

test('literal document glob expansion must match its reviewed set', async () => {
  const { api, manifest } = await contract();
  const file = 'src/content/docs/guides/future-original.mdx';
  const changed = structuredClone(manifest);
  changed.excludedFiles.push({ path: file, category: 'NOT_OWNED_SUPPORT_ONLY', reason: 'Controlled invalid boundary fixture.' });
  changed.excludedFiles.sort((a, b) => a.path < b.path ? -1 : 1);
  await assert.rejects(api.validateLocaleDependencyClosure(changed, {
    root, readFile: fixtureRead(new Map([[file, '# Fixture\n']])), inventory: [...manifest.ownedFiles, file],
  }), error => error.code === 'LOCALE_DATA_INPUT_SET_CHANGED');
});
