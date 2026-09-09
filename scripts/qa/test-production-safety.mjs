import test from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';

const module = await import('./production-safety.mjs').catch((error) => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const { productionConfig, validateProductionTarget, validateProductionRequest, assertProductionCheck } = module;
const origin = 'https://openglasshub.ogh.workers.dev';
const safe = (path = '/') => ({ url: origin + path, method: 'GET' });
const reject = (callback) => assert.throws(callback, (error) => error.code === 'PRODUCTION_ROUTE_REJECTED' && error.classification === 'SAFETY');

test('guard API is available without performing I/O', () => {
  assert.equal(typeof validateProductionTarget, 'function');
  assert.equal(typeof validateProductionRequest, 'function');
  assert.equal(typeof assertProductionCheck, 'function');
});

test('default origin and reviewed custom origins use configuration data', () => {
  assert.equal(validateProductionTarget(), origin);
  assert.equal(validateProductionTarget(origin + '/'), origin);
  const config = { defaultOrigin: 'https://hub.example.com', allowedOrigins: ['https://hub.example.com'] };
  assert.equal(validateProductionTarget(undefined, config), 'https://hub.example.com');
  assert.equal(validateProductionRequest({url: 'https://hub.example.com/devices/', method: 'HEAD'}, config).url, 'https://hub.example.com/devices/');
  assert.equal(Object.isFrozen(productionConfig.allowedOrigins), true);
});

test('targets reject non-HTTPS, credentials, wrong hosts, ports and non-origin inputs', () => {
  for (const value of [null, {}, '', 'http://openglasshub.ogh.workers.dev', 'https://evil.example',
    origin + '.evil.example', 'https://user:sentinel@openglasshub.ogh.workers.dev', origin + ':444',
    origin + '/devices/', origin + '?token=sentinel', origin + '#sentinel', origin + '?', origin + '#',
    ' ' + origin, origin + '\n', 'https://openglasshub.ogh.workers.dev./', 'https://127.0.0.1',
    'https://[::1]', 'https://openglasshub.ogh.workers.dev\\@evil.example']) reject(() => validateProductionTarget(value));
});

test('malformed configuration cannot disable or broaden guards implicitly', () => {
  for (const config of [null, {}, {defaultOrigin: origin, allowedOrigins: []},
    {defaultOrigin: origin, allowedOrigins: ['*']}, {defaultOrigin: origin, allowedOrigins: [origin + '/api']},
    {defaultOrigin: origin, allowedOrigins: ['http://example.com', origin]},
    {defaultOrigin: 'https://evil.example', allowedOrigins: [origin]},
    {defaultOrigin: origin, allowedOrigins: [origin], routes: ['*']}]) reject(() => validateProductionTarget(origin, config));
});

test('only explicit public and protected-negative GET/HEAD requests produce frozen safe options', () => {
  for (const path of ['/', '/devices/', '/products/', '/forum/', '/feed/', '/news/', '/search/',
    '/login/', '/auth/callback/', '/auth/reset-password/', '/sitemap.xml', '/robots.txt',
    '/api/admin/reports', '/api/forum/reports', '/api/admin/moderation/lexicon-health',
    '/gaze-icon-v6.svg', '/brand/openglass-nav-logo.png']) {
    for (const method of ['GET', 'HEAD']) {
      const result = validateProductionRequest({url: origin + path, method});
      assert.deepEqual(result, {url: origin + path, method, redirect: 'manual', credentials: 'omit', referrerPolicy: 'no-referrer'});
      assert.equal(Object.isFrozen(result), true);
    }
  }
});

test('non-read-only methods, body and unknown fetch options are refused', () => {
  for (const method of ['POST', 'DELETE', 'PUT', 'PATCH', 'OPTIONS', 'TRACE', 'get', '', null]) reject(() => validateProductionRequest({...safe(), method}));
  for (const body of ['', null, 'sentinel', new Uint8Array()]) reject(() => validateProductionRequest({...safe(), body}));
  for (const extra of [{headers: {authorization: 'sentinel'}}, {headers: {}}, {credentials: 'include'},
    {redirect: 'follow'}, {redirect: 'error'}, {dispatcher: {}}, {agent: {}}, {methodOverride: 'POST'}]) reject(() => validateProductionRequest({...safe(), ...extra}));
});

test('unknown, destructive and ambiguous URL paths fail before network operations', () => {
  for (const path of ['/api/admin/devices/1/delete', '/auth/logout', '/api/auth/resend-confirmation',
    '/unknown', '/rest/v1/devices', '/api/devices', '/api/users/me/profile', '/devices/../',
    '/%2e%2e/', '/devices//', '//evil.example/', '/devices/?token=sentinel', '/search/?q=sentinel',
    '/auth/callback/?code=sentinel', '/#access_token=sentinel', '/?', '/#', '/%64evices/', '/DEVICES/', '/devices;delete/']) {
    reject(() => validateProductionRequest(safe(path)));
  }
  reject(() => validateProductionRequest({url: '/devices/', method: 'GET'}));
});

test('redirect destinations must independently satisfy target and route constraints', () => {
  assert.equal(validateProductionRequest({...safe('/login/'), redirect: 'manual'}).redirect, 'manual');
  for (const url of ['http://openglasshub.ogh.workers.dev/', 'https://evil.example/', origin + '/auth/logout', origin + '/login/?token=sentinel']) reject(() => validateProductionRequest({url, method: 'GET'}));
});

test('reviewed public news GET is available while its write methods remain closed', () => {
  assert.equal(validateProductionRequest(safe('/api/news')).url, origin + '/api/news');
  reject(() => validateProductionRequest({...safe('/api/news'), method: 'POST'}));
});

test('only HTTP descriptors are allowed; no provider, DB or subprocess adapter can pass', () => {
  const check = assertProductionCheck({kind: 'http', request: safe()});
  assert.equal(check.request.url, origin + '/');
  assert.deepEqual(check.safety, {productionReadOnly: true, productionDbConnections: 0, productionMutations: 0, providerMutations: 0});
  assert.equal(Object.isFrozen(check.safety), true);
  for (const kind of ['command', 'database', 'provider', 'browser', 'shell', 'sql', 'http-request']) reject(() => assertProductionCheck({kind, request: safe()}));
  for (const extra of [{command: 'psql'}, {argv: ['wrangler', 'deploy']}, {run: () => {}}, {sql: 'SELECT 1'}, {env: {}}, {destructive: true}, {safety: {productionMutations: 0}}]) reject(() => assertProductionCheck({kind: 'http', request: safe(), ...extra}));
});

test('all diagnostic forms are value-blind for sentinel credentials and malformed objects', () => {
  const sentinel = 'SECRET_SENTINEL_7fab2026';
  const cases = [() => validateProductionTarget(`https://user:${sentinel}@openglasshub.ogh.workers.dev`),
    () => validateProductionRequest(safe(`/?token=${sentinel}`)),
    () => validateProductionRequest({...safe(), method: sentinel}),
    () => assertProductionCheck({kind: sentinel}),
    () => assertProductionCheck({kind: 'http', request: safe(), id: sentinel}),
    () => validateProductionTarget(origin, {defaultOrigin: origin, allowedOrigins: [sentinel]}),
    () => validateProductionRequest({get url() { throw new Error(sentinel); }, method: 'GET'})];
  for (const call of cases) {
    let caught;
    try { call(); } catch (error) { caught = error; }
    assert.ok(caught, 'unsafe value must be rejected');
    assert.equal(caught.code, 'PRODUCTION_ROUTE_REJECTED');
    for (const diagnostic of [String(caught), caught.stack, JSON.stringify(caught), inspect(caught)]) assert.equal(diagnostic.includes(sentinel), false);
  }
});

test('request proxy cannot swap a validated GET into a returned POST', () => {
  let methodReads = 0;
  const request = new Proxy(safe(), {
    get(target, key) {
      if (key === 'method') return ++methodReads === 1 ? 'GET' : 'POST';
      return Reflect.get(target, key);
    },
  });
  reject(() => validateProductionRequest(request));
  assert.equal(methodReads, 0);
});

test('request proxy cannot inject a secret sentinel into returned method or diagnostics', () => {
  const sentinel = 'SECRET_SENTINEL_PROXY_7fab2026';
  let methodReads = 0;
  const request = new Proxy(safe(), {
    get(target, key) {
      if (key === 'method') return ++methodReads === 1 ? 'GET' : sentinel;
      return Reflect.get(target, key);
    },
  });
  let caught;
  try { assertProductionCheck({kind: 'http', request}); } catch (error) { caught = error; }
  assert.ok(caught, 'proxy must fail closed');
  assert.equal(caught.code, 'PRODUCTION_ROUTE_REJECTED');
  assert.equal(methodReads, 0);
  for (const diagnostic of [String(caught), caught.stack, JSON.stringify(caught), inspect(caught)]) assert.equal(diagnostic.includes(sentinel), false);
});

test('configuration and check wrappers cannot proxy around input validation', () => {
  reject(() => validateProductionTarget(undefined, new Proxy(productionConfig, {})));
  reject(() => validateProductionTarget(undefined, {defaultOrigin: origin, allowedOrigins: new Proxy([origin], {})}));
  reject(() => assertProductionCheck(new Proxy({kind: 'http', request: safe()}, {})));
});

test('allowlist code cannot mutate a plain request between validation and output', () => {
  const request = safe();
  const allowedOrigins = [origin];
  allowedOrigins.map = () => {
    request.method = 'POST';
    return [origin];
  };
  reject(() => validateProductionRequest(request, {defaultOrigin: origin, allowedOrigins}));
  assert.equal(request.method, 'GET');
});
