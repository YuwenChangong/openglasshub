import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createDocumentEvidence } from './lib/locale-v2-document-evidence.mjs';

const base = '32711c30ae3e475ed01a142d883fecb226abd656';
const old = execFileSync('git', ['show', `${base}:scripts/test-global-locale-v2-acceptance-local.mjs`], { encoding: 'utf8' });
if (process.argv.includes('--old-red')) {
  test('architectural RED: frozen front door must not send application requests to worker.url ProxyWorker', () => {
    assert.ok(!old.includes("upstream = (await worker.url).origin"), 'OLD_WRANGLER_PROXY_HOP_PRESENT');
  });
} else {
  const { createDirectAppDispatch, forwardDirectAppRequest } = await import('./lib/locale-v2-direct-app-transport.mjs');
  const origin = 'https://127.0.0.1:19876';
  test('old Proxy hop is frozen source evidence, not a claim about random connection loss', () => {
    assert.ok(old.includes('upstream = (await worker.url).origin'));
    assert.ok(old.includes('provider ? httpRequest : httpsRequest'));
  });
  test('direct handle belongs to application runtime, uses its cf, and never calls Wrangler fetch', async () => {
    const calls = [], proxy = {};
    const local = { getCf: async () => ({ country: 'US' }), getWorker: async name => {
      assert.equal(name, 'owned-app'); return { fetch: async (url, init) => { calls.push({ url, init }); return new Response('owned app'); } };
    } };
    const worker = { config: { name: 'owned-app', dev: { remote: false } }, fetch: () => { throw Error('WRANGLER_FETCH_FORBIDDEN'); },
      raw: { runtimes: [{ mf: local }], proxy: { ready: { promise: Promise.resolve({ proxyWorker: proxy }) } } } };
    const direct = await createDirectAppDispatch(worker);
    assert.equal(await (await direct.fetch(origin + '/settings/')).text(), 'owned app');
    assert.equal(calls[0].init.cf.country, 'US');
    assert.deepEqual(direct.metadata, { proxyBypassed: true, country: 'US', owner: 'APPLICATION_RUNTIME_MINIFLARE_SERVICE_BINDING' });
    await assert.rejects(createDirectAppDispatch({ ...worker, config: { ...worker.config, dev: { remote: true } } }));
    local.getCf = async () => ({ country: 'CN' }); await assert.rejects(createDirectAppDispatch(worker), /DIRECT_APP_COUNTRY_REQUIRED/);
  });

  function fixture(response) {
    const receipt = {}, evidence = createDocumentEvidence({ origin, receipt, projectRoot: process.cwd() });
    const incoming = new PassThrough(), outgoing = new PassThrough();
    incoming.url = '/settings/?mode=owned'; incoming.method = 'PATCH';
    incoming.headers = { host: '127.0.0.1:19876', 'accept-language': 'zh-CN', cookie: 'owned-cookie', authorization: 'Bearer owned-fixture', 'content-type': 'application/json' };
    let captured, writtenHeaders;
    outgoing.writeHead = (status, headers) => { outgoing.statusCode = status; outgoing.headersSent = true; writtenHeaders = headers; };
    const chunks = []; outgoing.on('data', chunk => chunks.push(chunk));
    const direct = { fetch: async (url, init) => { captured = { url, init }; return response; } };
    const pending = forwardDirectAppRequest({ incoming, outgoing, origin, headers: incoming.headers, direct, evidence, pathname: '/settings/' });
    incoming.end('{"locale_preference":"zh-CN","expected_revision":1}');
    return { receipt, evidence, outgoing, pending, captured: () => captured, headers: () => writtenHeaders, body: () => Buffer.concat(chunks).toString() };
  }
  test('method/query/body and browser headers survive; status/cache/multiple cookies/body survive', async () => {
    const headers = new Headers({ 'content-type': 'application/json', 'cache-control': 'private, no-store' });
    headers.append('set-cookie', 'one=owned; Path=/'); headers.append('set-cookie', 'two=owned; Path=/');
    const f = fixture(new Response('{"ok":true}', { status: 201, headers }));
    await f.pending; await f.evidence.finalize();
    const { url, init } = f.captured();
    assert.equal(url, origin + '/settings/?mode=owned'); assert.equal(init.method, 'PATCH');
    assert.deepEqual(JSON.parse(init.body.toString()), { locale_preference: 'zh-CN', expected_revision: 1 });
    for (const [key, value] of Object.entries({ 'accept-language': 'zh-CN', cookie: 'owned-cookie', authorization: 'Bearer owned-fixture', 'content-type': 'application/json' })) assert.equal(init.headers[key], value);
    assert.equal(f.outgoing.statusCode, 201); assert.equal(f.headers()['cache-control'], 'private, no-store');
    assert.deepEqual(f.headers()['set-cookie'], ['one=owned; Path=/', 'two=owned; Path=/']); assert.equal(f.body(), '{"ok":true}');
    assert.equal(f.receipt.documentEvidenceFinalization, 'COMPLETE');
  });
  test('real direct 503 is preserved and never reinterpreted as success', async () => {
    const f = fixture(new Response('{"ok":false,"code":"PREFERENCES_UNAVAILABLE"}', { status: 503, headers: { 'content-type': 'application/json' } }));
    await f.pending; assert.equal(f.outgoing.statusCode, 503); assert.equal(JSON.parse(f.body()).code, 'PREFERENCES_UNAVAILABLE');
  });
  for (const throws of [false, true]) test(`direct document ${throws ? 'throw' : '500'} retains request correlation and fails closed`, async () => {
    const receipt = {}, page = new EventEmitter(), frame = {};
    page.mainFrame = () => frame;
    const evidence = createDocumentEvidence({ origin, receipt, projectRoot: process.cwd() });
    evidence.observePage(page, 'direct-context');
    const request = { url: () => origin + '/settings/', method: () => 'GET', isNavigationRequest: () => true,
      frame: () => frame, redirectedFrom: () => null, headers: () => ({ 'accept-language': 'zh-CN' }) };
    page.emit('request', request);
    const incoming = new PassThrough(), outgoing = new PassThrough();
    incoming.url = '/settings/'; incoming.method = 'GET'; incoming.headers = evidence.headersFor(request);
    outgoing.writeHead = status => { outgoing.statusCode = status; outgoing.headersSent = true; };
    outgoing.resume();
    const direct = { fetch: async () => {
      if (throws) throw new TypeError('fetch failed');
      return new Response('Network connection lost.', { status: 500, headers: { 'content-type': 'text/plain' } });
    } };
    const pending = forwardDirectAppRequest({ incoming, outgoing, origin, headers: incoming.headers, direct, evidence, pathname: '/settings/' });
    incoming.end(); await pending; await evidence.finalize();
    const failure = receipt.document5xxFailures[0];
    assert.equal(failure.DOCUMENT_5XX_CORRELATION_ID, receipt.documentRequests[0].requestCorrelationId);
    assert.equal(failure.DOCUMENT_5XX_STATUS, throws ? 599 : 500);
    assert.equal(failure.DOCUMENT_5XX_UPSTREAM_RESULT, throws ? 'THROW' : 'RESPONSE');
    assert.equal(failure.DOCUMENT_5XX_CORRELATED_THROW, throws);
    assert.throws(() => evidence.assertNo5xx(), /DOCUMENT_HTTP_5XX/);
  });
  test('formal runner preserves owned HTTPS and routes only application requests via direct binding', async () => {
    const source = await readFile(new URL('./test-global-locale-v2-acceptance-local.mjs', import.meta.url), 'utf8');
    assert.ok(source.includes('createDirectAppDispatch(worker)'));
    assert.ok(source.includes('forwardDirectAppRequest('));
    assert.ok(source.includes('gateway = createHttpsServer('));
    assert.ok(!source.includes('upstream = (await worker.url).origin'));
    assert.ok(source.includes('transport: httpRequest'));
    assert.ok(source.includes('targetOnly ? localeContexts.slice(0,1) : localeContexts'));
    assert.ok(source.indexOf('receipt.targetContext =') < source.indexOf('await setCookie(context,fixture.locale)'));
  });
}
