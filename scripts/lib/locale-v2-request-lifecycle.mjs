import assert from 'node:assert/strict';

export async function withOwnedLocaleContext({ context, activeContexts, acceptance }) {
  activeContexts.add(context);
  try {
    return await acceptance(context);
  } finally {
    activeContexts.delete(context);
    await context.close();
  }
}

export async function checkLocalAuthHeaders({ origin, createRequestContext }) {
  const url = new URL(origin);
  assert.ok(url.protocol === 'https:' && url.hostname === '127.0.0.1' && url.port
    && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash,
  'LOCAL_AUTH_HEADER_ORIGIN_REQUIRED');
  const client = await createRequestContext({ baseURL: origin, ignoreHTTPSErrors: true, timeout: 10000 });
  try {
    const results = [];
    for (const route of ['/auth/callback/', '/auth/reset-password/']) {
      const response = await client.get(new URL(route, origin).href, { maxRedirects: 0, maxRetries: 0 });
      const referrerPolicy = response.headers()['referrer-policy'];
      assert.ok(referrerPolicy === 'no-referrer', 'AUTH_REFERRER_POLICY_UNCHANGED');
      results.push(Object.freeze({ route, status: response.status(), referrerPolicy, state: 'CONTEXT_INDEPENDENT' }));
    }
    return Object.freeze(results);
  } finally {
    await client.dispose();
  }
}

export async function disposeLocaleResources(operations) {
  const errors = [];
  for (const operation of operations) {
    try { await operation(); } catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, 'LOCALE_RESOURCE_CLEANUP_FAILED');
}
