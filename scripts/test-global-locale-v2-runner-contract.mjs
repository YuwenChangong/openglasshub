import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const file = new URL('./test-global-locale-v2-acceptance-local.mjs', import.meta.url);
const source = await readFile(file, 'utf8');
const ast = ts.createSourceFile('runner.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const guarded = ast.statements.some(node => ts.isFunctionDeclaration(node) && node.name?.text === 'runLocaleV2Acceptance');
let runner = null, importFailure;
if (guarded) {
  try { runner = await import(file.href); } catch (error) { importFailure = error; }
}

test('runner is an import-safe formal acceptance entry, not a diagnostic dispatcher', () => {
  assert.equal(ast.parseDiagnostics.length, 0);
  assert.equal(guarded, true, 'FORMAL_IMPORT_SAFE_RUNNER_REQUIRED');
  assert.equal(importFailure, undefined, 'RUNNER_IMPORT_REQUIRED');
  assert.equal(typeof runner?.runLocaleV2Acceptance, 'function');
  assert.ok(source.includes('pathToFileURL(process.argv[1]).href'));
  assert.ok(!/logoutMode|observeLogout\(|observeFinalLogout\(|accountBDiagnostic|--logout-/.test(source));
});

test('old native product-detail loading preserves the exact unresolved dependency RED', async () => {
  await assert.rejects(import(new URL('../src/lib/public-product-detail.ts', import.meta.url).href),
    error => error.code === 'ERR_MODULE_NOT_FOUND' && /public-device-data/.test(error.message));
});

test('test-only loader resolves the real application graph and binds its pure exports', async () => {
  const { loadLocaleV2AppLogic } = await import('./lib/locale-v2-app-logic.mjs');
  const { logic, inputs } = await loadLocaleV2AppLogic();
  assert.deepEqual(inputs, [
    'src/lib/catalog-presentation.ts', 'src/lib/i18n/accept-language.ts',
    'src/lib/i18n/country-codes.ts', 'src/lib/i18n/editorial-variants.ts',
    'src/lib/i18n/locale.ts', 'src/lib/public-device-data.ts', 'src/lib/public-product-detail.ts',
  ]);
  assert.equal(logic.resolveLocale({ trustedCountry: 'CN' }).locale, 'zh-CN');
  assert.equal(logic.selectEditorialVariant('guides/index', 'en').kind, 'reviewed');
  assert.equal(typeof logic.detailSpecColumns, 'string');
  assert.deepEqual(logic.catalogLabel('custom.spec', 'en', { labelEn: 'Owned label' }),
    { label: 'Owned label', missing: false });
  const groups = logic.buildDetailParameterGroups({ normalizedCatalog: true, specGroups: [] }, [{
    key: 'custom.spec', group_key: 'custom', admin_order: 0, state: 'KNOWN',
    value_type: 'number', value_number: 12, canonical_unit: 'g',
    presentation: { labelEn: 'Owned label', groupEn: 'Owned group' },
  }], 'en');
  assert.equal(groups[0].label, 'Owned group');
  assert.equal(groups[0].items[0].label, 'Owned label');
  assert.equal(groups[0].items[0].displayValue, '12 g');
  assert.equal(groups[0].items[0].value, '12');
});

test('fresh isolated import performs no network, child process, write or acceptance execution', () => {
  const probe = `
    import assert from 'node:assert/strict';
    import http from 'node:http'; import https from 'node:https';
    import net from 'node:net'; import tls from 'node:tls'; import dgram from 'node:dgram';
    import dns from 'node:dns'; import cp from 'node:child_process';
    import fs from 'node:fs'; import fsp from 'node:fs/promises';
    import { syncBuiltinESMExports } from 'node:module';
    let network = 0, subprocess = 0, writes = 0;
    const denyNetwork = () => { network++; throw Error('IMPORT_NETWORK_FORBIDDEN'); };
    const denyProcess = () => { subprocess++; throw Error('IMPORT_PROCESS_FORBIDDEN'); };
    const denyWrite = () => { writes++; throw Error('IMPORT_WRITE_FORBIDDEN'); };
    globalThis.fetch = denyNetwork; globalThis.WebSocket = denyNetwork;
    for (const module of [http, https]) for (const name of ['request', 'get']) module[name] = denyNetwork;
    net.connect = net.createConnection = tls.connect = dgram.createSocket = denyNetwork;
    net.Socket.prototype.connect = denyNetwork;
    net.Server.prototype.listen = denyNetwork;
    for (const name of ['lookup', 'resolve']) { dns[name] = denyNetwork; dns.promises[name] = denyNetwork; }
    for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) cp[name] = denyProcess;
    for (const name of ['writeFile', 'appendFile', 'mkdir', 'mkdtemp', 'rm', 'unlink', 'rename', 'copyFile']) {
      fs[name] = fs[name + 'Sync'] = fsp[name] = denyWrite;
    }
    fs.createWriteStream = denyWrite;
    syncBuiltinESMExports();
    // Initialize Node's lazy stdio handles before comparing import-time resources.
    void process.stdin; void process.stdout; void process.stderr;
    const before = JSON.stringify(process.env), handles = process._getActiveHandles().length;
    const runner = await import(${JSON.stringify(file.href)});
    assert.equal(typeof runner.runLocaleV2Acceptance, 'function');
    assert.equal(JSON.stringify(process.env), before);
    assert.equal(process._getActiveHandles().length, handles);
    assert.equal(network, 0); assert.equal(subprocess, 0); assert.equal(writes, 0);
    console.log('RUNNER_IMPORT_SIDE_EFFECT_FREE=true\\nRUNNER_EXTERNAL_REQUESTS_DURING_IMPORT=0');
  `;
  const allowed = ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOME', 'COMSPEC'];
  const env = Object.fromEntries(allowed.filter(key => process.env[key]).map(key => [key, process.env[key]]));
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), env, encoding: 'utf8', timeout: 20000, windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.equal(result.stdout.trim(), 'RUNNER_IMPORT_SIDE_EFFECT_FREE=true\nRUNNER_EXTERNAL_REQUESTS_DURING_IMPORT=0');
});
test('five distinct ordered contexts and fresh evidence identities are declared', () => {
  assert.deepEqual(runner?.localeContexts, [
    { engine: 'chromium', width: 1280, locale: 'zh-CN' },
    { engine: 'chromium', width: 1280, locale: 'en' },
    { engine: 'chromium', width: 390, locale: 'zh-CN' },
    { engine: 'chromium', width: 390, locale: 'en' },
    { engine: 'firefox', width: 1280, locale: 'en' },
  ]);
  assert.ok(source.includes('contextId: randomUUID()'));
  assert.ok(source.includes("origin: 'FRESH_THIS_RUN'"));
  assert.ok(source.includes("flag:'wx'"));
});
test('actual bindings retain V2 ownership and the shared logout owner', () => {
  const imports = ast.statements.filter(ts.isImportDeclaration).map(node => node.moduleSpecifier.text);
  assert.ok(imports.includes('./qa/lib/global-locale-owned-source-v2.mjs'));
  assert.ok(imports.includes('./lib/locale-v2-logout-observer.mjs'));
  assert.ok(imports.includes('./lib/locale-v2-logout-settlement.mjs'));
  assert.ok(source.includes('await acceptLocaleLogout('));
  assert.ok(source.includes('await logout(page,accounts.a)'));
  assert.ok(source.includes('await logout(page,accounts.b)'));
});
test('local transports and credentials remain isolated and bounded', () => {
  for (const invariant of ['preparePreferenceRunEnvironment(', 'assertLocalReplayTarget(',
    'remote: false', 'envFiles: []', 'buildOutboundFetchInit(req,', 'AbortSignal.timeout(10000)',
    "url.origin !== origin", "route.abort()", 'serviceWorkers:\'block\'', 'maxRetries']) {
    assert.ok(source.includes(invariant), invariant);
  }
  assert.ok(!/https:\/\/(?:[^\s'"`]*supabase|openglasshub|api\.cloudflare|api\.brevo)/i.test(source));
  assert.ok(!ast.statements.filter(ts.isImportDeclaration).some(node => node.moduleSpecifier.text.startsWith('../src/')));
  assert.ok(source.includes('const { buildDetailParameterGroups, detailSpecColumns, catalogLabel } = appLogic;'));
  assert.ok(source.includes('const { resolveLocale, selectEditorialVariant } = appLogic;'));
});

test('browser launch is behind terminal bootstrap and formal outbound dispatch uses normalized headers', async () => {
  assert.ok(source.indexOf('bootstrap.releaseBrowser();') < source.indexOf('await engine.launch('));
  assert.ok(source.includes("bootstrap.complete('LOCAL_SUPABASE_READY');"));
  assert.ok(source.includes("bootstrap.attempt('WORKER_HANDLE_RETURNED'"));
  assert.ok(source.includes("bootstrap.complete('DIRECT_APP_DISPATCH_READY');"));
  assert.ok(!source.includes('headers: req.headers'));
  const bridge = await readFile(new URL('./lib/locale-v2-outbound-bridge.mjs', import.meta.url), 'utf8');
  assert.ok(bridge.includes("redirect: 'error'"));
});
test('bound local safety helpers reject remote targets and inherited privileged credentials without dispatch', async () => {
  const { preparePreferenceRunEnvironment } = await import('./test-user-preferences-rls-local.mjs');
  const { assertLocalReplayTarget } = await import('./qa/local-disposable-supabase-replay.mjs');
  for (const target of ['https://example.invalid', 'postgresql://example.invalid/database', 'https://127.0.0.1.example.invalid']) {
    assert.throws(() => assertLocalReplayTarget(target), /Refusing non-local/);
  }
  assert.equal(assertLocalReplayTarget('http://127.0.0.1:54321'), true);
  assert.throws(() => preparePreferenceRunEnvironment({ P9_PRODUCTION_DATABASE_URL: 'postgresql://example.invalid/database' }));
  for (const name of ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_SECRET_KEY']) {
    assert.throws(() => preparePreferenceRunEnvironment({ [name]: 'owned-test-sentinel' }));
  }
  const env = preparePreferenceRunEnvironment({ NODE_OPTIONS: '--owned-test-option', EXTRA_TEST_VALUE: 'owned-test-sentinel' });
  assert.ok(!env.EXTRA_TEST_VALUE);
  assert.equal(env.NODE_OPTIONS, '');
  for (const name of ['P9_PRODUCTION_DATABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_URL']) {
    assert.ok(!Object.hasOwn(env, name));
  }
  assert.match(env.DOCKER_HOST, /^(?:npipe:\/\/\/\/\.\/pipe\/docker_engine|unix:\/\/\/var\/run\/docker.sock)$/);
});
test('frozen source count, contract, algorithm and fingerprint match exactly', async () => {
  assert.ok(runner?.readFrozenLocaleSource, 'FROZEN_SOURCE_READER_REQUIRED');
  const sourceIdentity = await runner.readFrozenLocaleSource();
  assert.equal(sourceIdentity.fileHashes.length, 218);
  assert.equal(sourceIdentity.ownershipVersion, 2);
  assert.equal(sourceIdentity.algorithmVersion, 'locale-owned-content-sha256-v1');
  assert.equal(sourceIdentity.contractSha256, 'a14c9cc458f6d898d4de07130faf92cd884475927841a89d6cb0c0cd0d15b4a1');
  assert.equal(sourceIdentity.fingerprint, 'eaf5dc60f0fdfbc8097077d5a6222262eb7727e299e23286a450b2c273a06b38');
});
