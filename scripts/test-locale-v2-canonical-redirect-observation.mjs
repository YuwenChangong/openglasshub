import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import ts from 'typescript';
import { createDocumentEvidence } from './lib/locale-v2-document-evidence.mjs';
import { forwardDirectAppRequest } from './lib/locale-v2-direct-app-transport.mjs';

const source = await readFile(new URL('./test-global-locale-v2-acceptance-local.mjs', import.meta.url), 'utf8');
const ast = ts.createSourceFile('runner.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
assert.equal(ast.parseDiagnostics.length, 0);
const declarations = new Map();
function find(node) {
  if (ts.isVariableDeclaration(node) && ['wrong', 'legacy'].includes(node.name.getText(ast))) declarations.set(node.name.getText(ast), node);
  ts.forEachChild(node, find);
}
find(ast);
const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
function actualObservation(name) {
  const declaration = declarations.get(name); assert.ok(declaration?.initializer, 'ACTUAL_REDIRECT_ASSERTION_REQUIRED');
  const statement = declaration.parent.parent;
  const next = statement.parent.statements[statement.parent.statements.indexOf(statement) + 1];
  assert.ok(ts.isExpressionStatement(next) && ['check', 'observe'].includes(next.expression.expression.getText(ast)));
  return new AsyncFunction('context', 'direct', 'origin', 'check', 'observe', 'observeOriginalAppResponse', 'redirectHeaders', 'navigate', 'page', 'fixture',
    `const ${name} = ${declaration.initializer.getText(ast)}; ${next.getText(ast)} return ${name};`);
}
let observeOriginalAppResponse;
try { ({ observeOriginalAppResponse } = await import('./lib/locale-v2-redirect-observer.mjs')); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }

async function fixture(run) {
  // This HTTP double owns observer semantics, not product/database correctness.
  let destinationRequests = 0;
  const backend = createServer((req, res) => {
    destinationRequests++;
    if (['/products/meta/xreal-air/', '/devices/xreal-air'].includes(req.url)) {
      res.writeHead(301, { location: '/products/xreal/xreal-air/' }); res.end();
    } else if (req.url === '/products/xreal/xreal-air/') { res.writeHead(200); res.end('Owned product'); }
    else if (req.url === '/products/xreal/unavailable/') { res.writeHead(503); res.end('Owned unavailable'); }
    else { res.writeHead(404); res.end('Owned missing'); }
  });
  await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
  const destination = `http://127.0.0.1:${backend.address().port}`;
  const direct = { fetch: (input, init) => fetch(new URL(new URL(input).pathname, destination), init) };
  let origin, evidence;
  const gateway = createServer((incoming, outgoing) => forwardDirectAppRequest({ incoming, outgoing,
    origin, headers: incoming.headers, direct, evidence, pathname: incoming.url }));
  await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${gateway.address().port}`;
  const receipt = {}; evidence = createDocumentEvidence({ origin, receipt, projectRoot: process.cwd() });
  const context = { cookies: async () => [], addCookies: async () => {}, request: { get: async (url, options) => {
    const response = await fetch(url, { redirect: options.maxRedirects === 0 ? 'manual' : 'follow' });
    return { status: () => response.status, headers: () => Object.fromEntries(response.headers), arrayBuffer: () => response.arrayBuffer() };
  } } };
  try { await run({ origin, direct, context, destinationRequests: () => destinationRequests }); }
  finally {
    await evidence.finalize(); await evidence.dispose();
    for (const server of [gateway, backend]) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
}

test('actual runner canonical assertion observes the original 301 even when the ordinary gateway follows redirects', async () => {
  await fixture(async ({ origin, direct, context, destinationRequests }) => {
    const check = (condition, name) => assert.ok(condition, name);
    const response = await actualObservation('wrong')(context, direct, origin, check, check, observeOriginalAppResponse, {});
    const status = typeof response.status === 'function' ? response.status() : response.status;
    assert.equal(status, 301); assert.equal(destinationRequests(), 1, 'CANONICAL_ASSERTION_MUST_NOT_FOLLOW');
    if (response.arrayBuffer) await response.arrayBuffer();
  });
});

test('actual runner legacy assertion observes original 301 rather than the gateway final 200 at the legacy URL', async () => {
  await fixture(async ({ origin, direct, context, destinationRequests }) => {
    const check = (condition, name) => assert.ok(condition, name);
    let visibleUrl;
    const navigate = async (_page, pathname) => { visibleUrl = origin + pathname; return context.request.get(visibleUrl, {}); };
    const result = await actualObservation('legacy')(context, direct, origin, check, check, observeOriginalAppResponse, {}, navigate, { url: () => visibleUrl }, { locale: 'zh-CN' });
    assert.equal(result.status, 301); assert.equal(destinationRequests(), 1, 'LEGACY_ASSERTION_MUST_NOT_FOLLOW');
  });
});

test('raw manual observation preserves canonical 200, unknown 404 and safe 503 without changing the ordinary gateway', async () => {
  await fixture(async ({ origin, direct, context }) => {
    for (const [pathname, status] of [['/products/xreal/xreal-air/', 200], ['/products/xreal/unknown/', 404], ['/products/xreal/unavailable/', 503]]) {
      const response = await direct.fetch(origin + pathname, { redirect: 'manual' });
      assert.equal(response.status, status); await response.arrayBuffer();
    }
    const ordinary = await context.request.get(origin + '/products/meta/xreal-air/', { maxRedirects: 0 });
    assert.equal(ordinary.status(), 200, 'ORDINARY_FRONT_DOOR_BEHAVIOR_UNCHANGED'); await ordinary.arrayBuffer();
  });
});
