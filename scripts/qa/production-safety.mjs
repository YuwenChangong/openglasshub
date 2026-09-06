// This module validates data only. It has no transport, process, provider, DB,
// environment or filesystem capabilities. Consumers must send only the returned
// options, use manual redirects and revalidate each destination before sending.
export const productionConfig = Object.freeze({
  defaultOrigin: 'https://openglasshub.ogh.workers.dev',
  allowedOrigins: Object.freeze(['https://openglasshub.ogh.workers.dev']),
});

// Exact paths only: no API prefix, arbitrary asset suffix or caller route override.
// Query-free callback/reset checks render architecture without exchanging tokens.
const paths = new Set([
  '/', '/devices', '/devices/', '/products', '/products/', '/forum', '/forum/',
  '/feed', '/feed/', '/circles', '/circles/', '/news', '/news/', '/search', '/search/',
  '/login', '/login/', '/auth/callback', '/auth/callback/',
  '/auth/reset-password', '/auth/reset-password/', '/sitemap.xml', '/robots.txt',
  '/api/news', '/api/forum/reports', '/api/admin/reports', '/api/admin/moderation/lexicon-health',
  '/gaze-icon-v6.svg', '/gaze-icon-v6.ico', '/gaze-icon-32-v6.png',
  '/gaze-icon-192-v6.png', '/apple-touch-icon-v6.png',
  '/brand/openglass-nav-logo.png', '/brand/logo.jpg', '/brand/logo-navbar.svg',
]);

function reject() {
  const error = new Error('PRODUCTION_ROUTE_REJECTED: production safety validation failed');
  error.name = 'ProductionSafetyError';
  error.code = 'PRODUCTION_ROUTE_REJECTED';
  error.classification = 'SAFETY';
  throw error;
}

// Do not preserve error.cause: URL parser errors and user supplied accessors may
// contain complete credentials. Every diagnostic is fixed, value-blind text.
function guard(operation) {
  try { return operation(); } catch { reject(); }
}

function record(value, keys) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) reject();
  for (const key of Reflect.ownKeys(value)) {
    if (!keys.includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) reject();
  }
}

function parseUrl(value) {
  if (typeof value !== 'string' || /[\s\\%?#]/u.test(value)) reject();
  // Refuse URL parser repair/normalization, userinfo, IP literals, wildcard hosts
  // and custom ports. A reviewed future domain is added to allowedOrigins data.
  if (!/^https:\/\/[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?)+(?:\/[^]*)?$/.test(value)) reject();
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      /^[\d.]+$/.test(url.hostname) || url.hostname.endsWith('.localhost') ||
      url.hostname.endsWith('.local')) reject();
  if (value !== url.origin && value !== url.origin + url.pathname) reject();
  return url;
}

function originOnly(value) {
  const url = parseUrl(value);
  if (url.pathname !== '/') reject();
  return url.origin;
}

function readConfig(config) {
  record(config, ['defaultOrigin', 'allowedOrigins']);
  if (!Array.isArray(config.allowedOrigins) || config.allowedOrigins.length === 0) reject();
  const allowed = config.allowedOrigins.map(originOnly);
  const defaultOrigin = originOnly(config.defaultOrigin);
  if (!allowed.includes(defaultOrigin)) reject();
  return {allowed, defaultOrigin};
}

export function validateProductionTarget(value, config = productionConfig) {
  return guard(() => {
    const {allowed, defaultOrigin} = readConfig(config);
    const origin = value === undefined ? defaultOrigin : originOnly(value);
    if (!allowed.includes(origin)) reject();
    return origin;
  });
}

export function validateProductionRequest(request, config = productionConfig) {
  return guard(() => {
    record(request, ['url', 'method', 'redirect', 'credentials', 'referrerPolicy']);
    if (request.method !== 'GET' && request.method !== 'HEAD') reject();
    if (Object.hasOwn(request, 'redirect') && request.redirect !== 'manual') reject();
    if (Object.hasOwn(request, 'credentials') && request.credentials !== 'omit') reject();
    if (Object.hasOwn(request, 'referrerPolicy') && request.referrerPolicy !== 'no-referrer') reject();
    const url = parseUrl(request.url);
    validateProductionTarget(url.origin, config);
    if (!paths.has(url.pathname)) reject();
    return Object.freeze({url: url.href, method: request.method, redirect: 'manual', credentials: 'omit', referrerPolicy: 'no-referrer'});
  });
}

// No command adapter is accepted, even if labelled read-only. Caller metadata
// belongs outside this descriptor; the result contains only validated data.
export function assertProductionCheck(check, config = productionConfig) {
  return guard(() => {
    record(check, ['kind', 'request']);
    if (check.kind !== 'http') reject();
    const request = validateProductionRequest(check.request, config);
    return Object.freeze({kind: 'http', request, safety: Object.freeze({
      productionReadOnly: true,
      productionDbConnections: 0,
      productionMutations: 0,
      providerMutations: 0,
    })});
  });
}
