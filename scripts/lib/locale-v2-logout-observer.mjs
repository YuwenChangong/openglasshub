import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

export function readCdpRequestMethod(event) {
  const method = event?.request?.method;
  if (typeof method !== 'string' || !/^[A-Z]+$/.test(method)) {
    throw Object.assign(new TypeError('INVALID_CDP_REQUEST_METHOD'), { code: 'INVALID_CDP_REQUEST_METHOD' });
  }
  return method;
}

export function containDiagnosticObserver(observer, handler, { record, append, fail }) {
  const report = error => {
    const category = error?.code === 'INVALID_CDP_REQUEST_METHOD' ? error.code
      : ['Error', 'TypeError', 'RangeError', 'ReferenceError', 'AssertionError'].includes(error?.name) ? error.name : 'Error';
    const detail = { observer, category };
    record.instrumentationFailed = true;
    (record.observerErrors ??= []).push(detail);
    append('INSTRUMENTATION_ERROR', detail);
    fail();
  };
  return (...args) => {
    try {
      const result = handler(...args);
      if (result && typeof result.then === 'function') return Promise.resolve(result).catch(report);
      return result;
    } catch (error) { report(error); }
  };
}

export async function findBrowserClientFactory(root) {
  const directory = path.join(root, 'dist/client/_astro');
  const files = (await readdir(directory)).filter(name => /^supabase-browser\..*\.js$/.test(name));
  assert.equal(files.length, 1, 'ONE_BROWSER_CLIENT_CHUNK');
  const source = ts.createSourceFile(files[0], await readFile(path.join(directory, files[0]), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const factory = source.statements.find(node => ts.isFunctionDeclaration(node) && node.getText(source).includes('detectSessionInUrl'));
  assert.ok(factory?.name, 'REAL_BROWSER_FACTORY');
  const exports = source.statements.filter(ts.isExportDeclaration).flatMap(node => node.exportClause?.elements ?? []);
  const exported = exports.find(node => node.propertyName?.text === factory.name.text);
  assert.ok(exported, 'REAL_BROWSER_FACTORY_EXPORT');
  return { chunk: '/_astro/' + files[0], exported: exported.name.text };
}

export async function observeLogout({ page, context, factory, expectedActor, authKey, record, diagnostic = true }) {
  const events = record.events = [];
  let active = false;
  const append = (event, detail = {}) => events.push({ event, timestamp: new Date().toISOString(), ...detail });
  await context.exposeBinding('__oghLogoutObservation', (_source, payload) => {
    assert.ok(['SIGNOUT_CALLED', 'SIGNOUT_PROMISE_SETTLED', 'AUTH_STATE_NULL', 'SIGNOUT_REJECTED', 'LOCALE_ACCOUNT_CLEAR'].includes(payload.event));
    append(payload.event, { browserTimestamp: payload.timestamp, ...(payload.result ? { result: payload.result } : {}) });
  });
  page.on('pageerror', error => { if (active) append('PAGE_ERROR', { category: error.name }); });
  page.on('requestfailed', request => {
    if (active) append('REQUEST_FAILED', { kind: request.isNavigationRequest() ? 'DOCUMENT' : new URL(request.url()).pathname === '/auth/v1/logout' ? 'LOGOUT' : 'OTHER', reason: request.failure()?.errorText });
  });
  page.on('request', request => {
    if (active && new URL(request.url()).pathname === '/auth/v1/logout') append('LOGOUT_HTTP_STARTED', { method: request.method() });
    if (active && request.isNavigationRequest()) append('DOCUMENT_STARTED', { path: new URL(request.url()).pathname });
  });
  page.on('response', response => {
    if (active && new URL(response.url()).pathname === '/auth/v1/logout') append('LOGOUT_HTTP_RESPONSE', { status: response.status() });
  });
  page.on('requestfinished', request => {
    if (active && new URL(request.url()).pathname === '/auth/v1/logout') append('LOGOUT_HTTP_FINISHED');
    if (active && request.isNavigationRequest()) append('DOCUMENT_HTTP_FINISHED', { path: new URL(request.url()).pathname });
  });
  page.on('framenavigated', frame => { if (active && frame === page.mainFrame()) append('URL_COMMITTED', { path: new URL(frame.url()).pathname }); });
  page.on('load', () => { if (active) append('DOCUMENT_LOADED', { path: new URL(page.url()).pathname }); });
  record.before = await page.evaluate(async ({ factory, expectedActor }) => {
    const module = await import(factory.chunk);
    const client = module[factory.exported]();
    const session = await client.auth.getSession(), user = await client.auth.getUser();
    const emit = payload => { void window.__oghLogoutObservation({ ...payload, timestamp: new Date().toISOString() }).catch(() => {}); };
    const original = client.auth.signOut.bind(client.auth);
    client.auth.signOut = (...args) => {
      emit({ event: 'SIGNOUT_CALLED' });
      const promise = original(...args);
      void promise.then(result => emit({ event: 'SIGNOUT_PROMISE_SETTLED', result: result.error ? 'ERROR' : 'SUCCESS' }), () => emit({ event: 'SIGNOUT_REJECTED' }));
      return promise;
    };
    client.auth.onAuthStateChange((event, current) => { if (event === 'SIGNED_OUT' && current === null) emit({ event: 'AUTH_STATE_NULL' }); });
    window.addEventListener('ogh:locale-preference', event => {
      if (event.detail?.preference === 'auto' && event.detail?.provenance === 'account_adopted') emit({ event: 'LOCALE_ACCOUNT_CLEAR' });
    });
    return { sessionPresent: !!session.data.session, sessionActorMatches: session.data.session?.user.id === expectedActor, verifiedActorMatches: !user.error && user.data.user?.id === expectedActor };
  }, { factory, expectedActor });
  assert.ok(Object.values(record.before).every(Boolean), 'GENUINE_SESSION_EXPECTED_ACTOR');
  active = true;
  const oldWaiter = diagnostic ? page.waitForNavigation({ waitUntil: 'load', timeout: 12000 }).then(() => ({ result: 'PASS' }), error => ({ result: 'FAIL', errorClass: error.name })) : null;
  append('LOGOUT_CLICK');
  await page.locator('.locale-settings li button').click();
  try {
    await page.waitForFunction(key => !!document.querySelector('.locale-settings a[href^="/login/"]') && [...document.querySelectorAll('astro-island')].every(island => !island.hasAttribute('ssr')) && localStorage.getItem(key) === null, authKey, { timeout: 12000 });
    append('ANON_DOM_TERMINAL');
    record.after = await page.evaluate(async ({ factory, authKey }) => {
      const module = await import(factory.chunk), client = module[factory.exported]();
      const session = await client.auth.getSession();
      const cookie = document.cookie.split('; ').find(value => value.startsWith('ogh_preferences_v1='));
      return { authNull: session.data.session === null, authStorageCleared: localStorage.getItem(authKey) === null, anonymousDom: !!document.querySelector('.locale-settings a[href^="/login/"]'), path: location.pathname, locale: document.documentElement.lang, preference: cookie ? JSON.parse(decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1))) : null };
    }, { factory, authKey });
    append('FINAL_STATE_READ');
  } catch (error) { record.terminalFailure = { category: error.name }; }
  if (oldWaiter) record.oldWaiter = await oldWaiter;
  record.pageErrors = events.filter(event => event.event === 'PAGE_ERROR').length;
  record.requestFailures = events.filter(event => event.event === 'REQUEST_FAILED');
  return record;
}

// Observation only: the acceptance runner's existing logout contract is unchanged.
export async function observeFinalLogout({ page, context, factory, expectedActor, authKey, record }) {
  const events = record.events = [], documents = record.documents = [];
  const requests = new Map(), loaders = new Map();
  const session = await context.newCDPSession(page);
  await session.send('Network.enable');
  await session.send('Page.enable');
  await session.send('Page.setLifecycleEventsEnabled', { enabled: true });
  const frameId = (await session.send('Page.getFrameTree')).frameTree.frame.id;
  let active = false, committed = 0, quietTimer, deadlineTimer, finish, fail;
  const append = (event, detail = {}) => events.push({ event, timestamp: new Date().toISOString(), ...detail });
  const failObserver = () => { clearTimeout(quietTimer); fail?.(new Error('INSTRUMENTATION_OBSERVER_ERROR')); };
  const reschedule = () => {
    clearTimeout(quietTimer);
    const latest = documents.at(-1);
    if (!latest?.committed || !latest.load || !latest.domContentLoaded || latest.requestFailed) return;
    quietTimer = setTimeout(containDiagnosticObserver('FINAL_DOCUMENT_QUIET_PERIOD', () => {
      if (documents.at(-1) === latest && committed === latest.generation) {
        latest.quietPeriodCompleted = new Date().toISOString();
        append('FINAL_DOCUMENT_IDENTIFIED', { generation: latest.generation });
        finish(latest);
      }
    }, { record, append, fail: failObserver }), 500);
  };
  const listeners = [];
  const listen = (emitter, event, handler) => {
    const guarded = containDiagnosticObserver(event, handler, { record, append, fail: failObserver });
    emitter.on(event, guarded); listeners.push(() => emitter.off(event, guarded));
  };
  listen(session, 'Network.requestWillBeSent', event => {
    if (!active) return;
    const method = readCdpRequestMethod(event);
    const pathname = new URL(event.request.url).pathname;
    let generation = loaders.get(event.loaderId)?.generation ?? 0;
    if (event.type === 'Document' && event.frameId === frameId) {
      const document = { generation: documents.length + 1, path: pathname, method, requestStarted: new Date().toISOString(), responseStatus: null, requestFailed: null, committed: null, domContentLoaded: null, load: null };
      documents.push(document); loaders.set(event.loaderId, document); generation = document.generation;
      append('DOCUMENT_REQUEST_STARTED', { generation, path: pathname, method }); reschedule();
    }
    requests.set(event.requestId, { generation, kind: event.type === 'Document' && event.frameId === frameId ? 'DOCUMENT' : pathname === '/auth/v1/logout' ? 'LOGOUT' : 'OTHER', path: pathname, status: null });
    if (pathname === '/auth/v1/logout') append('LOGOUT_HTTP_STARTED', { method });
  });
  listen(session, 'Network.responseReceived', event => {
    if (!active) return;
    const request = requests.get(event.requestId); if (!request) return;
    request.status = event.response.status;
    if (request.kind === 'DOCUMENT') {
      const document = documents[request.generation - 1];
      document.responseStatus = request.status; document.responseReceived = new Date().toISOString();
      append('DOCUMENT_RESPONSE', { generation: request.generation, status: request.status });
    }
    if (request.kind === 'LOGOUT') append('LOGOUT_HTTP_RESPONSE', { status: request.status });
  });
  listen(session, 'Network.loadingFinished', event => {
    if (!active) return;
    const request = requests.get(event.requestId);
    if (request?.kind === 'DOCUMENT') { documents[request.generation - 1].httpFinished = new Date().toISOString(); append('DOCUMENT_HTTP_FINISHED', { generation: request.generation }); }
    if (request?.kind === 'LOGOUT') append('LOGOUT_HTTP_FINISHED');
  });
  listen(session, 'Network.loadingFailed', event => {
    if (!active) return;
    const request = requests.get(event.requestId); if (!request) return;
    const failure = { generation: request.generation, kind: request.kind, reason: event.errorText, canceled: !!event.canceled, status: request.status };
    if (request.kind === 'DOCUMENT') documents[request.generation - 1].requestFailed = failure;
    append('NETWORK_LOADING_FAILED', failure); reschedule();
  });
  listen(session, 'Page.frameNavigated', event => {
    if (!active || event.frame.id !== frameId) return;
    const document = loaders.get(event.frame.loaderId);
    if (!document) { append('UNMAPPED_FRAME_COMMIT', { path: new URL(event.frame.url).pathname }); return; }
    document.committed = new Date().toISOString(); committed = document.generation;
    append('DOCUMENT_COMMITTED', { generation: committed, path: new URL(event.frame.url).pathname }); reschedule();
  });
  listen(session, 'Page.lifecycleEvent', event => {
    if (!active || event.frameId !== frameId) return;
    const document = loaders.get(event.loaderId); if (!document) return;
    if (event.name === 'DOMContentLoaded') document.domContentLoaded = new Date().toISOString();
    if (event.name === 'load') document.load = new Date().toISOString();
    if (event.name === 'DOMContentLoaded' || event.name === 'load') { append(event.name === 'load' ? 'DOCUMENT_LOAD' : 'DOCUMENT_DOMCONTENTLOADED', { generation: document.generation }); reschedule(); }
  });
  listen(page, 'pageerror', error => { if (active) append('PAGE_ERROR', { generation: committed, category: error.name }); });
  listen(page, 'requestfailed', request => { if (active) append('PLAYWRIGHT_REQUEST_FAILED', { atGeneration: committed, kind: request.isNavigationRequest() ? 'DOCUMENT' : new URL(request.url()).pathname === '/auth/v1/logout' ? 'LOGOUT' : 'OTHER', reason: request.failure()?.errorText }); });
  for (const event of ['load', 'domcontentloaded']) listen(page, event, () => { if (active) append('PLAYWRIGHT_' + event.toUpperCase(), { generation: committed }); });
  listen(page, 'framenavigated', frame => { if (active && frame === page.mainFrame()) append('PLAYWRIGHT_FRAME_NAVIGATED', { path: new URL(frame.url()).pathname }); });
  for (const event of ['close', 'crash']) listen(page, event, () => { if (active) { append('PAGE_' + event.toUpperCase()); fail(new Error('BROWSER_' + event.toUpperCase())); } });
  await context.exposeBinding('__oghFinalLogoutObservation', containDiagnosticObserver('AUTH_STATE_BINDING', (_source, payload) => {
    assert.ok(['SIGNOUT_CALLED', 'SIGNOUT_PROMISE_SETTLED', 'AUTH_STATE_NULL', 'SIGNOUT_REJECTED', 'LOCALE_ACCOUNT_CLEAR', 'OLD_DOCUMENT_BEFOREUNLOAD', 'OLD_DOCUMENT_PAGEHIDE'].includes(payload.event));
    append(payload.event, { browserTimestamp: payload.timestamp, ...(payload.result ? { result: payload.result } : {}) });
  }, { record, append, fail: failObserver }));
  record.before = await page.evaluate(async ({ factory, expectedActor }) => {
    const module = await import(factory.chunk), client = module[factory.exported]();
    const current = await client.auth.getSession(), user = await client.auth.getUser();
    const emit = payload => { void window.__oghFinalLogoutObservation({ ...payload, timestamp: new Date().toISOString() }).catch(() => {}); };
    const original = client.auth.signOut.bind(client.auth);
    client.auth.signOut = (...args) => {
      emit({ event: 'SIGNOUT_CALLED' });
      const promise = original(...args);
      void promise.then(result => emit({ event: 'SIGNOUT_PROMISE_SETTLED', result: result.error ? 'ERROR' : 'SUCCESS' }), () => emit({ event: 'SIGNOUT_REJECTED' }));
      return promise;
    };
    client.auth.onAuthStateChange((event, current) => { if (event === 'SIGNED_OUT' && current === null) emit({ event: 'AUTH_STATE_NULL' }); });
    window.addEventListener('ogh:locale-preference', event => { if (event.detail?.preference === 'auto' && event.detail?.provenance === 'account_adopted') emit({ event: 'LOCALE_ACCOUNT_CLEAR' }); });
    for (const event of ['beforeunload', 'pagehide']) window.addEventListener(event, () => emit({ event: 'OLD_DOCUMENT_' + event.toUpperCase() }));
    return { sessionPresent: !!current.data.session, sessionActorMatches: current.data.session?.user.id === expectedActor, verifiedActorMatches: !user.error && user.data.user?.id === expectedActor, path: location.pathname };
  }, { factory, expectedActor });
  assert.ok(record.before.sessionPresent && record.before.sessionActorMatches && record.before.verifiedActorMatches && record.before.path === '/settings/', 'GENUINE_EXPECTED_ACTOR_ON_SETTINGS');
  assert.ok(!record.instrumentationFailed, 'OBSERVER_SETUP_MUST_NOT_FAIL');
  record.observersArmedBeforeClick = true;
  const finalDocument = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
  // Attach rejection handling before the single click can trigger any observer.
  void finalDocument.catch(() => {});
  active = true;
  const deadline = Date.now() + 12000;
  deadlineTimer = setTimeout(() => fail(new Error('FINAL_DOCUMENT_SETTLEMENT_DEADLINE')), 12000);
  const oldWaiter = page.waitForNavigation({ waitUntil: 'load', timeout: 12000 }).then(() => ({ result: 'PASS' }), error => ({ result: 'FAIL', category: error.message.includes('ERR_ABORTED') ? 'SUPERSEDED_NAVIGATION_ABORT' : error.name }));
  try {
    record.clickCount = 1; append('LOGOUT_CLICK');
    await page.locator('.locale-settings li button').click({ noWaitAfter: true });
    const document = await finalDocument;
    record.finalDocumentGeneration = document.generation;
    await page.waitForFunction(() => [...document.querySelectorAll('astro-island')].every(island => !island.hasAttribute('ssr')), undefined, { timeout: Math.max(1, deadline - Date.now()) });
    let readTimer;
    try {
      record.after = await Promise.race([
        page.evaluate(async ({ factory, authKey }) => {
          const module = await import(factory.chunk), client = module[factory.exported]();
          const current = await client.auth.getSession();
          let subscription;
          const observable = await new Promise(resolve => { subscription = client.auth.onAuthStateChange((event, value) => resolve({ event, hasSession: !!value })); });
          subscription.data.subscription.unsubscribe();
          return { readyState: document.readyState, path: location.pathname, sessionNull: current.data.session === null, sessionError: !!current.error, authObservable: observable, authStorageCleared: localStorage.getItem(authKey) === null, anonymousDom: !!document.querySelector('.locale-settings a[href^="/login/"]'), authenticatedDom: !!document.querySelector('.locale-settings a[href="/me/"]'), displayedLocale: document.documentElement.lang, logoutAlertPresent: !!document.querySelector('.locale-settings [role="alert"]') };
        }, { factory, authKey }),
        new Promise((_, reject) => { readTimer = setTimeout(() => reject(new Error('FINAL_STATE_READ_DEADLINE')), Math.max(1, deadline - Date.now())); }),
      ]);
    } finally { clearTimeout(readTimer); }
    const cookies = await context.cookies();
    record.after.authCookieNames = cookies.filter(cookie => /^sb-.*(?:auth-token|session)|supabase.*(?:auth|session)/i.test(cookie.name)).map(cookie => cookie.name);
    const locale = cookies.find(cookie => cookie.name === 'ogh_preferences_v1');
    record.after.localeCookie = locale ? JSON.parse(decodeURIComponent(locale.value)) : null;
    assert.equal(documents.at(-1).generation, document.generation, 'FINAL_DOCUMENT_NOT_REPLACED_DURING_READ');
    assert.ok(!record.instrumentationFailed, 'OBSERVER_ERRORS_MUST_NOT_BECOME_PASS');
    append('FINAL_STATE_READ', { generation: document.generation });
    record.finalDocumentIdentified = true;
  } catch (error) {
    record.finalDocumentIdentified = false;
    record.observationFailure = { category: /^(FINAL_|BROWSER_|INSTRUMENTATION_)/.test(error.message) ? error.message : error.name };
  } finally {
    clearTimeout(quietTimer); clearTimeout(deadlineTimer);
    record.oldWaiter = await oldWaiter;
    record.pageErrors = events.filter(event => event.event === 'PAGE_ERROR');
    record.requestFailures = events.filter(event => event.event === 'NETWORK_LOADING_FAILED');
    if (record.instrumentationFailed) { record.finalDocumentIdentified = false; record.observationFailure = { category: 'INSTRUMENTATION_OBSERVER_ERROR' }; }
    for (const remove of listeners) remove();
    await session.detach();
  }
  return record;
}
