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
let declaration;
function find(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'wrong') declaration = node;
  ts.forEachChild(node, find);
}
find(ast); assert.ok(declaration?.initializer, 'ACTUAL_CANONICAL_ASSERTION_REQUIRED');
const statement = declaration.parent.parent;
const next = statement.parent.statements[statement.parent.statements.indexOf(statement) + 1];
assert.ok(ts.isExpressionStatement(next) && next.expression.expression.getText(ast) === 'check');
const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
const observe = new AsyncFunction('context', 'direct', 'origin', 'check',
  `const wrong = ${declaration.initializer.getText(ast)}; ${next.getText(ast)} return wrong;`);

async function fixture(run) {
  // This HTTP double owns observer semantics, not product/database correctness.
  let destinationRequests = 0;
  const backend = createServer((req, res) => {
    destinationRequests++;
    if (req.url === '/products/meta/xreal-air/') {
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
  const context = { request: { get: async (url, options) => {
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
    const response = await observe(context, direct, origin, (condition, name) => assert.ok(condition, name));
    const status = typeof response.status === 'function' ? response.status() : response.status;
    assert.equal(status, 301); assert.equal(destinationRequests(), 1, 'CANONICAL_ASSERTION_MUST_NOT_FOLLOW');
    await response.arrayBuffer();
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
