import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const runnerUrl = new URL('./test-global-locale-v2-acceptance-local.mjs', import.meta.url);
const source = await readFile(runnerUrl, 'utf8');
const oldSource = execFileSync('git', ['show', '486224a3d3fde37ce2afc5b48c1821e04b6a6a24:scripts/test-global-locale-v2-acceptance-local.mjs'], { encoding: 'utf8', windowsHide: true });
function navigateOwner(text) {
  const ast = ts.createSourceFile('runner.mjs', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let owner;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'navigate') owner = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(owner, 'ACTUAL_NAVIGATE_OWNER_REQUIRED');
  return owner;
}
let oracle;
try { oracle = await import('./lib/locale-v2-initial-ssr-expectation.mjs'); } catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
}
const origin = 'https://127.0.0.1:55123';
const autoInputs = { countryAvailable: true, country: 'US', acceptLanguage: 'zh-CN' };
function navigation(text, { raw = 'en', dom = raw, headers = { 'accept-language': 'zh-CN' } } = {}) {
  const receipt = { browserContexts: [{ contextId: 'owned-fixture' }] };
  const request = { allHeaders: async () => headers, url: () => origin + '/settings/', method: () => 'GET' };
  const response = { text: async () => `<html lang="${raw}">`, request: () => request,
    headers: () => ({ 'cache-control': 'private, no-store' }), status: () => 200 };
  const page = { goto: async () => response, evaluate: async () => raw,
    locator: () => ({ getAttribute: async () => dom }) };
  const scope = vm.createContext({ boundary: '', receipt, origin, settled: async () => {}, check: assert.ok,
    initialSsrExpectation: oracle?.initialSsrExpectation, localLocaleCountry: { available: true, value: 'US' } });
  return { receipt, run: (locale = 'zh-CN', options) => vm.runInContext(`(${navigateOwner(text)})`, scope)(page, '/settings/', locale, options) };
}

if (process.argv.includes('--old-red')) {
  test('initial anonymous raw en must not be compared to browser zh-CN when trusted US wins', async () => {
    await navigation(oldSource).run('zh-CN', { initialAnonymous: true });
  });
} else {
  test('frozen old initial expectation reproduces the exact browser-locale mismatch', async () => {
    await assert.rejects(navigation(oldSource).run(), /SSR_HTML_LOCALE_\/settings\/_zh-CN/);
  });
  for (const [name, inputs, want, source] of [
    ['explicit zh-CN overrides US', { ...autoInputs, current: 'zh-CN' }, 'zh-CN', 'current'],
    ['saved zh-CN overrides US', { ...autoInputs, savedPreference: 'zh-CN' }, 'zh-CN', 'saved'],
    ['CN overrides English header', { countryAvailable: true, country: 'CN', acceptLanguage: 'en' }, 'zh-CN', 'country'],
    ['US overrides Chinese header', autoInputs, 'en', 'country'],
    ['another assigned country overrides Chinese header', { countryAvailable: true, country: 'NZ', acceptLanguage: 'zh-CN' }, 'en', 'country'],
    ['unknown country does not override Chinese header', { countryAvailable: true, country: 'XX', acceptLanguage: 'zh-CN' }, 'zh-CN', 'accept_language'],
    ['Chinese header wins without country', { countryAvailable: false, acceptLanguage: 'zh-CN' }, 'zh-CN', 'accept_language'],
    ['unsupported header falls back to English', { countryAvailable: false, acceptLanguage: 'fr' }, 'en', 'fallback'],
    ['current auto suppresses saved manual', { ...autoInputs, current: 'auto', savedPreference: 'zh-CN' }, 'en', 'country'],
    ['explicit English overrides CN and saved Chinese', { current: 'en', savedPreference: 'zh-CN', countryAvailable: true, country: 'CN' }, 'en', 'current'],
    ['weighted supported header wins without country', { countryAvailable: false, acceptLanguage: 'en;q=0.5,zh-CN;q=0.9' }, 'zh-CN', 'accept_language'],
    ['zero-weight and traditional Chinese do not select simplified Chinese', { countryAvailable: false, acceptLanguage: 'zh-CN;q=0,zh-Hant,fr' }, 'en', 'fallback'],
    ['malformed header falls back', { countryAvailable: false, acceptLanguage: 'zh-CN;q=oops' }, 'en', 'fallback'],
  ]) test(name, () => assert.deepEqual(oracle?.expectedInitialSsrLocale(inputs), { locale: want, source }));

  test('live country capture projects only matching local metadata, without mutation', async () => {
    const metadata = { country: 'US', unrelated: 'owned-private-sentinel' };
    const worker = { raw: { runtimes: [{ mf: { getCf: async () => metadata } }],
      proxy: { ready: { promise: Promise.resolve({ proxyWorker: { getCf: async () => metadata } }) } } } };
    assert.deepEqual(await oracle.captureLocalLocaleCountry(worker), { available: true, value: 'US', source: 'LOCAL_MINIFLARE_GETCF' });
    assert.equal(metadata.unrelated, 'owned-private-sentinel');
  });
  test('missing metadata API fails closed instead of silently assuming no country', async () => {
    await assert.rejects(oracle.captureLocalLocaleCountry({ raw: { runtimes: [] } }), /LOCAL_COUNTRY_INPUT_UNOBSERVABLE/);
  });
  for (const country of ['XX', 'ZZ', 'T1']) test(`unknown country metadata ${country} is not trusted`, async () => {
    const worker = { raw: { runtimes: [{ mf: { getCf: async () => ({ country }) } }],
      proxy: { ready: { promise: Promise.resolve({ proxyWorker: { getCf: async () => ({ country }) } }) } } } };
    const captured = await oracle.captureLocalLocaleCountry(worker);
    assert.equal(captured.available, false);
    const expected = await oracle.initialSsrExpectation({ allHeaders: async () => ({ 'accept-language': 'zh-CN' }) }, captured);
    assert.equal(expected.locale, 'zh-CN'); assert.equal(expected.source, 'accept_language');
  });
  test('inconsistent user/proxy country metadata fails closed', async () => {
    const worker = { raw: { runtimes: [{ mf: { getCf: async () => ({ country: 'US' }) } }],
      proxy: { ready: { promise: Promise.resolve({ proxyWorker: { getCf: async () => ({ country: 'CN' }) } }) } } } };
    await assert.rejects(oracle.captureLocalLocaleCountry(worker), /LOCAL_COUNTRY_INPUT_INCONSISTENT/);
  });
  test('actual request header and safe saved cookie, not browser locale, determine expectation', async () => {
    const cookie = encodeURIComponent(JSON.stringify({ version: 1, preference: 'zh-CN', generation: 1, provenance: 'device_explicit' }));
    const result = await oracle.initialSsrExpectation({ allHeaders: async () => ({ 'accept-language': 'en', cookie: `unrelated=owned-private-sentinel; ogh_preferences_v1=${cookie}`, authorization: 'owned-private-sentinel' }) }, { available: true, value: 'US' });
    assert.equal(result.locale, 'zh-CN'); assert.equal(result.source, 'saved');
    assert.equal(result.inputs.acceptLanguage, 'en'); assert.equal(result.inputs.savedPreference, 'zh-CN');
    assert.equal(JSON.stringify(result).includes('owned-private-sentinel'), false);
  });
  test('invalid locale cookie does not manufacture a manual preference', async () => {
    const result = await oracle.initialSsrExpectation({ allHeaders: async () => ({ 'accept-language': 'zh-CN', cookie: 'ogh_preferences_v1=invalid' }) }, { available: true, value: 'US' });
    assert.equal(result.locale, 'en'); assert.equal(result.source, 'country');
    assert.equal(result.inputs.savedPreference, undefined);
  });
  test('actual initial navigation consumes the independent oracle without redefining the matrix', async () => {
    const f = navigation(source);
    await f.run('zh-CN', { initialAnonymous: true });
    assert.equal(f.receipt.initialAnonymousSsr.locale, 'en');
    assert.equal(f.receipt.initialAnonymousSsr.source, 'country');
    assert.equal(f.receipt.routes[0].locale, 'en');
    const runner = await import(runnerUrl.href);
    assert.equal(runner.localeContexts[0].locale, 'zh-CN');
  });
  test('initial navigation still rejects raw SSR disagreement with the contract', async () => {
    await assert.rejects(navigation(source, { raw: 'zh-CN' }).run('zh-CN', { initialAnonymous: true }), /SSR_HTML_LOCALE_\/settings\/_en/);
  });
  test('initial navigation separately rejects hydrated DOM disagreement', async () => {
    await assert.rejects(navigation(source, { dom: 'zh-CN' }).run('zh-CN', { initialAnonymous: true }), /HTML_LOCALE_\/settings\/_en/);
  });
  test('later explicitly targeted Chinese navigation remains Chinese', async () => {
    const f = navigation(source, { raw: 'zh-CN' });
    await f.run('zh-CN');
    assert.equal(f.receipt.routes[0].locale, 'zh-CN');
    assert.equal(f.receipt.initialAnonymousSsr, undefined);
  });
  test('initial-only call site and browser locale semantics remain bound to the runner', () => {
    const ast = ts.createSourceFile('runner.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const calls = [];
    const visit = node => {
      if (ts.isCallExpression(node) && node.expression.getText(ast) === 'navigate' && node.arguments.length === 4) calls.push(node.getText(ast));
      ts.forEachChild(node, visit);
    };
    visit(ast);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /'\/settings\/',fixture\.locale,\{initialAnonymous:true\}/);
    assert.match(source, /newContext\(\{viewport:.*locale:fixture\.locale/);
    assert.match(source, /localLocaleCountry = await captureLocalLocaleCountry\(worker\)/);
  });
  test('expectation helper has no application resolver or other runtime imports', async () => {
    const helper = await readFile(new URL('./lib/locale-v2-initial-ssr-expectation.mjs', import.meta.url), 'utf8');
    const ast = ts.createSourceFile('oracle.mjs', helper, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const imports = ast.statements.filter(ts.isImportDeclaration).map(node => node.moduleSpecifier.text);
    assert.deepEqual(imports, ['node:assert/strict']);
    assert.ok(!helper.includes('resolveLocale'));
  });
}
