const fs = require('node:fs');
const path = require('node:path');
const { resolveSiteOrigin } = require('../src/lib/site-origin.ts');
const { JSDOM, VirtualConsole } = require('jsdom');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const distIndex = args.indexOf('--dist');
const dist = path.resolve(root, distIndex < 0 ? 'dist' : args[distIndex + 1]);
const client = path.join(dist, 'client');
let pass = 0, expectedOrigin, activeRoute = 'SETUP', worker, externalAttempts = 0;
let redirectEvidence;
let languageEvidence;
const fixtureOrigin = 'http://127.0.0.1:54321';
const fixtureAnonKey = 'local-seo-anon-key';
let fixtureRequests = 0, unexpectedFixture, observedStatus;
const fixturePaths = {
  '/': ['/rest/v1/posts', '/rest/v1/circles', '/rest/v1/news_articles'],
  '/products/': ['/rest/v1/devices'],
};
const fixtureCounts = { posts: 0, circles: 0, news_articles: 0, devices: 0 };
function isAllowedFixture(request, route = activeRoute) {
  const url = new URL(request.url);
  if (url.origin !== fixtureOrigin || request.method !== 'GET' || !Object.hasOwn(fixturePaths, route) || !fixturePaths[route].includes(url.pathname)) return false;
  const query = url.searchParams;
  const equals = (key, value) => query.getAll(key).length === 1 && query.get(key) === value;
  const boundedLimit = (max) => equals('limit', query.get('limit')) && /^[1-9]\d*$/.test(query.get('limit') ?? '') && Number(query.get('limit')) <= max;
  if (url.pathname === '/rest/v1/posts') return equals('status', 'eq.published') && equals('moderation_status', 'eq.published') && equals('circles.status', 'eq.active') && boundedLimit(10);
  if (url.pathname === '/rest/v1/circles') return equals('status', 'eq.active') && boundedLimit(8);
  if (url.pathname === '/rest/v1/news_articles') return equals('status', 'eq.published');
  return true;
}
function interceptOutbound(request) {
  if (isAllowedFixture(request)) {
    fixtureRequests++;
    const table = new URL(request.url).pathname.split('/').at(-1);
    fixtureCounts[table]++;
    return new Response('[]', { status: 200, headers: {
      'content-type': 'application/json', ...(table === 'news_articles' ? { 'content-range': '*/0' } : {}),
    } });
  }
  externalAttempts++;
  const url = new URL(request.url);
  if (url.origin === fixtureOrigin) {
    unexpectedFixture = { method: request.method, path: /^\/(?:rest|auth|storage)\/v1\/[a-z_]+$/.test(url.pathname) ? url.pathname : 'UNEXPECTED_PATH_REDACTED' };
  }
  return new Response('SEO_OUTBOUND_FORBIDDEN', { status: 599 });
}

function check(label, ok, classification = 'SEO_TEST_HARNESS_DEFECT', observedOrigin = 'NOT_APPLICABLE') {
  if (!ok) throw Object.assign(new Error(label), { classification, route: activeRoute, observedOrigin });
  pass++;
  console.log('PASS: ' + label);
}
function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}
function documentFor(html) {
  return new JSDOM(html, { virtualConsole: new VirtualConsole() }).window.document;
}
function originFor(value) {
  try { return new URL(value).origin; } catch { return 'INVALID'; }
}
function metadata(document, selector) {
  return document.querySelector(selector)?.getAttribute('content')?.trim();
}
function auditPage(html, route, locale) {
  const document = documentFor(html);
  try {
    const canonicals = [...document.querySelectorAll('link[rel="canonical"]')].map(link => link.href);
    const canonical = expectedOrigin + route;
    check('one configured same-route canonical', canonicals.length === 1 && canonicals[0] === canonical,
      'REAL_CANONICAL_REGRESSION', canonicals.map(originFor).join(',') || 'MISSING');
    check('no obsolete site origin', !html.includes('openglass.gaze.dev'), 'REAL_CANONICAL_REGRESSION');
    languageEvidence = { requested: locale, expected: locale, observed: document.documentElement.lang || 'ABSENT' };
    check('request-resolved supported html language', document.documentElement.lang === locale, 'REAL_METADATA_REGRESSION');
    languageEvidence = undefined;
    check('title exists', Boolean(document.title.trim()), 'REAL_METADATA_REGRESSION');
    for (const selector of ['meta[name="description"]', 'meta[property="og:title"]', 'meta[property="og:description"]']) {
      check(selector + ' exists', Boolean(metadata(document, selector)), 'REAL_METADATA_REGRESSION');
    }
    const ogUrls = [...document.querySelectorAll('meta[property="og:url"]')].map(tag => tag.content);
    check('one configured same-route og:url', ogUrls.length === 1 && ogUrls[0] === canonical,
      'REAL_CANONICAL_REGRESSION', ogUrls.map(originFor).join(',') || 'MISSING');
    const iconHrefs = [...document.querySelectorAll('link')].map(link => link.getAttribute('href'));
    check('no obsolete favicon', !iconHrefs.includes('/favicon.svg'), 'REAL_METADATA_REGRESSION');
    for (const icon of ['gaze-icon-v6.ico', 'gaze-icon-v6.svg', 'apple-touch-icon-v6']) {
      check(icon + ' referenced', iconHrefs.some(href => href?.includes(icon)), 'REAL_METADATA_REGRESSION');
    }
    check('no placeholder links', document.querySelectorAll('a[href="#"]').length === 0, 'REAL_METADATA_REGRESSION');
    check('no fake Discord/WeChat or prefixed locale routes', [...document.querySelectorAll('a[href]')].every(link =>
      !/^(?:https:\/\/(?:discord\.gg|weixin)|\/(?:en|zh(?:-CN)?)\/)/i.test(link.getAttribute('href'))), 'REAL_ROUTE_REGRESSION');
    check('no server-only credential material in HTML', !/SUPABASE_SERVICE_ROLE_KEY|["']role["']\s*:\s*["']service_role/.test(html), 'REAL_METADATA_REGRESSION');
    return { canonical: canonicals[0], structuredData: document.querySelectorAll('script[type="application/ld+json"]').length };
  } finally { document.defaultView.close(); }
}

async function main() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') {
      externalAttempts++;
      throw Object.assign(new Error('EXTERNAL_REQUEST_BLOCKED'), { classification: 'UNEXPECTED_EXTERNAL_REQUEST' });
    }
    return originalFetch(input, init);
  };
  try {
    const { resolveWorkersBuildEnvironment } = await import('./lib/workers-build-environment.mjs');
    const { unstable_readConfig, unstable_getMiniflareWorkerOptions } = await import('wrangler');
    const { Miniflare, convertV4MiniflareOptions, MiniflareOptionsSchema } = await import('miniflare');
    check('MINIFLARE_CONVERTER_AVAILABLE=true', typeof convertV4MiniflareOptions === 'function');
    const fixtureUrl = new URL(fixtureOrigin);
    check('fixture is HTTP loopback with explicit port', fixtureUrl.protocol === 'http:' && fixtureUrl.hostname === '127.0.0.1' && Boolean(fixtureUrl.port));
    check('fixture anonymous placeholder is nonempty', fixtureAnonKey.length > 0);
    check('fixture permits exact products devices GET', isAllowedFixture(new Request(fixtureOrigin + '/rest/v1/devices?select=*&order=name.asc'), '/products/'));
    for (const [url, method] of [
      [fixtureOrigin + '/rest/v1/devices', 'POST'], [fixtureOrigin + '/rest/v1/devices', 'PATCH'],
      [fixtureOrigin + '/rest/v1/devices', 'DELETE'], [fixtureOrigin + '/rest/v1/posts', 'GET'],
      [fixtureOrigin + '/auth/v1/user', 'GET'], [fixtureOrigin + '/storage/v1/object', 'GET'],
      [fixtureOrigin + '/rest/v1/rpc/test', 'GET'], ['http://127.0.0.1:54322/rest/v1/devices', 'GET'],
      ['https://127.0.0.1:54321/rest/v1/devices', 'GET'], ['https://seo-forbidden.invalid/rest/v1/devices', 'GET'],
    ]) check('fixture rejects unapproved request shape', !isAllowedFixture(new Request(url, { method }), '/products/'));
    const homepageQueries = [
      '/rest/v1/posts?status=eq.published&moderation_status=eq.published&circles.status=eq.active&limit=10',
      '/rest/v1/circles?status=eq.active&limit=8',
      '/rest/v1/news_articles?status=eq.published&limit=1',
    ];
    for (const query of homepageQueries) {
      const request = new Request(fixtureOrigin + query);
      check('homepage public read allowed', isAllowedFixture(request, '/'));
      for (const route of ['/products/', '/guides/', '/developers/', '/about/', '/terms/', '/privacy/', '/community-guidelines/', '/search/']) {
        check('homepage data denied on other route', !isAllowedFixture(request, route));
      }
      for (const method of ['POST', 'PATCH', 'DELETE']) check('homepage mutation denied', !isAllowedFixture(new Request(fixtureOrigin + query, { method }), '/'));
      check('homepage unfiltered data denied', !isAllowedFixture(new Request(fixtureOrigin + query.split('?')[0]), '/'));
      if (request.url && new URL(request.url).pathname === '/rest/v1/circles') {
        const negativeUrl = new URL(request.url);
        negativeUrl.searchParams.set('status', 'eq.hidden');
        check('circles negative input differs from valid active query', negativeUrl.href !== request.url && negativeUrl.searchParams.get('status') !== 'eq.active');
        check('homepage inactive circles denied', !isAllowedFixture(new Request(negativeUrl), '/'));
      } else {
        check('homepage unpublished data denied', !isAllowedFixture(new Request((fixtureOrigin + query).replace('eq.published', 'eq.draft')), '/'));
      }
      check('homepage different fixture origin denied', !isAllowedFixture(new Request(('http://127.0.0.1:54322' + query)), '/'));
    }
    for (const route of ['/', '/terms/', '/guides/', '/search/']) check('devices data route isolated', !isAllowedFixture(new Request(fixtureOrigin + '/rest/v1/devices'), route));
    for (const query of [homepageQueries[0].replace('limit=10', 'limit=11'), homepageQueries[1].replace('limit=8', 'limit=9'), homepageQueries[0].replace('circles.status=eq.active', 'circles.status=eq.hidden'), homepageQueries[0] + '&status=eq.draft']) {
      check('homepage unsafe filters or limits denied', !isAllowedFixture(new Request(fixtureOrigin + query), '/'));
    }
    const environment = resolveWorkersBuildEnvironment(process.env);
    const source = unstable_readConfig({ config: path.join(root, 'wrangler.toml'), env: environment }, { hideWarnings: true });
    check('selected build environment supplies SITE_ORIGIN', typeof source.vars?.SITE_ORIGIN === 'string' && source.vars.SITE_ORIGIN.trim() !== '');
    expectedOrigin = resolveSiteOrigin(source.vars.SITE_ORIGIN);
    const configPath = path.join(dist, 'server', 'wrangler.json');
    const config = unstable_readConfig({ config: configPath }, { hideWarnings: true });
    // Do not load .dev.vars, caller credentials or provider values into the local Worker.
    config.vars = { SITE_ORIGIN: expectedOrigin, SUPABASE_URL: fixtureOrigin, SUPABASE_ANON_KEY: fixtureAnonKey, AUTH_CAPTCHA_MODE: 'off' };
    for (const binding of [...(config.kv_namespaces ?? []), ...(config.r2_buckets ?? []), ...(config.services ?? [])]) {
      check('no remote resource binding', binding.remote !== true);
    }
    const options = unstable_getMiniflareWorkerOptions(config, undefined, { envFiles: [], overrides: { enableContainers: false } });
    check('no external auxiliary Worker', options.externalWorkers.length === 0);
    const serverRoot = path.dirname(configPath);
    const entry = path.resolve(serverRoot, config.main);
    const relativeEntry = path.relative(serverRoot, entry);
    check('built entry remains inside server artifact', relativeEntry !== '..' && !relativeEntry.startsWith('..' + path.sep) && !path.isAbsolute(relativeEntry));
    const modules = walk(serverRoot).filter(file => /\.(?:mjs|js)$/.test(file)).sort((a, b) => a === entry ? -1 : b === entry ? 1 : a.localeCompare(b)).map(file => ({ type: 'ESModule', path: file }));
    check('generated Worker entry exists', modules.some(module => module.path === entry));
    const localWorkerOptions = { ...options.workerOptions };
    delete localWorkerOptions.modulesRules;
    const miniflareOptions = convertV4MiniflareOptions({
      host: '127.0.0.1', port: 0, cf: {},
      workers: [{ ...localWorkerOptions, modules, modulesRoot: serverRoot,
        outboundService: interceptOutbound,
      }],
    });
    MiniflareOptionsSchema.parse(miniflareOptions);
    console.log('WRANGLER_EXTERNAL_WORKER_COUNT=0');
    console.log('MINIFLARE_OPTIONS_CONVERSION=PASS');
    console.log('LOCAL_SUPABASE_FIXTURE_ORIGIN=127.0.0.1');
    console.log('LOCAL_SUPABASE_FIXTURE_TABLE=devices');
    console.log('LOCAL_SUPABASE_FIXTURE_MODE=EMPTY_PUBLIC_LIST');
    if (args.includes('--validate-options-only')) return;
    worker = new Miniflare(miniflareOptions);
    const localUrl = await worker.ready;
    check('Worker listener is loopback', localUrl.hostname === '127.0.0.1' && localUrl.protocol === 'http:');
    console.log('SEO_LOCAL_WORKER_ORIGIN=127.0.0.1');
    async function request(route, locale = 'en') {
      activeRoute = route;
      const response = await fetch(new URL(route, localUrl), {
        redirect: 'manual', headers: { 'accept-language': locale }, signal: AbortSignal.timeout(30000),
      });
      observedStatus = response.status;
      const html = await response.text();
      check('no Worker outbound request', externalAttempts === 0, 'UNEXPECTED_EXTERNAL_REQUEST');
      return { response, html };
    }
    let structuredData = 0;
    const routes = ['/', '/products/', '/guides/', '/developers/', '/about/', '/terms/', '/privacy/', '/community-guidelines/', '/search/'];
    for (const route of routes) {
      const { response, html } = await request(route);
      check('public route HTTP200: ' + route, response.status === 200, 'REAL_ROUTE_REGRESSION');
      check('public route serves HTML', /text\/html/i.test(response.headers.get('content-type') ?? ''), 'REAL_ROUTE_REGRESSION');
      structuredData += auditPage(html, route, 'en').structuredData;
      if (route === '/') {
        check('homepage fixture exercised all three public tables', fixtureCounts.posts >= 1 && fixtureCounts.circles >= 1 && fixtureCounts.news_articles >= 1);
      }
    }
    const languageResponses = [];
    for (const locale of ['zh-CN', 'en']) {
      const { response, html } = await request('/terms/', locale);
      check('same language fixture route HTTP200', response.status === 200, 'REAL_ROUTE_REGRESSION');
      languageResponses.push(auditPage(html, '/terms/', locale).canonical);
    }
    check('canonical unchanged across request languages', languageResponses[0] === languageResponses[1], 'REAL_CANONICAL_REGRESSION');
    for (const [route, target, exactStatus] of [['/devices/', '/products/', 301], ['/gaze-os/', '/gaze-launcher/'], ['/community/', '/feed/']]) {
      const { response } = await request(route);
      const location = response.headers.get('location');
      let destination;
      try { if (location) destination = new URL(location, localUrl); } catch { /* Invalid Location fails the contract below. */ }
      redirectEvidence = {
        observedStatus: response.status,
        observedPath: destination ? (['/products/', '/gaze-launcher/', '/feed/'].includes(destination.pathname) ? destination.pathname : 'UNEXPECTED_PATH_REDACTED') : 'MISSING_OR_INVALID',
        expectedStatus: exactStatus ?? '301|302|303|307|308',
        expectedPath: target,
      };
      check('configured redirect status and destination: ' + route,
        (exactStatus ? response.status === exactStatus : [301, 302, 303, 307, 308].includes(response.status)) && Boolean(destination) && destination.pathname === target, 'REAL_ROUTE_REGRESSION');
      check('redirect stays on local or configured origin', Boolean(destination) && [localUrl.origin, expectedOrigin].includes(destination.origin), 'REAL_ROUTE_REGRESSION');
      redirectEvidence = undefined;
    }
    activeRoute = 'STATIC_ARTIFACTS';
    const sitemapFiles = walk(client).filter(file => /^sitemap.*\.xml$/.test(path.basename(file)));
    check('generated sitemap artifact exists', sitemapFiles.length > 0, 'REAL_SITEMAP_REGRESSION');
    const robots = fs.readFileSync(path.join(client, 'robots.txt'), 'utf8');
    const robotsOrigins = [...robots.matchAll(/^Sitemap:\s+(\S+)$/gmi)].map(match => originFor(match[1]));
    check('robots Sitemap URLs match build origin', robotsOrigins.length > 0 && robotsOrigins.every(origin => origin === expectedOrigin), 'REAL_SITEMAP_REGRESSION', [...new Set(robotsOrigins)].join(',') || 'MISSING');
    const sitemapOrigins = sitemapFiles.flatMap(file => [...fs.readFileSync(file, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => originFor(match[1])));
    check('all sitemap locations match build origin', sitemapOrigins.length > 0 && sitemapOrigins.every(origin => origin === expectedOrigin), 'REAL_SITEMAP_REGRESSION', [...new Set(sitemapOrigins)].join(',') || 'MISSING');
    check('repository-owned search route exists', fs.existsSync(path.join(root, 'src/pages/search/index.astro')));
    const astroConfig = fs.readFileSync(path.join(root, 'astro.config.mjs'), 'utf8');
    check('approved SSR Starlight disables Pagefind', /prerender:\s*false/.test(astroConfig) && /pagefind:\s*false/.test(astroConfig));
    check('no stale Pagefind artifact', !fs.existsSync(path.join(client, 'pagefind')));
    check('structured data intent retained', structuredData > 0 || fs.readFileSync(path.join(root, 'src/pages/posts/[id].astro'), 'utf8').includes('application/ld+json'));
    const missing = await request('/__seo_audit_missing_route_9f5f0c__/');
    check('impossible route HTTP404', missing.response.status === 404, 'REAL_404_REGRESSION');
    const document = documentFor(missing.html);
    try {
      check('404 retains noindex', /noindex/i.test(metadata(document, 'meta[name="robots"]') ?? missing.response.headers.get('x-robots-tag') ?? ''), 'REAL_404_REGRESSION');
    } finally { document.defaultView.close(); }
    check('no outbound activity', externalAttempts === 0, 'UNEXPECTED_EXTERNAL_REQUEST');
    check('devices public fixture exercised', fixtureCounts.devices >= 1);
    console.log(`SEO_SSR_AUDIT=PASS CHECKS=${pass} SSR_ROUTES=${routes.length}`);
  } finally {
    await worker?.dispose();
    globalThis.fetch = originalFetch;
    console.log('SEO_PRODUCTION_REQUESTS=0');
    console.log('SEO_PROVIDER_REQUESTS=0');
    console.log('SEO_BLOCKED_OUTBOUND_ATTEMPTS=' + externalAttempts);
    console.log('SEO_LOCAL_SUPABASE_FIXTURE_REQUESTS=' + fixtureRequests);
    console.log('SEO_FIXTURE_POSTS_REQUESTS=' + fixtureCounts.posts);
    console.log('SEO_FIXTURE_CIRCLES_REQUESTS=' + fixtureCounts.circles);
    console.log('SEO_FIXTURE_NEWS_REQUESTS=' + fixtureCounts.news_articles);
    console.log('SEO_FIXTURE_DEVICES_REQUESTS=' + fixtureCounts.devices);
  }
}
main().catch(error => {
  console.error('SEO_SSR_AUDIT=FAIL');
  console.error('FIRST_FAIL=' + (error.classification ? error.message : 'LOCAL_AUDIT_SETUP_OR_TRANSPORT'));
  console.error('FAILURE_CLASS=' + (error.classification ?? 'SEO_TEST_HARNESS_DEFECT'));
  console.error('ROUTE=' + (error.route ?? activeRoute));
  console.error('EXPECTED_ORIGIN=' + (expectedOrigin ?? 'UNKNOWN'));
  console.error('OBSERVED_ORIGIN=' + (error.observedOrigin ?? 'UNKNOWN'));
  if (languageEvidence) {
    console.error('REQUEST_ACCEPT_LANGUAGE=' + languageEvidence.requested);
    console.error('EXPECTED_HTML_LANG=' + languageEvidence.expected);
    console.error('OBSERVED_HTML_LANG=' + languageEvidence.observed);
  }
  if (observedStatus !== undefined && !redirectEvidence) {
    console.error('OBSERVED_STATUS=' + observedStatus);
    console.error('EXPECTED_STATUS=' + (activeRoute === '/__seo_audit_missing_route_9f5f0c__/' ? 404 : 200));
  }
  if (unexpectedFixture) {
    console.error('UNEXPECTED_FIXTURE_METHOD=' + unexpectedFixture.method);
    console.error('UNEXPECTED_FIXTURE_PATH=' + unexpectedFixture.path);
  }
  if (redirectEvidence) {
    console.error('OBSERVED_STATUS=' + redirectEvidence.observedStatus);
    console.error('EXPECTED_STATUS=' + redirectEvidence.expectedStatus);
    console.error('OBSERVED_LOCATION_PATH=' + redirectEvidence.observedPath);
    console.error('EXPECTED_LOCATION_PATH=' + redirectEvidence.expectedPath);
  }
  // Raw provider/Worker errors may contain binding values; never print them.
  if (!error.classification) console.error('SAFE_ERROR_NAME=' + error.name);
  if (Array.isArray(error.issues)) {
    const keys = error.issues.map(issue => issue.path.filter(part => typeof part === 'string').join('.'));
    console.error('SAFE_OPTION_KEY_IF_KNOWN=' + [...new Set(keys)].join(','));
  }
  process.exitCode = 1;
});
