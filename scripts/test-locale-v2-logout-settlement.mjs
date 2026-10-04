import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Frozen actual acceptance owner before repair; historical evidence is not rewritten.
const oldOwner = `async page => {
      boundary=receipt.stage='LOGOUT_NAVIGATION_SETTLEMENT';
      await Promise.all([page.waitForNavigation({waitUntil:'load'}),page.locator('.locale-settings li button').click()]);
      await settled(page);await page.locator('.locale-settings a[href^="/login/"]').waitFor();
      check(await page.evaluate(key=>localStorage.getItem(key)===null,authKey),'LOGOUT_AUTH_STORAGE_CLEARED');
    }`;
// The incomplete matrix runner is intentionally not adopted by this focused commit.
const runner = await readFile(new URL('./test-global-locale-v2-acceptance-local.mjs', import.meta.url), 'utf8').catch(error => {
  if (error.code === 'ENOENT') return null;
  throw error;
});
const ast = ts.createSourceFile('runner.mjs', runner ?? '', ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let actualOwner;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'logout') actualOwner = node.initializer.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);

async function oldSupersededFixture(owner) {
  let abort, finalSettled = false, finalRead = false;
  const documents = [];
  const page = {
    waitForNavigation: () => new Promise((_, reject) => { abort = reject; }),
    locator: () => ({ click: async () => {
      documents.push({ generation: 1, requestStarted: true, requestFailed: 'net::ERR_ABORTED' });
      documents.push({ generation: 2, requestStarted: true });
      abort(new Error('net::ERR_ABORTED: superseded intermediate document'));
    }, waitFor: async () => {} }),
    evaluate: async () => { finalRead = true; return true; },
  };
  const context = vm.createContext({ boundary: '', receipt: {}, Promise, authKey: 'owned-key',
    settled: async () => {}, check: assert.ok });
  const logout = vm.runInContext(`(${owner})`, context);
  let failure;
  try { await logout(page); } catch (error) { failure = error; }
  assert.equal(finalSettled, false);
  assert.equal(finalRead, false);
  assert.equal(documents.at(-1).load, undefined, 'old owner terminated before final document load');
  Object.assign(documents.at(-1), { responseStatus: 200, committed: true, domContentLoaded: true, load: true, quiet: true, anonymous: true });
  finalSettled = true;
  return { prematureFailure: !!failure, category: failure?.message.includes('net::ERR_ABORTED') ? 'net::ERR_ABORTED' : failure?.name, finalSettled };
}

if (process.argv.includes('--old-red')) {
  const owner = actualOwner?.includes('acceptLocaleLogout(') || !actualOwner ? oldOwner : actualOwner;
  assert.equal(owner.replaceAll('\r', ''), oldOwner, 'RED uses the exact frozen pre-repair acceptance owner');
  test('superseded intermediate document must not terminate acceptance before the final anonymous document', async () => {
    const result = await oldSupersededFixture(owner);
    assert.equal(result.prematureFailure, false, 'OLD_OWNER_STOPPED_AT_SUPERSEDED_INTERMEDIATE_DOCUMENT');
  });
} else {
  const { acceptLocaleLogout } = await import('./lib/locale-v2-logout-settlement.mjs');
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

  function fixture(t, { generations = 2, state = {}, documentFailure = false, instrumentation = false, logoutFinished = true } = {}) {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 });
    const cdp = new EventEmitter(), page = new EventEmitter(), bindings = new Map(), record = {};
    let clickResolve, reads = 0, clicks = 0;
    const clicked = new Promise(resolve => { clickResolve = resolve; });
    cdp.send = async method => method === 'Page.getFrameTree' ? { frameTree: { frame: { id: 'main' } } } : {};
    cdp.detach = async () => {};
    const context = { newCDPSession: async () => cdp,
      exposeBinding: async (name, callback) => { assert.equal(bindings.has(name), false); bindings.set(name, callback); },
      cookies: async () => [] };
    const request = (id, type = 'Document', method = 'GET') => cdp.emit('Network.requestWillBeSent', {
      requestId: id, loaderId: id, frameId: 'main', type,
      request: { method, url: 'https://127.0.0.1/' + (type === 'Document' ? 'settings/' : 'auth/v1/logout') },
    });
    page.evaluate = async (_callback, args) => {
      if (args.expectedActor) return { sessionPresent: true, sessionActorMatches: true, verifiedActorMatches: true, path: '/settings/' };
      reads++;
      return { readyState: 'complete', path: '/settings/', sessionNull: true, sessionError: false,
        authObservable: { event: 'INITIAL_SESSION', hasSession: false }, authStorageCleared: true,
        anonymousDom: true, authenticatedDom: false, logoutAlertPresent: false, ...state };
    };
    page.waitForFunction = async () => {};
    page.locator = () => ({ click: async () => {
      clicks++;
      const binding = [...bindings.values()].at(-1);
      for (const payload of [{ event: 'SIGNOUT_CALLED' }, { event: 'SIGNOUT_PROMISE_SETTLED', result: 'SUCCESS' }, { event: 'AUTH_STATE_NULL' }]) binding({}, payload);
      request('logout', 'Fetch', 'POST');
      cdp.emit('Network.responseReceived', { requestId: 'logout', response: { status: 204 } });
      if (logoutFinished) cdp.emit('Network.loadingFinished', { requestId: 'logout' });
      for (let i = 1; i <= generations; i++) {
        request('doc-' + i, 'Document', instrumentation ? null : 'GET');
        if (i < generations) cdp.emit('Network.loadingFailed', { requestId: 'doc-' + i, errorText: 'net::ERR_ABORTED', canceled: true });
      }
      clickResolve();
    } });
    const complete = () => {
      const id = 'doc-' + generations;
      cdp.emit('Network.responseReceived', { requestId: id, response: { status: 200 } });
      cdp.emit('Page.frameNavigated', { frame: { id: 'main', loaderId: id, url: 'https://127.0.0.1/settings/' } });
      if (documentFailure) cdp.emit('Network.loadingFailed', { requestId: id, errorText: 'net::ERR_FAILED', canceled: false });
      else cdp.emit('Network.loadingFinished', { requestId: id });
      cdp.emit('Page.lifecycleEvent', { frameId: 'main', loaderId: id, name: 'DOMContentLoaded' });
      cdp.emit('Page.lifecycleEvent', { frameId: 'main', loaderId: id, name: 'load' });
    };
    const run = () => acceptLocaleLogout({ page, context, factory: {}, expectedActor: 'owned-actor', authKey: 'owned-key', record });
    return { run, complete, clicked, record, reads: () => reads, clicks: () => clicks, bindings,
      nextDocument: () => request('doc-' + ++generations),
      pageError: () => page.emit('pageerror', new TypeError('OWNED_FIXTURE_ERROR')) };
  }

  test('frozen actual old owner fails before the healthy second document', async () => {
    assert.deepEqual(await oldSupersededFixture(oldOwner), { prematureFailure: true, category: 'net::ERR_ABORTED', finalSettled: true });
  });
  for (const generations of [1, 2, 4]) {
    test(`${generations} document generations settle only the latest stable anonymous state`, async t => {
      const f = fixture(t, { generations });
      const result = f.run(); await f.clicked; await flush();
      assert.equal(f.reads(), 0, 'transient anonymous old-document DOM cannot be final');
      f.complete(); t.mock.timers.tick(499); await flush();
      assert.equal(f.reads(), 0, 'quiet interval must finish');
      t.mock.timers.tick(1); await flush(); await result;
      assert.equal(f.record.finalDocumentGeneration, generations);
      assert.equal(f.record.settlement, 'PASS'); assert.equal(f.clicks(), 1);
    });
  }
  test('a newer document resets an already-running quiet interval', async t => {
    const f = fixture(t, { generations: 1 });
    const result = f.run(); await f.clicked; await flush();
    f.complete(); t.mock.timers.tick(400); await flush();
    f.nextDocument(); t.mock.timers.tick(100); await flush();
    assert.equal(f.reads(), 0, 'the intermediate document quiet timer must be canceled');
    f.complete(); t.mock.timers.tick(499); await flush(); assert.equal(f.reads(), 0);
    t.mock.timers.tick(1); await flush(); await result;
    assert.equal(f.record.finalDocumentGeneration, 2);
  });
  test('a final-document page error fails closed', async t => {
    const f = fixture(t);
    const outcome = f.run().then(() => null, error => error);
    await f.clicked; await flush(); f.complete(); f.pageError(); t.mock.timers.tick(500); await flush();
    assert.equal((await outcome)?.message.split('\n')[0], 'FINAL_PAGE_ERROR');
    assert.equal(f.record.settlement, 'FAIL_CLOSED');
  });
  for (const [name, options, code] of [
    ['never settles', {}, 'FINAL_DOCUMENT_NOT_IDENTIFIED'],
    ['authenticated final session', { state: { sessionNull: false } }, 'FINAL_SESSION_NOT_NULL'],
    ['missing anonymous DOM', { state: { anonymousDom: false } }, 'FINAL_ANONYMOUS_DOM_MISSING'],
    ['final document request failure', { documentFailure: true }, 'FINAL_DOCUMENT_NOT_IDENTIFIED'],
    ['instrumentation exception', { instrumentation: true }, 'LOGOUT_INSTRUMENTATION_ERROR'],
    ['authenticated DOM remains', { state: { authenticatedDom: true } }, 'FINAL_AUTHENTICATED_DOM_PRESENT'],
    ['no logout HTTP terminal', { logoutFinished: false }, 'LOGOUT_HTTP_TERMINAL_MISSING'],
  ]) {
    test(`${name} fails closed`, async t => {
      const f = fixture(t, options);
      const outcome = f.run().then(() => null, error => error);
      await f.clicked; await flush();
      if (name !== 'never settles') f.complete();
      t.mock.timers.tick(name === 'never settles' || options.documentFailure ? 12000 : 500);
      await flush();
      const error = await outcome; assert.equal(error?.message.split('\n')[0], code);
      assert.equal(f.record.settlement, 'FAIL_CLOSED'); assert.equal(f.clicks(), 1);
    });
  }
  test('repeated acceptance logouts in one context do not reuse a binding name', async t => {
    const f = fixture(t, { generations: 1 });
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = f.run(); await flush(); f.complete(); t.mock.timers.tick(500); await flush(); await result;
    }
    assert.equal(f.bindings.size, 2);
  });
  test('normal acceptance and narrow verification call the same logout owner', { skip: runner === null }, () => {
    assert.ok(actualOwner.includes('acceptLocaleLogout('));
    assert.ok(runner.includes("logoutMode==='acceptance-only'"));
    assert.ok(runner.includes('await logout(page,accounts.a)'));
    assert.ok(runner.includes('await logout(page,accounts.b)'));
  });
}
