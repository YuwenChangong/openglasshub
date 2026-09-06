import { types } from 'node:util';
import { normalizeCheckResult, QA_PROFILES } from '../contracts.mjs';
import { assertProductionCheck, productionConfig, validateProductionTarget } from '../production-safety.mjs';

// This transport owns no process, provider, DB, credential, or environment API.
// Discovered markup URLs are inspected as data only, never fetched.
const CASES = Object.freeze([
  ['homepage', '/', 'html'], ['devices', '/devices/', 'html'],
  ['products', '/products/', 'html'], ['forum', '/forum/', 'html'],
  ['feed', '/feed/', 'html'], ['news', '/news/', 'html'],
  ['search', '/search/', 'html'], ['login', '/login/', 'html'],
  ['callback', '/auth/callback/', 'callback'], ['reset', '/auth/reset-password/', 'reset'],
  ['news-api', '/api/news', 'json'], ['sitemap', '/sitemap.xml', 'sitemap'],
  ['media', '/brand/logo.jpg', 'media'],
  ['admin-negative', '/api/admin/reports', 'negative', 401],
  ['lexicon-negative', '/api/admin/moderation/lexicon-health', 'negative', 401],
  ['forum-method-negative', '/api/forum/reports', 'negative', 405],
].map(([name, path, assertion, status = 200]) => Object.freeze({ id: `prod:${name}`, path, assertion, status })));
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
// Sources: src/pages/devices/index.astro redirects to /products/ and
// src/pages/forum/index.astro redirects to /feed/. All other cases may only
// normalize their own trailing slash.
const REDIRECT_ALIASES = Object.freeze({
  'prod:devices': Object.freeze(['/products/']),
  'prod:forum': Object.freeze(['/feed', '/feed/']),
});
const TRANSIENT_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET']);
const MAX_BYTES = 4 * 1024 * 1024;
const SAFE_CODES = new Set(['HTTP_STATUS_MISMATCH', 'MEDIA_MISSING', 'MEDIA_REPRESENTATION_INVALID', 'WORKER_RUNTIME_FAILURE', 'PUBLIC_API_SHAPE_INVALID', 'SITEMAP_INVALID', 'PAGE_ARCHITECTURE_INVALID', 'CANONICAL_OG_INVALID', 'CALLBACK_ARCHITECTURE_INVALID', 'RESET_ARCHITECTURE_INVALID', 'STALE_ORIGIN_OUTPUT', 'RESPONSE_SIZE_LIMIT']);

function failure(code, classification = 'DETERMINISTIC') {
  const error = new Error(code);
  error.code = code;
  error.classification = classification;
  return error;
}

function descriptor(url) {
  return assertProductionCheck({ kind: 'http', request: { url, method: 'GET' } });
}

function errorPrimitive(error, field) {
  if (!error || typeof error !== 'object' || types.isProxy(error)) return undefined;
  const data = Object.getOwnPropertyDescriptor(error, field);
  return data && Object.hasOwn(data, 'value') ? data.value : undefined;
}

export function resolveProductionChecks(context = {}) {
  if (context.profile !== QA_PROFILES.PROD) throw failure('PRODUCTION_PROFILE_REQUIRED', 'VALIDATION');
  const origin = validateProductionTarget(context.origin);
  return Object.freeze({
    profile: QA_PROFILES.PROD, risk: 'LOW', areas: Object.freeze([]), blocked: false,
    selectedChecks: Object.freeze(CASES.map(({ id, path }) => Object.freeze({ id, ...descriptor(origin + path) }))),
    skippedChecks: Object.freeze(['database-replay', 'deployment', 'provider-operations', 'full-browser-e2e'].map((id) =>
      Object.freeze({ id, reason: 'production_http_read_only' }))),
  });
}

async function bodyBytes(response) {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) throw failure('RESPONSE_SIZE_LIMIT');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

function attributes(tag) {
  const result = Object.create(null);
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    if (Object.hasOwn(result, match[1].toLowerCase())) throw failure('MARKUP_ATTRIBUTE_DUPLICATE');
    result[match[1].toLowerCase()] = match[2] ?? match[3];
  }
  return result;
}

function publicOutputUrl(value, origin) {
  try {
    if (typeof value !== 'string' || /[\s\\]/u.test(value)) return false;
    const url = new URL(value);
    return url.origin === origin && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

function inspectBody(check, response, bytes, finalUrl) {
  const type = response.headers.get('content-type') ?? '';
  const origin = productionConfig.defaultOrigin;
  if (check.assertion === 'media') {
    if (!type.startsWith('image/') || bytes.length === 0) throw failure('MEDIA_MISSING');
    // The reviewed route serves a JPEG. Require its actual representation
    // signature and end-of-image marker, not just a plausible MIME header.
    // The repository JPEG has trailing metadata after EOI; preserve that valid
    // representation rather than requiring EOI to be the last two bytes.
    const eoi = bytes.findLastIndex((byte, index) => byte === 0xd9 && index > 0 && bytes[index - 1] === 0xff);
    if (type.split(';')[0].trim().toLowerCase() !== 'image/jpeg' || bytes.length < 10 ||
        bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff || eoi < 10) {
      throw failure('MEDIA_REPRESENTATION_INVALID');
    }
    return;
  }
  if (check.assertion === 'negative') return;
  const text = new TextDecoder().decode(bytes);
  if (text.includes('openglasshub.liujinyi081.workers.dev')) throw failure('STALE_ORIGIN_OUTPUT');
  if (check.assertion === 'json') {
    let data;
    try { data = JSON.parse(text); } catch { throw failure('PUBLIC_API_SHAPE_INVALID'); }
    if (!type.includes('application/json') || data?.ok !== true || !Array.isArray(data.articles)) throw failure('PUBLIC_API_SHAPE_INVALID');
    return;
  }
  if (check.assertion === 'sitemap') {
    const locations = [...text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
    if (!type.includes('xml') || !/<urlset\b/.test(text) || locations.length === 0 ||
        !locations.every((url) => publicOutputUrl(url, origin))) throw failure('SITEMAP_INVALID');
    return;
  }
  const markup = text.replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  // The response is already bounded to MAX_BYTES. Match known failure markers
  // in rendered text and retain only the fixed code, never the stack/binding.
  const visibleText = markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  if (/\b(?:Worker threw exception\b|Error 1101\b|Missing binding\s*:|Uncaught (?:TypeError|ReferenceError|Error)\s*:|Cannot read properties of (?:undefined|null)\b)/i.test(visibleText)) {
    throw failure('WORKER_RUNTIME_FAILURE');
  }
  if (!type.includes('text/html') || !/<html\b/i.test(markup) || !/<main\b/i.test(markup) || !/<title>[^<]+<\/title>/i.test(markup)) throw failure('PAGE_ARCHITECTURE_INVALID');
  const links = [...markup.matchAll(/<link\b[^>]*>/gi)].map(([tag]) => attributes(tag));
  const metas = [...markup.matchAll(/<meta\b[^>]*>/gi)].map(([tag]) => attributes(tag));
  const canonicals = links.filter((tag) => tag.rel === 'canonical');
  const ogUrls = metas.filter((tag) => tag.property === 'og:url');
  const ogImages = metas.filter((tag) => tag.property === 'og:image');
  const equivalent = (url) => publicOutputUrl(url, origin) && new URL(url).pathname.replace(/\/$/, '') === new URL(finalUrl).pathname.replace(/\/$/, '');
  if (canonicals.length !== 1 || !equivalent(canonicals[0].href) || ogUrls.length !== 1 || !equivalent(ogUrls[0].content) ||
      ogImages.length < 1 || !ogImages.every((tag) => publicOutputUrl(tag.content, origin))) throw failure('CANONICAL_OG_INVALID');
  if (check.assertion === 'callback' && !/<astro-island\b[^>]*component-url=["'][^"']*AuthCallback[^"']*["']/i.test(markup)) throw failure('CALLBACK_ARCHITECTURE_INVALID');
  if (check.assertion === 'reset' && !/<astro-island\b[^>]*component-url=["'][^"']*ResetPasswordForm[^"']*["']/i.test(markup)) throw failure('RESET_ARCHITECTURE_INVALID');
}

async function requestAttempt(check, fetchFn, signal) {
  let request = descriptor(productionConfig.defaultOrigin + check.path).request;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    signal.throwIfAborted();
    // Only the guard's frozen primitive snapshot reaches fetch. The timeout is
    // transport-owned; headers, bodies, cookies and caller options have no path.
    const { url, ...safeOptions } = request;
    const options = Object.freeze({ ...safeOptions, signal });
    const response = await fetchFn(url, options);
    if (signal.aborted) {
      await response.body?.cancel();
      signal.throwIfAborted();
    }
    if (response.redirected || (response.url && response.url !== url)) {
      await response.body?.cancel();
      throw failure('UNVALIDATED_REDIRECT_RESPONSE', 'SAFETY');
    }
    if (REDIRECTS.has(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (redirects === 3 || !location || check.assertion === 'negative') throw failure('REDIRECT_REJECTED', 'SAFETY');
      // Concatenation preserves raw slashes, escapes, query and dot segments for
      // the guard to reject; never normalize an untrusted Location first.
      const target = location.startsWith('/') ? productionConfig.defaultOrigin + location : location;
      request = descriptor(target).request;
      const nextPath = new URL(request.url).pathname;
      const sameSurface = nextPath.replace(/\/$/, '') === check.path.replace(/\/$/, '');
      if (!sameSurface && !REDIRECT_ALIASES[check.id]?.includes(nextPath)) throw failure('REDIRECT_CASE_MISMATCH', 'SAFETY');
      continue;
    }
    if (response.status !== check.status) {
      await response.body?.cancel();
      throw failure('HTTP_STATUS_MISMATCH');
    }
    inspectBody(check, response, await bodyBytes(response), url);
    return;
  }
}

export async function runProductionCheck(id, { fetchFn = globalThis.fetch } = {}) {
  const check = CASES.find((entry) => entry.id === id);
  if (!check) throw failure('PRODUCTION_CHECK_REJECTED', 'SAFETY');
  const started = Date.now();
  const events = [];
  let classification = 'DETERMINISTIC';
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    let timeout;
    try {
      await Promise.race([
        requestAttempt(check, fetchFn, controller.signal),
        new Promise((_, reject) => { timeout = setTimeout(() => {
          controller.abort();
          reject(failure('NETWORK_TIMEOUT', 'TRANSIENT'));
        }, 15_000); }),
      ]);
      events.push({ phase: attempt === 1 ? 'FIRST_ATTEMPT' : 'RETRY_ATTEMPT', code: 'HTTP_CHECK_PASS' });
      return normalizeCheckResult({ id, status: 'PASS', attempts: attempt, durationMs: Date.now() - started,
        classification: attempt === 2 ? 'TRANSIENT_RECOVERED' : 'DETERMINISTIC', diagnostics: { events } });
    } catch (error) {
      const errorCode = errorPrimitive(error, 'code');
      const errorClass = errorPrimitive(error, 'classification');
      const causeCode = errorPrimitive(errorPrimitive(error, 'cause'), 'code');
      const safety = errorClass === 'SAFETY';
      const transient = !safety && (errorClass === 'TRANSIENT' || TRANSIENT_CODES.has(errorCode) || TRANSIENT_CODES.has(causeCode));
      classification = safety ? 'SAFETY' : transient ? 'TRANSIENT' : 'DETERMINISTIC';
      // Only internally issued codes are retained; exception text and response
      // body/header/URL data are never copied to receipts or console evidence.
      const code = safety ? 'PRODUCTION_ROUTE_REJECTED' : transient ? 'NETWORK_TRANSIENT' :
        SAFE_CODES.has(errorCode) ? errorCode : 'HTTP_CHECK_FAILED';
      events.push({ phase: attempt === 1 ? 'FIRST_ATTEMPT' : 'RETRY_ATTEMPT', code });
      if (!transient || attempt === 2) break;
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }
  }
  return normalizeCheckResult({ id, status: 'FAIL', attempts: events.length, durationMs: Date.now() - started, classification, diagnostics: { events } });
}
