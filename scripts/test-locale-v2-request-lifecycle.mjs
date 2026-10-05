import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

let lifecycle;
try { lifecycle = await import('./lib/locale-v2-request-lifecycle.mjs'); } catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
}
const origin = 'https://127.0.0.1:55123';
function ownedContext(id, events) {
  let disposed = false;
  const request = {
    async get() {
      if (disposed) throw new Error('OWNED_REQUEST_CONTEXT_DISPOSED');
      events.push(`request:${id}`);
      return { status: () => 200, headers: () => ({ 'referrer-policy': 'no-referrer' }) };
    },
    async dispose() { disposed = true; events.push(`dispose-request:${id}`); },
  };
  return {
    request,
    async close() { await request.dispose(); events.push(`close:${id}`); },
  };
}
function independentFactory(events, policy = 'no-referrer') {
  return async options => {
    assert.deepEqual(options, { baseURL: origin, ignoreHTTPSErrors: true, timeout: 10000 });
    events.push('create-independent');
    let disposed = false;
    return {
      async get(url, options) {
        assert.equal(disposed, false);
        assert.equal(new URL(url).origin, origin);
        assert.deepEqual(options, { maxRedirects: 0, maxRetries: 0 });
        events.push(new URL(url).pathname);
        return { status: () => 200, headers: () => ({ 'referrer-policy': policy }) };
      },
      async dispose() { disposed = true; events.push('dispose-independent'); },
    };
  };
}

test('old post-matrix request RED fails solely because closing its owner disposed the client', async () => {
  const events = [], contexts = [ownedContext('old', events)];
  for (const context of contexts) await context.close();
  await assert.rejects(contexts[0].request.get(origin + '/auth/callback/'),
    { message: 'OWNED_REQUEST_CONTEXT_DISPOSED' });
  assert.deepEqual(events, ['dispose-request:old', 'close:old']);
});

test('context-bound work and HTTP assertions finish before the owning context closes', async () => {
  assert.ok(lifecycle?.withOwnedLocaleContext, 'OWNED_CONTEXT_LIFECYCLE_REQUIRED');
  const events = [], context = ownedContext('live', events), activeContexts = new Set();
  let finish;
  const pending = lifecycle.withOwnedLocaleContext({ context, activeContexts, acceptance: async owner => {
    assert.equal(owner, context);
    assert.ok(activeContexts.has(owner));
    await owner.request.get(origin + '/settings/');
    await new Promise(resolve => { finish = resolve; });
    events.push('checks-finished');
    return Object.freeze({ contextId: 'live', passed: true });
  } });
  await Promise.resolve();
  assert.deepEqual(events, ['request:live']);
  finish();
  assert.deepEqual(await pending, { contextId: 'live', passed: true });
  assert.deepEqual(events, ['request:live', 'checks-finished', 'dispose-request:live', 'close:live']);
  assert.equal(activeContexts.size, 0);
  await assert.rejects(context.request.get(origin), { message: 'OWNED_REQUEST_CONTEXT_DISPOSED' });
});

test('failed context assertion closes its page/request owner and clears the active ledger', async () => {
  assert.ok(lifecycle?.withOwnedLocaleContext);
  const events = [], context = ownedContext('failed', events), activeContexts = new Set();
  await assert.rejects(lifecycle.withOwnedLocaleContext({ context, activeContexts, acceptance: async () => {
    throw new Error('OWNED_ASSERTION_FAILED');
  } }), { message: 'OWNED_ASSERTION_FAILED' });
  assert.equal(activeContexts.size, 0);
  assert.deepEqual(events, ['dispose-request:failed', 'close:failed']);
});

test('independent local Auth header client captures immutable plain results and always disposes', async () => {
  assert.ok(lifecycle?.checkLocalAuthHeaders, 'INDEPENDENT_HEADER_OWNER_REQUIRED');
  const events = [];
  const result = await lifecycle.checkLocalAuthHeaders({ origin, createRequestContext: independentFactory(events) });
  assert.deepEqual(result, [
    { route: '/auth/callback/', status: 200, referrerPolicy: 'no-referrer', state: 'CONTEXT_INDEPENDENT' },
    { route: '/auth/reset-password/', status: 200, referrerPolicy: 'no-referrer', state: 'CONTEXT_INDEPENDENT' },
  ]);
  assert.ok(Object.isFrozen(result) && result.every(Object.isFrozen));
  assert.deepEqual(events, ['create-independent', '/auth/callback/', '/auth/reset-password/', 'dispose-independent']);
});

test('wrong Auth header fails closed without weakening the expectation and still disposes', async () => {
  assert.ok(lifecycle?.checkLocalAuthHeaders);
  const events = [];
  await assert.rejects(lifecycle.checkLocalAuthHeaders({ origin, createRequestContext: independentFactory(events, 'unsafe-policy') }),
    { message: 'AUTH_REFERRER_POLICY_UNCHANGED' });
  assert.deepEqual(events, ['create-independent', '/auth/callback/', 'dispose-independent']);
});

test('repeated completed contexts are not retained and independent checks reuse none of their clients', async () => {
  assert.ok(lifecycle?.withOwnedLocaleContext);
  const events = [], activeContexts = new Set(), results = [];
  for (const id of ['a', 'b', 'c']) {
    results.push(await lifecycle.withOwnedLocaleContext({ context: ownedContext(id, events), activeContexts,
      acceptance: async context => { await context.request.get(origin); return Object.freeze({ id, passed: true }); } }));
    assert.equal(activeContexts.size, 0);
  }
  await lifecycle.checkLocalAuthHeaders({ origin, createRequestContext: independentFactory(events) });
  assert.deepEqual(results, [{ id: 'a', passed: true }, { id: 'b', passed: true }, { id: 'c', passed: true }]);
  assert.deepEqual(events.slice(0, 9), [
    'request:a', 'dispose-request:a', 'close:a', 'request:b', 'dispose-request:b', 'close:b',
    'request:c', 'dispose-request:c', 'close:c',
  ]);
});

test('cleanup errors remain failures but do not prevent later browser/Worker/Supabase-owner cleanup', async () => {
  assert.ok(lifecycle?.disposeLocaleResources, 'ORDERED_CLEANUP_REQUIRED');
  const events = [];
  await assert.rejects(lifecycle.disposeLocaleResources([
    async () => { events.push('context'); throw new Error('OWNED_CONTEXT_CLEANUP_FAILED'); },
    async () => { events.push('browser'); }, async () => { events.push('gateway'); },
    async () => { events.push('worker'); }, async () => { events.push('tls-root'); },
  ]), error => error instanceof AggregateError && error.errors.length === 1
    && error.errors[0].message === 'OWNED_CONTEXT_CLEANUP_FAILED');
  events.push('supabase-outer-cleanup');
  assert.deepEqual(events, ['context', 'browser', 'gateway', 'worker', 'tls-root', 'supabase-outer-cleanup']);
});

test('remote or credential-bearing header origins fail before a request client is created', async () => {
  assert.ok(lifecycle?.checkLocalAuthHeaders);
  for (const origin of ['https://example.invalid', 'https://127.0.0.1.example.invalid', 'https://owned@127.0.0.1:55123']) {
    let created = false;
    await assert.rejects(lifecycle.checkLocalAuthHeaders({ origin, createRequestContext: async () => { created = true; } }));
    assert.equal(created, false);
  }
});

test('actual runner routes context ownership and independent headers through the tested lifecycle', async () => {
  const source = await readFile(new URL('./test-global-locale-v2-acceptance-local.mjs', import.meta.url), 'utf8');
  assert.ok(source.includes('await withOwnedLocaleContext('), 'RUNNER_CONTEXT_LIFECYCLE_BINDING_REQUIRED');
  assert.ok(source.includes('await checkLocalAuthHeaders('), 'RUNNER_HEADER_LIFECYCLE_BINDING_REQUIRED');
  assert.ok(source.includes('await disposeLocaleResources('), 'RUNNER_CLEANUP_LIFECYCLE_BINDING_REQUIRED');
  assert.ok(source.includes('], { primaryError });'), 'RUNNER_PRIMARY_ERROR_FORWARDING_REQUIRED');
  assert.ok(source.includes('receipt.secondaryCleanupErrors='), 'RUNNER_SECONDARY_ERROR_EVIDENCE_REQUIRED');
  assert.ok(!source.includes('contexts[0].request'));
  assert.ok(!source.includes('contexts.push(context)'));
});

test('convergence: context cleanup cannot mask the primary TimeoutError', async () => {
  const primary = Object.assign(new Error('PRIMARY'), { name: 'TimeoutError' });
  const cleanup = new assert.AssertionError({ message: 'CLEANUP' });
  const activeContexts = new Set();
  await assert.rejects(lifecycle.withOwnedLocaleContext({
    context: { async close() { throw cleanup; } }, activeContexts,
    acceptance: async () => { throw primary; },
  }), error => error === primary && error.cleanupErrors?.[0] === cleanup);
  assert.equal(activeContexts.size, 0);
});

test('convergence: resource finalization preserves PRIMARY with CLEANUP as secondary', async () => {
  const primary = Object.assign(new Error('PRIMARY'), { name: 'TimeoutError' });
  const cleanup = new assert.AssertionError({ message: 'CLEANUP' });
  const events = [];
  await assert.rejects(lifecycle.disposeLocaleResources([
    async () => { throw cleanup; }, async () => { events.push('later-cleanup'); },
  ], { primaryError: primary }), error => error === primary && error.cleanupErrors?.[0] === cleanup);
  assert.deepEqual(events, ['later-cleanup']);
});

test('convergence: cleanup-only fails closed and error-free cleanup succeeds', async () => {
  const cleanup = new assert.AssertionError({ message: 'CLEANUP' });
  await assert.rejects(lifecycle.disposeLocaleResources([async () => { throw cleanup; }]),
    error => error instanceof AggregateError && error.errors[0] === cleanup);
  assert.equal(await lifecycle.disposeLocaleResources([async () => {}]), undefined);
});

test('convergence: nested cleanup failures accumulate without exposing raw errors through JSON', async () => {
  const primary = Object.assign(new Error('PRIMARY'), { name: 'TimeoutError' });
  const first = new Error('CLEANUP_ONE'), second = new Error('CLEANUP_TWO');
  for (const cleanup of [first, second]) {
    await assert.rejects(lifecycle.disposeLocaleResources([async () => { throw cleanup; }], { primaryError: primary }), error => error === primary);
  }
  assert.deepEqual(primary.cleanupErrors, [first, second]);
  assert.ok(!JSON.stringify(primary).includes('CLEANUP'));
});
