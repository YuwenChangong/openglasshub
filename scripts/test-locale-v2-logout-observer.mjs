import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as observer from './lib/locale-v2-logout-observer.mjs';

const source = await readFile(new URL('./lib/locale-v2-logout-observer.mjs', import.meta.url), 'utf8');
const ast = ts.createSourceFile('observer.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const observation = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'observeFinalLogout');
const listen = observation.body.statements.filter(ts.isVariableStatement).flatMap(node => [...node.declarationList.declarations]).find(node => node.name.getText(ast) === 'listen');
const registration = observation.body.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === 'listen' && node.expression.arguments[1].text === 'Network.requestWillBeSent');
assert.ok(listen && registration, 'Actual diagnostic listener and CDP callback must be tested');

function fixture() {
  const emitter = new EventEmitter(), events = [], documents = [], record = {}, listeners = [];
  let failed = false;
  const append = (event, detail = {}) => events.push({ event, ...detail });
  const context = vm.createContext({ emitter, append, events, documents, record, listeners, URL, Map,
    active: true, frameId: 'main', loaders: new Map(), requests: new Map(), reschedule() {},
    readCdpRequestMethod: observer.readCdpRequestMethod,
    containDiagnosticObserver: observer.containDiagnosticObserver,
    failObserver() { failed = true; },
  });
  vm.runInContext(`const listen = ${listen.initializer.getText(ast)}; listen(emitter, 'Network.requestWillBeSent', ${registration.expression.arguments[2].getText(ast)});`, context);
  return { emitter, events, documents, record, context, failed: () => failed };
}
const request = method => ({ requestId: 'owned-request', loaderId: 'owned-loader', frameId: 'main', type: 'Fetch', request: { method, url: 'https://127.0.0.1/auth/v1/logout' } });

test('CDP string method field records POST without calling it', () => {
  const state = fixture();
  assert.doesNotThrow(() => state.emitter.emit('Network.requestWillBeSent', request('POST')));
  assert.equal(state.events.find(event => event.event === 'LOGOUT_HTTP_STARTED')?.method, 'POST');
  assert.equal(state.failed(), false);
});

for (const [label, value] of [['missing', undefined], ['non-string', 42]]) {
  test(`${label} CDP method is contained and fails the diagnostic explicitly`, () => {
    const state = fixture();
    assert.doesNotThrow(() => state.emitter.emit('Network.requestWillBeSent', request(value)));
    assert.equal(state.events.find(event => event.event === 'INSTRUMENTATION_ERROR')?.category, 'INVALID_CDP_REQUEST_METHOD');
    assert.equal(state.record.instrumentationFailed, true);
    assert.equal(state.failed(), true);
    assert.equal(state.events.some(event => event.event === 'LOGOUT_HTTP_STARTED'), false);
  });
}

test('function-valued CDP method is rejected and never invoked', () => {
  let calls = 0;
  const state = fixture();
  assert.doesNotThrow(() => state.emitter.emit('Network.requestWillBeSent', request(() => { calls++; return 'POST'; })));
  assert.equal(calls, 0);
  assert.equal(state.record.instrumentationFailed, true);
  assert.equal(state.failed(), true);
});

test('document generation ledger records the GET method field', () => {
  const state = fixture(), event = request('GET');
  event.type = 'Document'; event.request.url = 'https://127.0.0.1/settings/';
  assert.doesNotThrow(() => state.emitter.emit('Network.requestWillBeSent', event));
  assert.equal(state.documents[0].generation, 1);
  assert.equal(state.documents[0].method, 'GET');
});

test('synchronous callback exceptions enter the ledger without escaping the emitter', () => {
  const state = fixture();
  vm.runInContext(`listen(emitter, 'owned-error', () => { throw new TypeError('PRIVATE_FIXTURE_DETAIL'); });`, state.context);
  assert.doesNotThrow(() => state.emitter.emit('owned-error'));
  assert.equal(state.failed(), true);
  assert.equal(state.record.instrumentationFailed, true);
  assert.equal(state.events.find(event => event.event === 'INSTRUMENTATION_ERROR')?.observer, 'owned-error');
  assert.equal(JSON.stringify(state.record).includes('PRIVATE_FIXTURE_DETAIL'), false);
});

test('asynchronous callback exceptions fail closed without an unhandled rejection', async () => {
  const state = fixture();
  vm.runInContext(`listen(emitter, 'owned-async-error', async () => { throw new Error('PRIVATE_FIXTURE_DETAIL'); });`, state.context);
  state.emitter.emit('owned-async-error');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.failed(), true);
  assert.equal(state.record.instrumentationFailed, true);
  assert.equal(state.events.find(event => event.event === 'INSTRUMENTATION_ERROR')?.observer, 'owned-async-error');
  assert.equal(JSON.stringify(state.record).includes('PRIVATE_FIXTURE_DETAIL'), false);
});
