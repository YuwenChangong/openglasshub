import assert from 'node:assert/strict';
import { LOCAL_DOCUMENT_HEADER } from './locale-v2-document-evidence.mjs';

export async function createDirectAppDispatch(worker) {
  assert.equal(worker.config.dev.remote, false, 'DIRECT_APP_LOCAL_RUNTIME_REQUIRED');
  const locals = worker.raw.runtimes.filter(runtime => runtime.mf);
  assert.equal(locals.length, 1, 'DIRECT_APP_SINGLE_RUNTIME_REQUIRED');
  const local = locals[0].mf;
  const proxy = (await worker.raw.proxy.ready.promise).proxyWorker;
  assert.notEqual(local, proxy, 'DIRECT_APP_NOT_WRANGLER_PROXY_REQUIRED');
  const cf = await local.getCf();
  assert.equal(cf.country, 'US', 'DIRECT_APP_COUNTRY_REQUIRED');
  const application = await local.getWorker(worker.config.name);
  assert.equal(typeof application.fetch, 'function', 'DIRECT_APP_FETCH_REQUIRED');
  return {
    metadata: { proxyBypassed: true, country: cf.country, owner: 'APPLICATION_RUNTIME_MINIFLARE_SERVICE_BINDING' },
    fetch: (input, init = {}) => application.fetch(input, { ...init, cf }),
  };
}

export function forwardDirectAppRequest({ incoming, outgoing, origin, headers, direct, evidence, pathname, onResult = () => {} }) {
  const url = new URL(incoming.url, origin);
  assert.equal(url.origin, origin, 'DIRECT_APP_BROWSER_ORIGIN_REQUIRED');
  assert.equal(url.hostname, '127.0.0.1', 'DIRECT_APP_LOOPBACK_REQUIRED');
  const handle = evidence.upstreamStart({ method: incoming.method, pathname, headers: incoming.headers });
  const forwarded = { ...headers };
  for (const key of Object.keys(forwarded)) {
    if ([LOCAL_DOCUMENT_HEADER, 'connection', 'transfer-encoding', 'keep-alive'].includes(key.toLowerCase())) delete forwarded[key];
  }
  const controller = new AbortController();
  let aborted = false, settled = false;
  const finish = () => { if (!settled) { settled = true; evidence.upstreamFinished(handle); } };
  const cancel = () => {
    if (settled) return;
    aborted = true; evidence.upstreamAborted(handle); controller.abort(); finish();
  };
  incoming.once('aborted', cancel);
  outgoing.once('close', () => { if (!outgoing.writableFinished) cancel(); });
  outgoing.once('finish', () => evidence.frontDoorFinished(handle));
  const completed = (async () => {
    try {
      let body;
      if (!['GET', 'HEAD'].includes(incoming.method)) {
        const chunks = []; for await (const chunk of incoming) chunks.push(Buffer.from(chunk)); body = Buffer.concat(chunks);
      }
      if (aborted) return;
      const response = await direct.fetch(url.href, { method: incoming.method, headers: forwarded, signal: controller.signal, ...(body ? { body } : {}) });
      if (aborted) return;
      const location = response.headers.get('location');
      assert.ok(!location || new URL(location, origin).origin === origin, 'LOCAL_REDIRECT_DENIED');
      evidence.upstreamResponse(handle, response.status, response.headers.get('content-type'));
      onResult({ requestCorrelationId: handle.id, method: incoming.method, pathname, result: 'RESPONSE', status: response.status });
      const bytes = Buffer.from(await response.arrayBuffer());
      evidence.upstreamBody(handle, bytes);
      if (aborted) return;
      const responseHeaders = Object.fromEntries([...response.headers].filter(([key]) => !['connection', 'transfer-encoding', 'keep-alive', 'set-cookie', 'mf-content-encoding'].includes(key.toLowerCase())));
      const cookies = response.headers.getSetCookie();
      if (cookies.length) responseHeaders['set-cookie'] = cookies;
      // Miniflare has already decoded response bodies before exposing its Node Response.
      if (incoming.method !== 'HEAD' && ![204, 304].includes(response.status) && responseHeaders['content-length']) responseHeaders['content-length'] = String(bytes.length);
      outgoing.writeHead(response.status, responseHeaders); outgoing.end(bytes);
    } catch (error) {
      evidence.upstreamThrow(handle, error, aborted);
      onResult({ requestCorrelationId: handle.id, method: incoming.method, pathname, result: 'THROW', errorClass: ['Error','TypeError','AssertionError','AbortError'].includes(error.name) ? error.name : 'UNKNOWN' });
      if (!aborted && !outgoing.destroyed) {
        if (!outgoing.headersSent) { evidence.upstreamResponse(handle, 599, null); outgoing.writeHead(599); }
        outgoing.end();
      }
    } finally { finish(); }
  })();
  evidence.track(completed);
  return completed;
}
