import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';

let observeOriginalAppResponse;
try { ({ observeOriginalAppResponse } = await import('./lib/locale-v2-redirect-observer.mjs')); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }

test('shared redirect observer is available at the direct application boundary', () => {
  assert.equal(typeof observeOriginalAppResponse, 'function', 'SHARED_REDIRECT_OBSERVER_REQUIRED');
});

async function fixture(run) {
  const paths = [];
  const backend = createServer((req, res) => {
    paths.push(req.url);
    if (['/products/meta/xreal-air/', '/devices/xreal-air'].includes(req.url)) {
      res.writeHead(301, { location: '/products/xreal/xreal-air/' }); res.end();
    } else if (req.url === '/products/xreal/xreal-air/') { res.writeHead(200); res.end('<main data-product-detail>Owned product</main>'); }
    else if (req.url === '/unavailable/') { res.writeHead(503); res.end('Owned unavailable'); }
    else { res.writeHead(404); res.end('Owned missing'); }
  });
  await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${backend.address().port}`;
  const direct = { fetch: (url, init) => fetch(url, init) };
  try { await run({ origin, direct, paths }); }
  finally { backend.closeAllConnections(); await new Promise(resolve => backend.close(resolve)); }
}

for (const pathname of ['/products/meta/xreal-air/', '/devices/xreal-air']) {
  test(`shared observer exposes original 301 without requesting destination: ${pathname}`, { skip: !observeOriginalAppResponse }, async () => {
    await fixture(async ({ origin, direct, paths }) => {
      const result = await observeOriginalAppResponse({ direct, origin, pathname });
      assert.deepEqual(result, { status: 301, location: '/products/xreal/xreal-air/', bodyClass: 'EMPTY' });
      assert.deepEqual(paths, [pathname], 'UPSTREAM_MUST_NOT_FOLLOW');
    });
  });
}

test('shared observer leaves direct canonical 200, unknown 404 and unavailable 503 unchanged', { skip: !observeOriginalAppResponse }, async () => {
  await fixture(async ({ origin, direct }) => {
    for (const [pathname, status, bodyClass] of [['/products/xreal/xreal-air/', 200, 'PRODUCT_DETAIL_HTML'], ['/missing/', 404, 'OTHER_WITHHELD'], ['/unavailable/', 503, 'OTHER_WITHHELD']]) {
      const result = await observeOriginalAppResponse({ direct, origin, pathname });
      assert.deepEqual(result, { status, location: null, bodyClass });
    }
  });
});

test('shared observer refuses a non-loopback request before dispatch and a remote redirect before exposing it', { skip: !observeOriginalAppResponse }, async () => {
  let dispatches = 0;
  const direct = { fetch: async () => { dispatches++; return new Response(null, { status: 301, headers: { location: 'https://example.invalid/' } }); } };
  await assert.rejects(observeOriginalAppResponse({ direct, origin: 'https://example.invalid', pathname: '/devices/xreal-air' }));
  assert.equal(dispatches, 0);
  await assert.rejects(observeOriginalAppResponse({ direct, origin: 'http://127.0.0.1:1234', pathname: '/devices/xreal-air' }), /LOCAL_REDIRECT_REQUIRED/);
  assert.equal(dispatches, 1);
});

test('redirect Set-Cookie effects reach the browser cookie owner before continuity is observed', { skip: !observeOriginalAppResponse }, async () => {
  const applied = [];
  const context = { cookies: async () => [{ name: 'ogh_preferences_v1', value: 'old-owned-value' }], addCookies: async cookies => applied.push(...cookies) };
  const direct = { fetch: async (_url, init) => {
    assert.equal(new Headers(init.headers).get('cookie'), 'ogh_preferences_v1=old-owned-value', 'BROWSER_COOKIE_FORWARDING_REQUIRED');
    return new Response(null, { status: 301, headers: { location: '/products/xreal/xreal-air/', 'set-cookie': 'ogh_preferences_v1=new%20owned%20value; Path=/; HttpOnly; Secure; SameSite=Lax' } });
  } };
  const result = await observeOriginalAppResponse({ direct, origin: 'https://127.0.0.1:1234', pathname: '/devices/xreal-air', context });
  assert.equal(applied.length, 1, 'REDIRECT_COOKIE_EFFECT_REQUIRED');
  assert.deepEqual(applied[0], { name: 'ogh_preferences_v1', value: 'new%20owned%20value', domain: '127.0.0.1', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' });
  assert.equal(JSON.stringify(result).includes('owned'), false, 'COOKIE_VALUE_MUST_NOT_ENTER_SAFE_OBSERVATION');
});

test('raw canonical destination cannot hide a redirect to another 200 page', { skip: !observeOriginalAppResponse }, async () => {
  const direct = { fetch: async (_url, init) => init.redirect === 'manual'
    ? new Response(null, { status: 302, headers: { location: '/other/' } }) : new Response('Final page', { status: 200 }) };
  const result = await observeOriginalAppResponse({ direct, origin: 'http://127.0.0.1:1234', pathname: '/products/xreal/xreal-air/' });
  assert.equal(result.status, 302);
  assert.equal(result.location, '/other/');
});
