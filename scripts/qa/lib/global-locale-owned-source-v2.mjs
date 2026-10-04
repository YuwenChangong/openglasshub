import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { parse as parseAstro } from '@astrojs/compiler';
import { createProcessor } from '@mdx-js/mdx';

export const ownershipManifestPath = 'scripts/qa/contracts/global-locale-settings-v2-owned-source.json';
export const fingerprintAlgorithmVersion = 'locale-owned-content-sha256-v1';
const ownedCategories = new Set(['OWNED_CORE', 'OWNED_PRESENTATION', 'OWNED_ROUTE', 'OWNED_PERSISTENCE',
  'OWNED_ADMIN_LOCALE', 'OWNED_SEARCH_LOCALE', 'OWNED_FALLBACK']);
const excludedCategories = new Set(['NOT_OWNED_SUPPORT_ONLY', 'NOT_OWNED_UNRELATED']);
const requiredFiles = [
  'src/lib/i18n/locale.ts', 'src/lib/i18n/preference-cookie.ts', 'src/lib/i18n/preference-sync.ts',
  'src/lib/server/user-preferences.server.ts', 'src/components/settings/SettingsPage.tsx',
  'src/starlightRouteData.ts', 'src/components/admin/CatalogSpecificationEditor.tsx',
  'src/components/admin/CatalogMediaEditor.tsx', 'src/lib/catalog-presentation.ts',
  'src/components/admin/AdminDevicesDashboard.tsx', 'src/components/community/GlobalSearchBox.tsx',
  'src/components/site/SiteHeader.astro', 'src/lib/i18n/messages/catalog.ts', 'src/middleware.ts',
  'src/pages/devices/[slug].astro', 'src/pages/products/[brand].astro', 'src/pages/products/index.astro',
];

function fail(code, detail) { throw Object.assign(new Error(`${code}: ${detail}`), { code }); }
function exactKeys(value, keys, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')) fail(code, 'Unexpected schema fields');
}
function normalizedPath(value) {
  return typeof value === 'string' && value.length > 0 && !/[\\\x00-\x20:*?]/.test(value)
    && !path.posix.isAbsolute(value) && path.posix.normalize(value) === value
    && !value.split('/').some(segment => segment === '.' || segment === '..' || !segment)
    && !/(?:^|\/)(?:\.env(?:\.[^/]*)?|credentials(?:\.[^/]*)?|secrets(?:\.[^/]*)?|node_modules|dist|artifacts|generated)(?:\/|$)|\.generated\./i.test(value);
}
function sourcePath(value) {
  if (!normalizedPath(value)
    || !(/^(?:src\/.+\.(?:ts|tsx|astro|md|mdx|mjs|json)|supabase\/migrations\/[0-9]+_[a-z0-9_]+\.sql)$/.test(value)
      || ['astro.config.mjs', 'package.json', 'package-lock.json', 'public/_headers'].includes(value))) {
    fail('INVALID_SOURCE_PATH', String(value));
  }
  return value;
}
function sortedUnique(values, duplicateCode, unsortedCode) {
  if (!Array.isArray(values) || new Set(values).size !== values.length) fail(duplicateCode, 'Duplicate or invalid list');
  if (values.join('\0') !== [...values].sort().join('\0')) fail(unsortedCode, 'List is not code-unit sorted');
}
function reader(options) {
  return options.readFile ?? (relative => fs.readFileSync(path.join(options.root, relative)));
}
function nonempty(value) { return typeof value === 'string' && value.trim().length > 0; }

export function loadLocaleOwnership(root) {
  return JSON.parse(fs.readFileSync(path.join(root, ownershipManifestPath), 'utf8'));
}

export function validateLocaleOwnership(manifest, options) {
  exactKeys(manifest, ['schemaVersion', 'version', 'purpose', 'behaviorDomains', 'ownedFiles', 'fileReviews',
    'dependencyReviews', 'excludedFiles', 'dataInputs', 'discovery', 'fingerprint'], 'INVALID_MANIFEST_SCHEMA');
  if (manifest.schemaVersion !== 1 || manifest.version !== 2 || !nonempty(manifest.purpose)) fail('INVALID_MANIFEST_SCHEMA', 'Unsupported version');
  if (!Array.isArray(manifest.ownedFiles)) fail('INVALID_MANIFEST_SCHEMA', 'Owned file array required');
  manifest.ownedFiles.forEach(sourcePath);
  sortedUnique(manifest.ownedFiles, 'DUPLICATE_OWNED_PATH', 'UNSORTED_OWNED_PATHS');
  const owned = new Set(manifest.ownedFiles);
  for (const file of requiredFiles) if (!owned.has(file)) fail('REQUIRED_SOURCE_MISSING', file);
  if (!Array.isArray(manifest.behaviorDomains) || manifest.behaviorDomains.length !== 15
    || new Set(manifest.behaviorDomains.map(d => d.id)).size !== 15) fail('INVALID_MANIFEST_SCHEMA', 'Fifteen distinct behavior domains required');
  for (const [index, domain] of manifest.behaviorDomains.entries()) {
    exactKeys(domain, ['id', 'name', 'roots'], 'INVALID_MANIFEST_SCHEMA');
    if (domain.id !== index + 1 || !nonempty(domain.name) || !Array.isArray(domain.roots) || !domain.roots.length) fail('INVALID_MANIFEST_SCHEMA', 'Invalid domain');
    sortedUnique(domain.roots.map(r => r.path), 'INVALID_MANIFEST_SCHEMA', 'INVALID_MANIFEST_SCHEMA');
    for (const root of domain.roots) {
      exactKeys(root, ['path', 'whyRoot', 'localeBehaviorControlled'], 'INVALID_MANIFEST_SCHEMA');
      if (!owned.has(root.path) || !nonempty(root.whyRoot) || !nonempty(root.localeBehaviorControlled)) fail('REQUIRED_SOURCE_MISSING', String(root.path));
    }
  }
  if (!Array.isArray(manifest.fileReviews) || manifest.fileReviews.map(r => r.path).join('\0') !== manifest.ownedFiles.join('\0')) {
    fail('INVALID_SOURCE_REVIEWS', 'Every owned source requires exactly one ordered review');
  }
  for (const review of manifest.fileReviews) {
    exactKeys(review, ['path', 'category', 'domains', 'reason', 'conservative', 'introducedBy'], 'INVALID_SOURCE_REVIEWS');
    if (!ownedCategories.has(review.category) || !nonempty(review.reason) || !nonempty(review.introducedBy)
      || typeof review.conservative !== 'boolean' || !Array.isArray(review.domains) || !review.domains.length
      || new Set(review.domains).size !== review.domains.length
      || review.domains.some(id => !Number.isInteger(id) || id < 1 || id > 15)) fail('INVALID_SOURCE_REVIEWS', review.path);
  }
  if (!Array.isArray(manifest.dependencyReviews) || manifest.dependencyReviews.map(r => r.path).join('\0') !== manifest.ownedFiles.join('\0')) {
    fail('INVALID_DEPENDENCY_REVIEWS', 'Every owned file requires an explicit dependency review, including leaves');
  }
  if (!Array.isArray(manifest.excludedFiles)) fail('INVALID_DEPENDENCY_REVIEWS', 'Explicit exclusions required');
  sortedUnique(manifest.excludedFiles.map(r => r.path), 'INVALID_DEPENDENCY_REVIEWS', 'INVALID_DEPENDENCY_REVIEWS');
  const excluded = new Map();
  for (const review of manifest.excludedFiles) {
    exactKeys(review, ['path', 'category', 'reason'], 'INVALID_DEPENDENCY_REVIEWS');
    if (owned.has(review.path) || !excludedCategories.has(review.category) || !nonempty(review.reason)
      || !normalizedPath(review.path) || !/^src\/.+\.(?:ts|tsx|astro|mjs|json|css|md|mdx)$/.test(review.path)) {
      fail('INVALID_DEPENDENCY_REVIEWS', 'Invalid support boundary');
    }
    excluded.set(review.path, review);
  }
  for (const review of manifest.dependencyReviews) {
    exactKeys(review, ['path', 'imports'], 'INVALID_DEPENDENCY_REVIEWS');
    if (!Array.isArray(review.imports)) fail('INVALID_DEPENDENCY_REVIEWS', review.path);
    sortedUnique(review.imports.map(i => i.specifier), 'INVALID_DEPENDENCY_REVIEWS', 'INVALID_DEPENDENCY_REVIEWS');
    for (const edge of review.imports) {
      exactKeys(edge, ['specifier', 'target', 'classification', 'reason'], 'INVALID_DEPENDENCY_REVIEWS');
      if (!nonempty(edge.specifier) || !edge.specifier.startsWith('.') || !nonempty(edge.reason)) fail('INVALID_DEPENDENCY_REVIEWS', review.path);
      if (owned.has(edge.target) ? !ownedCategories.has(edge.classification)
        : !excluded.has(edge.target) || !excludedCategories.has(edge.classification)) {
        fail('INVALID_DEPENDENCY_CLASSIFICATION', `${review.path} -> ${edge.target}`);
      }
    }
  }
  if (!Array.isArray(manifest.dataInputs)) fail('INVALID_MANIFEST_SCHEMA', 'Explicit non-import inputs required');
  for (const input of manifest.dataInputs) {
    exactKeys(input, ['owner', 'kind', 'pattern', 'files', 'reason'], 'INVALID_MANIFEST_SCHEMA');
    if (!owned.has(input.owner) || !['glob', 'configuration', 'database'].includes(input.kind)
      || !nonempty(input.pattern) || !nonempty(input.reason) || !Array.isArray(input.files) || !input.files.length) fail('INVALID_MANIFEST_SCHEMA', 'Invalid data input');
    sortedUnique(input.files, 'INVALID_MANIFEST_SCHEMA', 'INVALID_MANIFEST_SCHEMA');
    for (const file of input.files) if (!owned.has(file)) fail('REQUIRED_SOURCE_MISSING', file);
  }
  exactKeys(manifest.discovery, ['sourceRoots', 'markerPattern', 'documentRoots', 'migrationRoot', 'migrationMarkerPattern', 'excludedMarkerExceptions'], 'INVALID_MANIFEST_SCHEMA');
  if (JSON.stringify(manifest.discovery.sourceRoots) !== JSON.stringify(['src'])
    || JSON.stringify(manifest.discovery.documentRoots) !== JSON.stringify(['src/content/docs', 'src/content/editorial-translations'])
    || manifest.discovery.migrationRoot !== 'supabase/migrations'
    || !nonempty(manifest.discovery.markerPattern) || !nonempty(manifest.discovery.migrationMarkerPattern)) fail('INVALID_MANIFEST_SCHEMA', 'Invalid discovery scope');
  if (!Array.isArray(manifest.discovery.excludedMarkerExceptions)) fail('INVALID_MANIFEST_SCHEMA', 'Explicit type-only marker exceptions required');
  sortedUnique(manifest.discovery.excludedMarkerExceptions.map(r => r.path), 'INVALID_MANIFEST_SCHEMA', 'INVALID_MANIFEST_SCHEMA');
  for (const exception of manifest.discovery.excludedMarkerExceptions) {
    exactKeys(exception, ['path', 'markers', 'reason'], 'INVALID_MANIFEST_SCHEMA');
    if (!excluded.has(exception.path) || !exception.path.endsWith('.d.ts') || !nonempty(exception.reason)) {
      fail('INVALID_MANIFEST_SCHEMA', 'Only ambient declarations can retain reviewed Locale markers outside ownership');
    }
    sortedUnique(exception.markers, 'INVALID_MANIFEST_SCHEMA', 'INVALID_MANIFEST_SCHEMA');
    if (!exception.markers.length || exception.markers.some(marker => !nonempty(marker))) fail('INVALID_MANIFEST_SCHEMA', 'Invalid marker exception');
  }
  exactKeys(manifest.fingerprint, ['algorithmVersion', 'contentHash', 'serialization', 'lineEndings', 'contractBound'], 'INVALID_MANIFEST_SCHEMA');
  if (manifest.fingerprint.algorithmVersion !== fingerprintAlgorithmVersion || manifest.fingerprint.contentHash !== 'SHA-256'
    || manifest.fingerprint.serialization !== 'UTF8_CANONICAL_JSON_SORTED_KEYS_AND_OWNED_PATHS'
    || manifest.fingerprint.lineEndings !== 'EXACT_BYTES_NO_NORMALIZATION' || manifest.fingerprint.contractBound !== true) {
    fail('INVALID_MANIFEST_SCHEMA', 'Unsupported fingerprint algorithm');
  }
  const read = reader(options);
  for (const file of manifest.ownedFiles) {
    try { read(file); } catch (error) {
      if (error.code === 'ENOENT') fail('OWNED_FILE_MISSING', file);
      throw error;
    }
  }
  return true;
}

function scriptDependencies(source, file) {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  if (ast.parseDiagnostics.length) fail('LOCALE_SOURCE_PARSE_FAILED', file);
  const imports = [], globs = [];
  function visit(node) {
    if (file === 'astro.config.mjs' && ts.isPropertyAssignment(node)) {
      const name = node.name.getText(ast).replace(/^['"]|['"]$/g, '');
      if (name === 'routeMiddleware') {
        if (!ts.isStringLiteral(node.initializer) || !node.initializer.text.startsWith('.')) fail('UNREVIEWED_DYNAMIC_DEPENDENCY', file);
        imports.push(node.initializer.text);
      }
      if (name === 'components') {
        if (!ts.isObjectLiteralExpression(node.initializer)) fail('UNREVIEWED_DYNAMIC_DEPENDENCY', file);
        for (const entry of node.initializer.properties) {
          if (!ts.isPropertyAssignment(entry) || !ts.isStringLiteral(entry.initializer)
            || !entry.initializer.text.startsWith('.')) fail('UNREVIEWED_DYNAMIC_DEPENDENCY', file);
          imports.push(entry.initializer.text);
        }
      }
    }
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
    if (ts.isCallExpression(node)) {
      const dynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const requireCall = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      const glob = node.expression.getText(ast) === 'import.meta.glob';
      if (dynamicImport || requireCall || glob) {
        const argument = node.arguments[0];
        if (!argument || !ts.isStringLiteral(argument)) fail('UNREVIEWED_DYNAMIC_DEPENDENCY', file);
        (glob ? globs : imports).push(argument.text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return { imports, globs };
}

export async function inspectLocaleDependencies(source, file) {
  const result = { imports: [], globs: [] };
  const add = script => {
    const parsed = scriptDependencies(script, file);
    result.imports.push(...parsed.imports.filter(s => s.startsWith('.')));
    result.globs.push(...parsed.globs);
  };
  if (file.endsWith('.astro')) {
    const { ast } = await parseAstro(source);
    function visit(node) {
      if (node.type === 'frontmatter') add(node.value);
      if (node.name === 'script') for (const child of node.children ?? []) if (child.value) add(child.value);
      for (const child of node.children ?? []) visit(child);
    }
    visit(ast);
  } else if (/\.mdx?$/.test(file)) {
    const ast = createProcessor({ format: file.endsWith('.mdx') ? 'mdx' : 'md' }).parse(source);
    function visit(node) {
      if (node.type === 'mdxjsEsm') add(node.value);
      for (const child of node.children ?? []) visit(child);
    }
    visit(ast);
  } else if (/\.(?:ts|tsx|mjs)$/.test(file)) add(source);
  return { imports: [...new Set(result.imports)].sort(), globs: [...new Set(result.globs)].sort() };
}

function resolveImport(owner, specifier, read) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(owner), specifier));
  if (base.startsWith('../') || path.posix.isAbsolute(base)) fail('UNREVIEWED_LOCALE_DEPENDENCY', owner);
  for (const target of [base, ...['.ts', '.tsx', '.mjs', '.astro', '.mdx', '.json', '/index.ts', '/index.tsx'].map(ext => base + ext)]) {
    try { read(target); return target; } catch (error) { if (!['ENOENT', 'EISDIR'].includes(error.code)) throw error; }
  }
  fail('LOCALE_DEPENDENCY_TARGET_MISSING', `${owner} -> ${specifier}`);
}

function inventory(root, directory) {
  const result = [];
  const visit = relative => {
    for (const item of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const file = `${relative}/${item.name}`;
      if (item.isSymbolicLink()) fail('UNREVIEWED_SOURCE_SYMLINK', file);
      if (item.isDirectory()) visit(file); else if (item.isFile()) result.push(file);
    }
  };
  visit(directory);
  return result.sort();
}

export async function validateLocaleDependencyClosure(manifest, options) {
  validateLocaleOwnership(manifest, options);
  const read = reader(options), owned = new Set(manifest.ownedFiles);
  const excluded = new Set(manifest.excludedFiles.map(r => r.path));
  for (const review of manifest.dependencyReviews) {
    const parsed = await inspectLocaleDependencies(read(review.path).toString('utf8'), review.path);
    const expected = new Map(review.imports.map(edge => [edge.specifier, edge.target]));
    for (const specifier of parsed.imports) {
      if (!expected.has(specifier)) fail('UNREVIEWED_LOCALE_DEPENDENCY', `${review.path} -> ${specifier}`);
      if (resolveImport(review.path, specifier, read) !== expected.get(specifier)) fail('LOCALE_DEPENDENCY_TARGET_CHANGED', review.path);
    }
    if (parsed.imports.length !== expected.size) fail('LOCALE_DEPENDENCY_REVIEW_STALE', review.path);
    const globs = manifest.dataInputs.filter(input => input.owner === review.path && input.kind === 'glob').map(input => input.pattern).sort();
    if (parsed.globs.join('\0') !== globs.join('\0')) fail('UNREVIEWED_DYNAMIC_DEPENDENCY', review.path);
  }
  const files = options.inventory ?? [
    ...inventory(options.root, 'src'), ...inventory(options.root, manifest.discovery.migrationRoot),
  ];
  const marker = new RegExp(manifest.discovery.markerPattern), migrationMarker = new RegExp(manifest.discovery.migrationMarkerPattern);
  const exceptions = new Map(manifest.discovery.excludedMarkerExceptions.map(r => [r.path, r.markers]));
  for (const file of excluded) {
    const matches = [...new Set(read(file).toString('utf8').match(new RegExp(marker.source, 'g')) ?? [])].sort();
    if (matches.join('\0') !== (exceptions.get(file) ?? []).join('\0')) fail('LOCALE_SUPPORT_BOUNDARY_CHANGED', file);
  }
  for (const file of files) {
    const code = /\.(?:ts|tsx|astro|mjs|mdx|md)$/.test(file) && file.startsWith('src/');
    const document = manifest.discovery.documentRoots.some(prefix => file.startsWith(`${prefix}/`)) && /\.mdx?$/.test(file);
    const htmlRoute = file.startsWith('src/pages/') && !file.startsWith('src/pages/api/') && file.endsWith('.astro');
    const migration = file.startsWith(`${manifest.discovery.migrationRoot}/`) && file.endsWith('.sql');
    if ((document || htmlRoute || code && marker.test(read(file).toString('utf8'))
      || migration && migrationMarker.test(read(file).toString('utf8'))) && !owned.has(file) && !excluded.has(file)) {
      fail('UNREVIEWED_LOCALE_ROOT', file);
    }
  }
  for (const input of manifest.dataInputs.filter(input => input.kind === 'glob')) {
    const resolvedPattern = path.posix.normalize(path.posix.join(path.posix.dirname(input.owner), input.pattern));
    const expression = new RegExp('^' + resolvedPattern.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$');
    const actual = files.filter(file => expression.test(file)).sort();
    if (actual.join('\0') !== input.files.join('\0')) fail('LOCALE_DATA_INPUT_SET_CHANGED', input.owner);
  }
  return true;
}

function stableJson(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableJson(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
const sha256 = value => createHash('sha256').update(value).digest('hex');

export async function fingerprintLocaleSource(manifest, options) {
  await validateLocaleDependencyClosure(manifest, options);
  const read = reader(options);
  const contractSha256 = sha256(Buffer.from(stableJson(manifest), 'utf8'));
  const fileHashes = manifest.ownedFiles.map(file => [file, sha256(read(file))]);
  const identity = { algorithmVersion: fingerprintAlgorithmVersion, ownershipVersion: manifest.version, contractSha256, fileHashes };
  return { ...identity, fingerprint: sha256(Buffer.from(stableJson(identity), 'utf8')) };
}
