import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';

const oldRed = process.argv.includes('--old-red');
const build = oldRed ? async req => ({ method: req.method, headers: req.headers,
  redirect: 'error', signal: AbortSignal.timeout(10000),
  ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: await req.arrayBuffer() }) })
  : (await import('./lib/locale-v2-outbound-bridge.mjs')).buildOutboundFetchInit;

async function fixture(run) {
  const received = [];
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    received.push({ method: req.method, headers: req.headers, body: Buffer.concat(chunks) });
    res.writeHead(200); res.end('owned');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`, received); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

function source(method, headers = {}, bytes = Buffer.from([0, 255, 13, 10, 123, 125])) {
  let reads = 0;
  return { method, headers: new Headers(headers), async arrayBuffer() {
    reads++; assert.equal(reads, 1, 'SOURCE_BODY_CONSUMED_ONCE');
    return Uint8Array.from(bytes).buffer;
  }, reads: () => reads, bytes };
}

test('Transfer-Encoding raw forwarding is an exact Undici invalid argument; sanitized PATCH reaches loopback', async () => {
  await fixture(async (url, received) => {
    const req = source('PATCH', { 'transfer-encoding': 'chunked' });
    let response, code;
    try { response = await fetch(url, await build(req)); }
    catch (error) { code = error.cause?.code; }
    assert.equal(code === 'UND_ERR_INVALID_ARG', false, 'UNDICI_INVALID_ARG_RAW_FORWARDING');
    assert.equal(response?.status, 200);
    assert.equal(received.length, 1); assert.ok(received[0].body.equals(req.bytes));
  });
});

if (!oldRed) {
  test('proxy credentials stay on the source hop without losing origin authorization', async () => {
    const secret = randomBytes(24).toString('hex');
    const req = source('GET', { 'proxy-authorization': secret, 'proxy-authenticate': secret, authorization: secret, apikey: secret });
    const init = await build(req);
    assert.equal(init.headers.has('proxy-authorization'), false);
    assert.equal(init.headers.has('proxy-authenticate'), false);
    assert.ok(init.headers.get('authorization') === secret); assert.ok(init.headers.get('apikey') === secret);
  });
  test('Connection-nominated fields and fixed hop-by-hop/framing headers are removed without mutating source', async () => {
    const req = source('PATCH', { connection: 'keep-alive, X-Owned-Hop', 'x-owned-hop': 'owned',
      'proxy-connection': 'close', 'keep-alive': 'timeout=5', 'transfer-encoding': 'chunked',
      upgrade: 'websocket', te: 'trailers', trailer: 'X-Trailer', host: 'owned.invalid', 'content-length': '999' });
    const init = await build(req);
    for (const name of ['connection', 'x-owned-hop', 'proxy-connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'te', 'trailer', 'host', 'content-length']) {
      assert.equal(init.headers.has(name), false, name);
    }
    assert.equal(req.headers.has('content-length'), true); assert.equal(req.reads(), 1);
    assert.equal(init.redirect, 'error'); assert.equal(init.signal.aborted, false);
  });

  test('authenticated REST PATCH preserves semantic headers value-blindly and reconstructs stale length', async () => {
    await fixture(async (url, received) => {
      const secret = randomBytes(24).toString('hex');
      const headers = { authorization: `Bearer ${secret}`, apikey: secret, 'content-type': 'application/json',
        accept: 'application/json', prefer: 'return=representation', range: '0-9',
        'accept-profile': 'public', 'content-profile': 'public', 'x-client-info': 'owned-fixture',
        'content-length': '999', host: 'owned.invalid', connection: 'close' };
      const req = source('PATCH', headers, Buffer.from('{"locale_preference":"zh-CN"}'));
      assert.equal((await fetch(url, await build(req))).status, 200);
      assert.equal(received.length, 1);
      for (const name of ['authorization', 'apikey', 'content-type', 'accept', 'prefer', 'range', 'accept-profile', 'content-profile', 'x-client-info']) {
        // Boolean equality prevents credential values appearing in assertion diagnostics.
        assert.ok(received[0].headers[name] === headers[name], name);
      }
      assert.ok(received[0].body.equals(req.bytes));
      assert.equal(received[0].headers['content-length'], String(req.bytes.length));
      assert.equal(received[0].headers.host, new URL(url).host);
    });
  });

  for (const method of ['GET', 'HEAD']) test(`${method} never consumes or forwards a body`, async () => {
    const req = source(method, { 'content-length': '999' }); const init = await build(req);
    assert.equal(Object.hasOwn(init, 'body'), false); assert.equal(req.reads(), 0);
    await fixture(async (url, received) => {
      assert.equal((await fetch(url, init)).status, 200); assert.equal(received[0].body.length, 0);
    });
  });
  for (const method of ['POST', 'PATCH']) test(`${method} forwards exact binary bytes with one source read`, async () => {
    await fixture(async (url, received) => {
      const req = source(method); const init = await build(req);
      assert.ok(Buffer.from(init.body).equals(req.bytes)); assert.equal(req.reads(), 1);
      assert.equal((await fetch(url, init)).status, 200); assert.ok(received[0].body.equals(req.bytes));
    });
  });
}
