import assert from 'node:assert/strict';
import { parseSetCookie } from 'cookie';

export async function observeOriginalAppResponse({ direct, origin, pathname, headers = {}, context }) {
  const url = new URL(pathname, origin);
  assert.equal(url.origin, origin, 'LOCAL_REQUEST_ORIGIN_REQUIRED');
  assert.equal(url.hostname, '127.0.0.1', 'LOCAL_REQUEST_LOOPBACK_REQUIRED');
  const forwarded = new Headers(headers);
  if (context) forwarded.set('cookie', (await context.cookies(origin)).map(cookie => `${cookie.name}=${cookie.value}`).join('; '));
  // This must be set on the application fetch, not on the already-following front door.
  const response = await direct.fetch(url.href, { method: 'GET', headers: forwarded, redirect: 'manual', signal: AbortSignal.timeout(10000) });
  const location = response.headers.get('location');
  assert.ok(!location || new URL(location, origin).origin === origin, 'LOCAL_REDIRECT_REQUIRED');
  const body = await response.text();
  if (context) {
    const cookies = response.headers.getSetCookie().map(header => {
      const parsed = parseSetCookie(header, { decode: value => value });
      assert.ok(parsed.name && !parsed.partitioned, 'SUPPORTED_LOCAL_COOKIE_REQUIRED');
      assert.ok(!parsed.domain || parsed.domain.replace(/^\./, '') === url.hostname, 'LOCAL_COOKIE_DOMAIN_REQUIRED');
      const cookie = { name: parsed.name, value: parsed.value, domain: url.hostname,
        path: parsed.path?.startsWith('/') ? parsed.path : url.pathname.slice(0, url.pathname.lastIndexOf('/')) || '/',
        httpOnly: parsed.httpOnly ?? false, secure: parsed.secure ?? false,
        sameSite: { lax: 'Lax', strict: 'Strict', none: 'None' }[parsed.sameSite] ?? 'Lax' };
      if (parsed.maxAge !== undefined) cookie.expires = parsed.maxAge <= 0 ? 0 : Math.floor(Date.now() / 1000) + parsed.maxAge;
      else if (parsed.expires) cookie.expires = parsed.expires.getTime() / 1000;
      return cookie;
    });
    if (cookies.length) await context.addCookies(cookies);
  }
  return { status: response.status, location,
    bodyClass: /data-product-detail/.test(body) ? 'PRODUCT_DETAIL_HTML' : /^\s*$/.test(body) ? 'EMPTY' : 'OTHER_WITHHELD' };
}
