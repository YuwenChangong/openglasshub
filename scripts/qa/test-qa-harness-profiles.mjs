import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { getCheck } from './check-registry.mjs';
import { getArea, manifest } from './manifest.mjs';
import { runTargetedBrowserCheck } from './checks/playwright.mjs';
import { resolveFastChecks } from './profiles/fast.mjs';
import { resolveFeatureChecks } from './profiles/feature.mjs';
import {
  resolveReleaseChecks,
  runReleaseCheck,
  stopLocalWorker,
  terminatePosixProcessTree,
} from './profiles/release.mjs';
import { executeFastRun, executeFeatureRun, executeReleaseRun, renderProfileOutput } from './runner.mjs';

const FOUNDATION = [
  'git-diff-check',
  'qa-harness-core',
  'qa-harness-executor',
  'qa-harness-manifest',
  'qa-harness-profiles',
  'qa-harness-receipt',
  'qa-harness-risk',
];

const FORBIDDEN_EXPENSIVE = [
  'database-replay',
  'deployment',
  'full-browser-e2e',
  'production-smoke',
  'provider-operations',
];
const RUNNER = fileURLToPath(new URL('./runner.mjs', import.meta.url));

const PROD_ORIGIN = 'https://openglasshub.ogh.workers.dev';
async function productionModule() {
  const module = await import('./profiles/prod.mjs').catch(() => null);
  assert.ok(module?.resolveProductionChecks && module?.runProductionCheck, 'PROD implementation must exist');
  return module;
}

function productionHtml(path = '/') {
  return `<!doctype html><html><head><title>OpenGlass Hub</title><link rel="canonical" href="${PROD_ORIGIN}${path}"><meta property="og:url" content="${PROD_ORIGIN}${path}"><meta property="og:image" content="${PROD_ORIGIN}/brand/logo.jpg"></head><body><main>OpenGlass Hub</main><astro-island component-url="/_astro/AuthCallback.js"></astro-island><astro-island component-url="/_astro/ResetPasswordForm.js"></astro-island></body></html>`;
}

test('PROD requests are approved read-only snapshots and cover actual surfaces', async () => {
  const { resolveProductionChecks, runProductionCheck } = await productionModule();
  const selection = resolveProductionChecks({ profile: 'PRODUCTION_SMOKE' });
  const paths = selection.selectedChecks.map(({ request }) => new URL(request.url).pathname);
  for (const path of ['/', '/devices/', '/products/', '/forum/', '/feed/', '/news/', '/search/', '/login/', '/auth/callback/', '/auth/reset-password/', '/api/news', '/sitemap.xml', '/brand/logo.jpg', '/api/admin/reports']) assert.ok(paths.includes(path), path);
  assert.ok(!paths.some((path) => path.includes('compare')));
  for (const check of selection.selectedChecks) {
    assert.equal(check.kind, 'http');
    assert.ok(Object.isFrozen(check.request));
    assert.equal(check.request.method, 'GET');
  }
  assert.throws(() => resolveProductionChecks({ profile: 'PRODUCTION_SMOKE', origin: 'https://attacker.example' }), /PRODUCTION_ROUTE_REJECTED/);
  let calls = 0;
  const result = await runProductionCheck('prod:homepage', { fetchFn: async (url, options) => {
    calls++;
    assert.equal(url, PROD_ORIGIN + '/');
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.referrerPolicy, 'no-referrer');
    assert.equal(options.headers, undefined);
    assert.equal(options.body, undefined);
    assert.ok(Object.isFrozen(options));
    return new Response(productionHtml(), { headers: { 'content-type': 'text/html' } });
  }});
  assert.equal(result.status, 'PASS');
  assert.equal(calls, 1);
});

test('PROD fails systemic 5xx without retry or response-body disclosure', async () => {
  const { runProductionCheck } = await productionModule();
  let calls = 0;
  const result = await runProductionCheck('prod:homepage', { fetchFn: async () => {
    calls++;
    return new Response('private-unlabelled-sentinel', { status: 503 });
  }});
  assert.equal(result.status, 'FAIL');
  assert.equal(result.diagnostics.events[0].code, 'HTTP_STATUS_MISMATCH');
  assert.equal(calls, 1);
  assert.ok(!JSON.stringify(result).includes('private-unlabelled-sentinel'));
});

test('PROD rejects malformed canonical and OG output with no deterministic retry', async () => {
  const { runProductionCheck } = await productionModule();
  for (const body of [productionHtml().replace('rel="canonical"', 'rel="alternate"'), productionHtml().replaceAll(PROD_ORIGIN, 'https://old.example'), productionHtml().replace('property="og:url"', 'property="og:invalid"')]) {
    const result = await runProductionCheck('prod:homepage', { fetchFn: async () => new Response(body, { headers: { 'content-type': 'text/html' } }) });
    assert.equal(result.status, 'FAIL');
    assert.equal(result.attempts, 1);
  }
});

test('PROD catches missing public media and unexpectedly public protected endpoints', async () => {
  const { runProductionCheck } = await productionModule();
  for (const [id, status] of [['prod:media', 404], ['prod:admin-negative', 200], ['prod:forum-method-negative', 200]]) {
    const result = await runProductionCheck(id, { fetchFn: async () => new Response('wrong', { status }) });
    assert.equal(result.status, 'FAIL');
    assert.equal(result.attempts, 1);
  }
  const emptyMedia = await runProductionCheck('prod:media', { fetchFn: async () => new Response('', { headers: { 'content-type': 'image/jpeg' } }) });
  assert.equal(emptyMedia.status, 'FAIL');
});

test('PROD retains FIRST_ATTEMPT and RETRY_ATTEMPT when one network failure recovers', async () => {
  const { runProductionCheck } = await productionModule();
  let calls = 0;
  const result = await runProductionCheck('prod:homepage', { fetchFn: async () => {
    if (++calls === 1) throw new TypeError('https://user:private-sentinel@evil.test?token=private', { cause: { code: 'ECONNRESET' } });
    return new Response(productionHtml(), { headers: { 'content-type': 'text/html' } });
  }});
  assert.equal(result.status, 'PASS');
  assert.equal(result.attempts, 2);
  assert.equal(result.classification, 'TRANSIENT_RECOVERED');
  assert.deepEqual(result.diagnostics.events.map(({ phase }) => phase), ['FIRST_ATTEMPT', 'RETRY_ATTEMPT']);
  assert.ok(!JSON.stringify(result).includes('private'));
  const failed = await runProductionCheck('prod:homepage', { fetchFn: async () => { throw Object.assign(new Error('sentinel'), { code: 'ECONNRESET' }); } });
  assert.equal(failed.status, 'FAIL');
  assert.equal(failed.attempts, 2);
  const unknown = await runProductionCheck('prod:homepage', { fetchFn: async () => { throw new Error('sentinel'); } });
  assert.equal(unknown.attempts, 1);
});

test('PROD validates each redirect before I/O and never follows credential or destructive destinations', async () => {
  const { runProductionCheck } = await productionModule();
  for (const location of ['https://evil.example/', '/api/admin/delete', '/auth/callback/?code=private-sentinel', '//evil.example/', '/\\evil.example/', '/%2e%2e/api/admin/delete']) {
    let calls = 0;
    const result = await runProductionCheck('prod:homepage', { fetchFn: async () => { calls++; return new Response(null, { status: 302, headers: { location } }); } });
    assert.equal(result.status, 'FAIL');
    assert.equal(result.classification, 'SAFETY');
    assert.equal(calls, 1);
    assert.ok(!JSON.stringify(result).includes('private-sentinel'));
  }
  const calls = [];
  const good = await runProductionCheck('prod:forum', { fetchFn: async (url) => {
    calls.push(url);
    return calls.length === 1 ? new Response(null, { status: 301, headers: { location: '/feed/' } }) : new Response(productionHtml('/feed/'), { headers: { 'content-type': 'text/html' } });
  }});
  assert.equal(good.status, 'PASS');
  assert.deepEqual(calls, [PROD_ORIGIN + '/forum/', PROD_ORIGIN + '/feed/']);
});

test('PROD validates sitemap, API shape and token-free callback/reset architecture', async () => {
  const { runProductionCheck } = await productionModule();
  for (const [id, body, type] of [
    ['prod:sitemap', `<urlset><url><loc>${PROD_ORIGIN}/</loc></url></urlset>`, 'application/xml'],
    ['prod:news-api', '{"ok":true,"articles":[]}', 'application/json'],
    ['prod:callback', productionHtml('/auth/callback/'), 'text/html'],
    ['prod:reset', productionHtml('/auth/reset-password/'), 'text/html'],
  ]) {
    const good = await runProductionCheck(id, { fetchFn: async () => new Response(body, { headers: { 'content-type': type } }) });
    assert.equal(good.status, 'PASS', id);
    const bad = await runProductionCheck(id, { fetchFn: async () => new Response('<html>empty</html>', { headers: { 'content-type': type } }) });
    assert.equal(bad.status, 'FAIL', id);
  }
});

test('PROD follows the authoritative devices redirect to the exact products route', async () => {
  const { runProductionCheck } = await productionModule();
  const calls = [];
  const devices = await runProductionCheck('prod:devices', { fetchFn: async (url, options) => {
    calls.push({ url, method: options.method });
    if (url === PROD_ORIGIN + '/devices/') {
      return new Response(null, { status: 301, headers: { location: '/products/' } });
    }
    assert.equal(url, PROD_ORIGIN + '/products/');
    return new Response(productionHtml('/products/'), { headers: { 'content-type': 'text/html' } });
  }});
  assert.equal(devices.status, 'PASS');
  assert.deepEqual(calls, [
    { url: PROD_ORIGIN + '/devices/', method: 'GET' },
    { url: PROD_ORIGIN + '/products/', method: 'GET' },
  ]);

  const products = await runProductionCheck('prod:products', { fetchFn: async (url) => {
    assert.equal(url, PROD_ORIGIN + '/products/');
    return new Response(productionHtml('/products/'), { headers: { 'content-type': 'text/html' } });
  }});
  assert.equal(products.status, 'PASS');
});

test('PROD rejects redirects outside the exact route contract before sending the second request', async () => {
  const { runProductionCheck } = await productionModule();
  for (const [id, destination] of [
    ['prod:homepage', '/login/'],
    ['prod:devices', '/products'],
    ['prod:devices', '/devices/other'],
    ['prod:forum', '/news/'],
  ]) {
    let calls = 0;
    const result = await runProductionCheck(id, { fetchFn: async () => {
      calls++;
      return calls === 1 ? new Response(null, { status: 302, headers: { location: destination } }) :
        new Response(productionHtml(destination), { headers: { 'content-type': 'text/html' } });
    }});
    assert.equal(result.status, 'FAIL', id);
    assert.equal(result.classification, 'SAFETY', id);
    assert.equal(result.attempts, 1);
    assert.equal(calls, 1);
  }
});

test('PROD detects Worker failure text inside otherwise valid page architecture', async () => {
  const { runProductionCheck } = await productionModule();
  for (const marker of ['Worker threw exception', 'Error 1101', 'Missing binding: PRIVATE_BINDING_SENTINEL', 'Uncaught TypeError: PRIVATE_ERROR_SENTINEL']) {
    let calls = 0;
    const result = await runProductionCheck('prod:homepage', { fetchFn: async () => {
      calls++;
      return new Response(productionHtml().replace('<main>', `<main><p>${marker}</p>`), { headers: { 'content-type': 'text/html' } });
    }});
    assert.equal(result.status, 'FAIL');
    assert.equal(result.diagnostics.events[0].code, 'WORKER_RUNTIME_FAILURE');
    assert.equal(calls, 1);
    assert.ok(!JSON.stringify(result).includes('PRIVATE_'));
  }
});

test('PROD accepts the actual JPEG representation and rejects corrupt media with image MIME', async () => {
  const { runProductionCheck } = await productionModule();
  const jpeg = readFileSync(new URL('../../public/brand/logo.jpg', import.meta.url));
  const good = await runProductionCheck('prod:media', { fetchFn: async () => new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } }) });
  assert.equal(good.status, 'PASS');
  for (const bytes of [new TextEncoder().encode('<html>not an image</html>'), jpeg.subarray(0, 128), new Uint8Array([255, 216, 255])]) {
    const bad = await runProductionCheck('prod:media', { fetchFn: async () => new Response(bytes, { headers: { 'content-type': 'image/jpeg' } }) });
    assert.equal(bad.status, 'FAIL');
    assert.equal(bad.attempts, 1);
    assert.equal(bad.diagnostics.events[0].code, 'MEDIA_REPRESENTATION_INVALID');
  }
});

test('PROD diagnostics cannot acquire credential text from a changing error code', async () => {
  const { runProductionCheck } = await productionModule();
  let reads = 0;
  const result = await runProductionCheck('prod:homepage', { fetchFn: async () => {
    throw { get code() { return ++reads <= 2 ? 'HTTP_STATUS_MISMATCH' : 'private-sentinel'; } };
  }});
  assert.equal(result.status, 'FAIL');
  assert.ok(!JSON.stringify(result).includes('private-sentinel'));
});

test('PROD refuses implicit redirects and bounds explicit redirect chains and response bodies', async () => {
  const { runProductionCheck } = await productionModule();
  let calls = 0;
  const loop = await runProductionCheck('prod:homepage', { fetchFn: async () => { calls++; return new Response(null, { status: 302, headers: { location: '/' } }); } });
  assert.equal(loop.status, 'FAIL');
  assert.equal(loop.classification, 'SAFETY');
  assert.equal(calls, 4);
  const implicit = await runProductionCheck('prod:homepage', { fetchFn: async () => ({ redirected: true, body: null }) });
  assert.equal(implicit.classification, 'SAFETY');
  const oversized = await runProductionCheck('prod:homepage', { fetchFn: async () => new Response('x'.repeat(4 * 1024 * 1024 + 1)) });
  assert.equal(oversized.status, 'FAIL');
  assert.equal(oversized.attempts, 1);
  assert.equal(oversized.diagnostics.events[0].code, 'RESPONSE_SIZE_LIMIT');
});

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

test('PROD runner writes sanitized receipt through actual HTTP checks without command adapters', async () => {
  const { executeProductionRun } = await import('./runner.mjs');
  assert.equal(typeof executeProductionRun, 'function');
  const { cwd } = createFeatureRepository();
  try {
    let output = '';
    const receipt = await executeProductionRun({ cwd, artifactRoot: join(cwd, 'artifacts'), write: (value) => { output += value; }, fetchFn: async (url) => {
      const path = new URL(url).pathname;
      if (path === '/api/forum/reports') return new Response(null, { status: 405 });
      if (path.startsWith('/api/admin/')) return new Response(null, { status: 401 });
      if (path === '/api/news') return new Response('{"ok":true,"articles":[]}', { headers: { 'content-type': 'application/json' } });
      if (path === '/sitemap.xml') return new Response(`<urlset><url><loc>${PROD_ORIGIN}/</loc></url></urlset>`, { headers: { 'content-type': 'application/xml' } });
      if (path === '/brand/logo.jpg') return new Response(readFileSync(new URL('../../public/brand/logo.jpg', import.meta.url)), { headers: { 'content-type': 'image/jpeg' } });
      return new Response(productionHtml(path), { headers: { 'content-type': 'text/html' } });
    }});
    assert.equal(receipt.result, 'PASS');
    assert.equal(receipt.qaProfile, 'PRODUCTION_SMOKE');
    assert.equal(receipt.safety.productionReadOnly, true);
    assert.equal(receipt.safety.productionDbConnections, 0);
    assert.equal(receipt.safety.productionMutations, 0);
    assert.equal(receipt.safety.providerMutations, 0);
    assert.match(output, /QA_RESULT=PASS/);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

function createFeatureRepository() {
  const cwd = mkdtempSync(join(tmpdir(), 'openglass-qa-fast-'));
  git(cwd, ['init', '-b', 'main']);
  git(cwd, ['config', 'user.email', 'qa@example.test']);
  git(cwd, ['config', 'user.name', 'QA Harness']);
  writeFileSync(join(cwd, 'README.md'), 'base\n');
  git(cwd, ['add', '--', 'README.md']);
  git(cwd, ['commit', '-m', 'base']);
  const baseSha = git(cwd, ['rev-parse', 'HEAD']);
  git(cwd, ['switch', '-c', 'feature/test']);
  return { cwd, baseSha };
}

function commitFile(cwd, path, content) {
  const target = join(cwd, ...path.split('/'));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  git(cwd, ['add', '--', path]);
  git(cwd, ['commit', '-m', `change ${path}`]);
}

function passingCheck(id) {
  return { id, status: 'PASS', attempts: 1, durationMs: 0, classification: 'DETERMINISTIC', diagnostics: {} };
}

test('FAST selects only its deterministic foundation for an area-free local run', () => {
  const selection = resolveFastChecks({ profile: 'FAST', risk: 'LOW', expandedAreas: [] });

  assert.equal(selection.blocked, false);
  assert.equal(selection.risk, 'LOW');
  assert.deepEqual(selection.selectedChecks.map(({ id }) => id), FOUNDATION);
  assert.deepEqual(selection.skippedChecks.map(({ id }) => id), FORBIDDEN_EXPENSIVE);
});

test('FAST adds only cheap checks for expanded medium-risk areas', () => {
  const selection = resolveFastChecks({
    profile: 'FAST',
    risk: 'MEDIUM',
    expandedAreas: ['devices', 'products', 'search', 'seo'],
  });

  assert.equal(selection.blocked, false);
  assert.deepEqual(selection.selectedChecks.map(({ id }) => id), [
    'devices-library',
    'devices-public-data',
    'git-diff-check',
    'products-page',
    'qa-harness-core',
    'qa-harness-executor',
    'qa-harness-manifest',
    'qa-harness-profiles',
    'qa-harness-receipt',
    'qa-harness-risk',
    'search',
    'seo',
  ]);
  assert.equal(selection.selectedChecks.some(({ id }) => /admin|auth|e2e|replay|production|provider/i.test(id)), false);
});

test('FAST includes the build only when a frontend change requires it', () => {
  const plain = resolveFastChecks({ profile: 'FAST', risk: 'LOW', expandedAreas: [] });
  const frontend = resolveFastChecks({ profile: 'FAST', risk: 'LOW', expandedAreas: ['frontend'] });

  assert.equal(plain.selectedChecks.some(({ id }) => id === 'frontend-astro-build'), false);
  assert.equal(frontend.selectedChecks.some(({ id }) => id === 'frontend-astro-build'), true);
});

test('FAST fails closed before selecting checks for high-risk input', () => {
  const selection = resolveFastChecks({ profile: 'FAST', risk: 'HIGH', expandedAreas: ['database'] });

  assert.equal(selection.blocked, true);
  assert.equal(selection.requiredProfile, 'RELEASE');
  assert.equal(selection.blockedReason, 'RELEASE_REQUIRED:qa:release');
  assert.deepEqual(selection.selectedChecks, []);
  assert.deepEqual(selection.skippedChecks.map(({ id }) => id), FORBIDDEN_EXPENSIVE);
});

test('every FAST selection is an executable registry ID allowed for FAST', () => {
  const selection = resolveFastChecks({
    profile: 'FAST',
    risk: 'MEDIUM',
    expandedAreas: ['devices', 'products', 'search', 'seo'],
  });

  for (const { id } of selection.selectedChecks) {
    const registered = getCheck(id);
    assert.equal(registered.id, id);
    assert.equal(registered.allowedProfiles.includes('FAST'), true);
  }
});

test('FAST summary names profile risk exact selections skips and result', () => {
  const output = renderProfileOutput({
    qaProfile: 'FAST',
    risk: 'MEDIUM',
    selectedChecks: [{ id: 'b-check' }, { id: 'a-check' }],
    skippedChecks: [{ id: 'full-browser-e2e', reason: 'profile_budget' }],
    result: 'PASS',
  });

  assert.equal(output, [
    'QA_PROFILE=FAST',
    'RISK=MEDIUM',
    'SELECTED_CHECKS=a-check,b-check',
    'SKIPPED_EXPENSIVE_CHECKS=full-browser-e2e:profile_budget',
    'QA_RESULT=PASS',
  ].join('\n'));
});

test('package exposes exactly four QA public profiles', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  const qaScripts = Object.keys(packageJson.scripts).filter((name) => name.startsWith('qa:')).sort();

  assert.deepEqual(qaScripts, ['qa:fast', 'qa:feature', 'qa:prod', 'qa:release']);
  assert.equal(packageJson.scripts['qa:fast'], 'node scripts/qa/runner.mjs fast');
  assert.equal(packageJson.scripts['qa:feature'], 'node scripts/qa/runner.mjs feature');
  assert.equal(packageJson.scripts['qa:release'], 'node scripts/qa/runner.mjs release');
  assert.equal(packageJson.scripts['qa:prod'], 'node scripts/qa/runner.mjs prod');
});

test('FAST runner classifies a Wrangler change and blocks before any check runs', async () => {
  const repository = createFeatureRepository();
  let executed = 0;
  let output = '';
  try {
    commitFile(repository.cwd, 'wrangler.toml', 'name = "unsafe-change"\n');
    const receipt = await executeFastRun({
      cwd: repository.cwd,
      mainRef: 'main',
      artifactRoot: join(repository.cwd, 'artifacts', 'qa'),
      runCheckFn: async (id) => { executed += 1; return passingCheck(id); },
      write: (value) => { output += value; },
    });

    assert.equal(receipt.result, 'BLOCKED');
    assert.equal(receipt.risk, 'HIGH');
    assert.equal(receipt.baseSha, repository.baseSha);
    assert.deepEqual(receipt.areas, ['cloudflare']);
    assert.deepEqual(receipt.expandedAreas, ['cloudflare', 'security']);
    assert.equal(receipt.changedPathsCount, 1);
    assert.equal(executed, 0);
    assert.match(output, /QA_RESULT=BLOCKED/);
  } finally {
    rmSync(repository.cwd, { recursive: true, force: true });
  }
});

test('FAST runner classifies a device change and selects only its dependency-expanded cheap gates', async () => {
  const repository = createFeatureRepository();
  const executed = [];
  try {
    commitFile(repository.cwd, 'src/pages/devices/index.astro', '<main>devices</main>\n');
    const receipt = await executeFastRun({
      cwd: repository.cwd,
      mainRef: 'main',
      artifactRoot: join(repository.cwd, 'artifacts', 'qa'),
      runCheckFn: async (id) => { executed.push(id); return passingCheck(id); },
      write: () => {},
    });

    assert.equal(receipt.result, 'PASS');
    assert.equal(receipt.risk, 'MEDIUM');
    assert.deepEqual(receipt.areas, ['devices']);
    assert.deepEqual(receipt.expandedAreas, ['devices', 'products', 'search', 'seo']);
    assert.equal(receipt.changedPathsCount, 1);
    assert.deepEqual(executed, receipt.selectedChecks.map(({ id }) => id));
    assert.equal(executed.includes('devices-library'), true);
    assert.equal(executed.includes('products-page'), true);
    assert.equal(executed.includes('search'), true);
    assert.equal(executed.includes('seo'), true);
    assert.equal(executed.some((id) => /e2e|replay|production|provider/i.test(id)), false);
  } finally {
    rmSync(repository.cwd, { recursive: true, force: true });
  }
});

test('FAST runner fails closed without executing checks when the comparison base is unresolved', async () => {
  const repository = createFeatureRepository();
  let executed = 0;
  try {
    await assert.rejects(() => executeFastRun({
      cwd: repository.cwd,
      mainRef: 'missing-main',
      artifactRoot: join(repository.cwd, 'artifacts', 'qa'),
      runCheckFn: async (id) => { executed += 1; return passingCheck(id); },
      write: () => {},
    }), (error) => error?.code === 'BASE_UNRESOLVED');
    assert.equal(executed, 0);
  } finally {
    rmSync(repository.cwd, { recursive: true, force: true });
  }
});

test('FAST runner and CLI preserve BASE_UNRESOLVED for detached HEAD', async () => {
  const repository = createFeatureRepository();
  let executed = 0;
  try {
    git(repository.cwd, ['switch', '--detach', 'HEAD']);
    await assert.rejects(() => executeFastRun({
      cwd: repository.cwd,
      mainRef: 'main',
      artifactRoot: join(repository.cwd, 'artifacts', 'qa'),
      runCheckFn: async (id) => { executed += 1; return passingCheck(id); },
      write: () => {},
    }), (error) => error?.code === 'BASE_UNRESOLVED');
    assert.equal(executed, 0);

    const environment = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'WINDIR']
      .flatMap((name) => typeof process.env[name] === 'string' ? [[name, process.env[name]]] : []));
    const cli = spawnSync(process.execPath, [RUNNER, 'fast'], {
      cwd: repository.cwd,
      env: environment,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    });
    assert.equal(cli.status, 2);
    assert.match(cli.stderr, /QA_ERROR=BASE_UNRESOLVED/);
    assert.doesNotMatch(cli.stderr, /HARNESS_FAILURE/);
  } finally {
    rmSync(repository.cwd, { recursive: true, force: true });
  }
});

test('FEATURE devices selects dependency-expanded targeted checks without unrelated admin', () => {
  assert.equal(typeof resolveFeatureChecks, 'function');
  const selection = resolveFeatureChecks({
    profile: 'FEATURE',
    risk: 'MEDIUM',
    directAreas: ['devices'],
    expandedAreas: ['devices', 'products', 'search', 'seo'],
  });

  assert.equal(selection.blocked, false);
  assert.deepEqual(selection.areas, ['devices', 'products', 'search', 'seo']);
  assert.deepEqual(selection.selectedChecks.map(({ id }) => id), [
    'devices-library',
    'devices-public-data',
    'frontend-astro-build',
    'git-diff-check',
    'products-page',
    'qa-harness-core',
    'qa-harness-executor',
    'qa-harness-manifest',
    'qa-harness-profiles',
    'qa-harness-receipt',
    'qa-harness-risk',
    'search',
    'seo',
  ]);
  assert.equal(selection.selectedChecks.some(({ id }) => id.startsWith('admin-')), false);
  assert.equal(selection.skippedChecks.some(({ id, reason }) => id === 'admin-device-api' && reason === 'area_not_selected'), true);
});

test('FEATURE resolver expands direct devices input to the same targeted selection', () => {
  const direct = resolveFeatureChecks({ profile: 'FEATURE', risk: 'LOW', areas: ['devices', 'devices'] });
  const expanded = resolveFeatureChecks({
    profile: 'FEATURE', risk: 'LOW', expandedAreas: ['seo', 'search', 'products', 'devices'],
  });

  assert.deepEqual(direct.areas, ['devices', 'products', 'search', 'seo']);
  assert.equal(direct.risk, 'MEDIUM');
  assert.deepEqual(direct, expanded);
  for (const id of ['products-page', 'search', 'seo']) {
    assert.equal(direct.selectedChecks.some((check) => check.id === id), true);
  }
});

test('FEATURE resolver expands direct forum input and blocks its high-risk dependencies', () => {
  const selection = resolveFeatureChecks({ profile: 'FEATURE', risk: 'MEDIUM', areas: ['forum'] });

  assert.deepEqual(selection.areas, ['auth', 'forum', 'media', 'security']);
  assert.equal(selection.risk, 'HIGH');
  assert.equal(selection.blocked, true);
  assert.equal(selection.requiredProfile, 'RELEASE');
  assert.equal(selection.blockedReason, 'RELEASE_REQUIRED:qa:release');
  assert.deepEqual(selection.selectedChecks, []);
});

test('FEATURE inferred forum changes expand through auth media and security then require release', async () => {
  assert.equal(typeof executeFeatureRun, 'function');
  const repository = createFeatureRepository();
  let executed = 0;
  try {
    commitFile(repository.cwd, 'src/pages/forum/index.astro', '<main>forum</main>\n');
    const receipt = await executeFeatureRun({
      argv: ['feature'],
      cwd: repository.cwd,
      mainRef: 'main',
      artifactRoot: join(repository.cwd, 'artifacts', 'qa'),
      runCheckFn: async (id) => { executed += 1; return passingCheck(id); },
      write: () => {},
    });

    assert.equal(receipt.result, 'BLOCKED');
    assert.equal(receipt.risk, 'HIGH');
    assert.deepEqual(receipt.areas, ['forum']);
    assert.deepEqual(receipt.expandedAreas, ['auth', 'forum', 'media', 'security']);
    assert.equal(receipt.expandedAreas.includes('admin'), false);
    assert.deepEqual(receipt.error, { code: 'RELEASE_REQUIRED', requiredProfile: 'qa:release' });
    assert.equal(executed, 0);
  } finally {
    rmSync(repository.cwd, { recursive: true, force: true });
  }
});

test('FEATURE deterministically infers devices and executes only its expanded targeted selection', async () => {
  assert.equal(typeof executeFeatureRun, 'function');
  const repository = createFeatureRepository();
  const executed = [];
  try {
    commitFile(repository.cwd, 'src/pages/devices/index.astro', '<main>devices</main>\n');
    const receipt = await executeFeatureRun({
      argv: ['feature'],
      cwd: repository.cwd,
      mainRef: 'main',
      artifactRoot: join(repository.cwd, 'artifacts', 'qa'),
      runCheckFn: async (id) => { executed.push(id); return passingCheck(id); },
      write: () => {},
    });

    assert.equal(receipt.result, 'PASS');
    assert.equal(receipt.risk, 'MEDIUM');
    assert.deepEqual(receipt.areas, ['devices']);
    assert.deepEqual(receipt.expandedAreas, ['devices', 'products', 'search', 'seo']);
    assert.deepEqual(executed, receipt.selectedChecks.map(({ id }) => id));
    assert.equal(executed.includes('devices-library'), true);
    assert.equal(executed.includes('products-page'), true);
    assert.equal(executed.includes('search'), true);
    assert.equal(executed.includes('seo'), true);
    assert.equal(executed.some((id) => id.startsWith('admin-')), false);
  } finally {
    rmSync(repository.cwd, { recursive: true, force: true });
  }
});

test('FEATURE rejects an unknown explicit area before executing checks', async () => {
  assert.equal(typeof executeFeatureRun, 'function');
  const repository = createFeatureRepository();
  let executed = 0;
  try {
    commitFile(repository.cwd, 'src/pages/devices/index.astro', '<main>devices</main>\n');
    await assert.rejects(() => executeFeatureRun({
      argv: ['feature', 'not-a-real-area'],
      cwd: repository.cwd,
      mainRef: 'main',
      artifactRoot: join(repository.cwd, 'artifacts', 'qa'),
      runCheckFn: async (id) => { executed += 1; return passingCheck(id); },
      write: () => {},
    }), /explicitArea must name a manifest area/);
    assert.equal(executed, 0);
  } finally {
    rmSync(repository.cwd, { recursive: true, force: true });
  }
});

test('RELEASE selects critical local verification gates and excludes every mutating or production operation', () => {
  const selection = resolveReleaseChecks({
    profile: 'RELEASE',
    risk: 'HIGH',
    expandedAreas: ['auth', 'cloudflare', 'database', 'security'],
  });
  const selected = selection.selectedChecks.map(({ id }) => id);

  assert.equal(selection.blocked, false);
  assert.equal(selection.risk, 'HIGH');
  for (const id of [
    'frontend-astro-build',
    'project-test',
    'auth-redirect-safety',
    'auth-legal-consent',
    'user-profile-api-safety',
    'user-summary-api-safety',
    'media-url-privacy',
    'seo',
    'workers-config',
    'workers-artifact',
    'workers-release-guard',
    'devices-library',
    'forum-permissions',
    'targeted-browser-contracts',
    'targeted-browser-journey',
    'database-migration-versions',
    'security-headers',
    'security-privilege-convergence',
  ]) assert.equal(selected.includes(id), true, id);

  for (const id of ['database-replay', 'deployment', 'production-smoke', 'provider-operations']) {
    assert.equal(selected.includes(id), false, id);
    assert.equal(selection.skippedChecks.some((entry) => entry.id === id), true, id);
  }
  assert.equal(selected.some((id) => /(?:deploy|provider-operation|production-smoke|database-replay)/i.test(id)), false);
});

test('RELEASE selection is deterministic and every selected ID is executable only through the release adapter', () => {
  const context = { profile: 'RELEASE', risk: 'LOW', expandedAreas: ['devices', 'seo'] };
  const first = resolveReleaseChecks(context);
  const second = resolveReleaseChecks(context);

  assert.deepEqual(first, second);
  assert.deepEqual(first.selectedChecks.map(({ id }) => id), [...first.selectedChecks.map(({ id }) => id)].sort());
  assert.equal(first.selectedChecks.some(({ id }) => id === 'database-migration-versions'), false);
  assert.equal(first.skippedChecks.some(({ id, reason }) =>
    id === 'database-migration-versions' && reason === 'database_area_not_changed'), true);
  for (const { id } of first.selectedChecks) {
    const registered = getCheck(`release:${id}`);
    assert.deepEqual(registered.allowedProfiles, ['RELEASE']);
  }
});

test('RELEASE runner retains deterministic selection evidence and zero mutation counters', async () => {
  const repository = createFeatureRepository();
  const executed = [];
  try {
    commitFile(repository.cwd, 'wrangler.toml', 'name = "release-check"\n');
    const receipt = await executeReleaseRun({
      argv: ['release'],
      cwd: repository.cwd,
      mainRef: 'main',
      artifactRoot: join(repository.cwd, 'artifacts', 'qa'),
      runCheckFn: async (id) => { executed.push(id); return passingCheck(id); },
      write: () => {},
    });

    assert.equal(receipt.result, 'PASS');
    assert.equal(receipt.qaProfile, 'RELEASE');
    assert.equal(receipt.risk, 'HIGH');
    assert.deepEqual(receipt.areas, ['cloudflare']);
    assert.deepEqual(receipt.expandedAreas, ['cloudflare', 'security']);
    assert.deepEqual(executed, receipt.selectedChecks.map(({ id }) => id));
    assert.equal(executed.includes('database-migration-versions'), false);
    assert.equal(receipt.skippedChecks.some(({ id }) => id === 'deployment'), true);
    assert.deepEqual(receipt.safety, {
      productionReadOnly: false,
      productionDbConnections: 0,
      productionMutations: 0,
      providerMutations: 0,
    });
  } finally {
    rmSync(repository.cwd, { recursive: true, force: true });
  }
});

test('RELEASE invokes the Task 8 adapter through an owned real-browser lifecycle and always cleans up', async () => {
  const calls = [];
  const browser = { close: async () => { calls.push('browser:close'); } };
  const result = await runReleaseCheck('targeted-browser-journey', {
    profile: 'RELEASE',
    cwd: process.cwd(),
    env: {},
    artifactRoot: join(tmpdir(), 'openglass-release-browser-artifacts'),
    browserJourneyDependencies: {
      startServer: async () => {
        calls.push('server:start');
        return { baseUrl: 'http://127.0.0.1:4321', handle: { owned: true } };
      },
      launchBrowser: async () => {
        calls.push('browser:launch');
        return browser;
      },
      runAdapter: async (options) => {
        calls.push('adapter:run');
        assert.equal(options.group, 'auth');
        assert.equal(options.baseUrl, 'http://127.0.0.1:4321');
        assert.equal(options.browser, browser);
        assert.match(options.artifactSink.directory, /release-targeted-browser/);
        return {
          id: 'browser:auth', status: 'PASS', attempts: 1,
          classification: 'DETERMINISTIC', summary: 'real local journey passed', failureArtifactHints: [],
        };
      },
      closeBrowser: async (owned) => {
        assert.equal(owned, browser);
        calls.push('browser:cleanup');
        await owned.close();
        return true;
      },
      stopServer: async (handle) => {
        assert.equal(handle.owned, true);
        calls.push('server:stop');
        return true;
      },
    },
  });

  assert.equal(result.status, 'PASS');
  assert.deepEqual(calls, [
    'server:start', 'browser:launch', 'adapter:run',
    'browser:cleanup', 'browser:close', 'server:stop',
  ]);
  assert.deepEqual(result.diagnostics.lifecycle, {
    browserClosed: true,
    treeTerminationConfirmed: true,
    processTreeStopped: true,
    portReleased: true,
    serverStopped: true,
  });
});

test('RELEASE real-browser lifecycle preserves adapter failure evidence and cleans up both owners', async () => {
  const calls = [];
  const result = await runReleaseCheck('targeted-browser-journey', {
    profile: 'RELEASE', cwd: process.cwd(), env: {}, artifactRoot: join(tmpdir(), 'openglass-release-browser-failure'),
    browserJourneyDependencies: {
      startServer: async () => ({ baseUrl: 'http://127.0.0.1:4321', handle: {} }),
      launchBrowser: async () => ({}),
      runAdapter: async () => ({
        id: 'browser:auth', status: 'FAIL', attempts: 1, classification: 'DETERMINISTIC',
        summary: 'scoped assertion failed', failureArtifactHints: ['browser:auth:first-attempt:console'],
        details: {
          assertions: [],
          firstAttempt: 'FAIL',
          retryAttempt: null,
          firstFailure: {
            error: 'expected login heading; password=do-not-retain',
            consoleErrors: ['login render failed'],
            consoleCaptured: true,
            screenshotCaptured: false,
            traceCaptured: false,
            binaryEvidencePolicy: 'DISCARDED_UNREDACTABLE',
            artifacts: { console: 'C:/safe/first-attempt-console.json', screenshot: null, trace: null },
          },
        },
      }),
      closeBrowser: async () => { calls.push('browser:cleanup'); return true; },
      stopServer: async () => { calls.push('server:stop'); return true; },
    },
  });

  assert.equal(result.status, 'FAIL');
  assert.deepEqual(result.diagnostics.failureArtifactHints, ['browser:auth:first-attempt:console']);
  assert.equal(result.diagnostics.adapterDetails.firstFailure.error, 'expected login heading; [REDACTED]');
  assert.equal(result.diagnostics.adapterDetails.firstFailure.consoleCaptured, true);
  assert.equal(result.diagnostics.adapterDetails.firstFailure.artifacts.console, 'C:/safe/first-attempt-console.json');
  assert.deepEqual(calls, ['browser:cleanup', 'server:stop']);
});

test('RELEASE local Worker cleanup requires both owned process-tree termination and bounded port release', async () => {
  const child = new EventEmitter();
  Object.assign(child, { pid: 321, exitCode: null, signalCode: null });
  const calls = [];
  const result = await stopLocalWorker({ child, port: 4321 }, {
    terminateTree: async (pid, timeoutMs) => {
      calls.push(['tree', pid, timeoutMs]);
      child.exitCode = 0;
      child.emit('exit', 0, null);
      return true;
    },
    probePort: async (port, timeoutMs) => {
      calls.push(['port', port, timeoutMs]);
      return true;
    },
  });

  assert.deepEqual(result, {
    treeTerminationConfirmed: true,
    processTreeStopped: true,
    portReleased: true,
    serverStopped: true,
  });
  assert.deepEqual(calls, [['tree', 321, 5_000], ['port', 4321, 5_000]]);

  const occupied = await stopLocalWorker({ child: { pid: 321, exitCode: 0, signalCode: null }, port: 4321 }, {
    terminateTree: async () => { throw new Error('already exited process must not be terminated'); },
    probePort: async () => false,
  });
  assert.deepEqual(occupied, {
    treeTerminationConfirmed: false,
    processTreeStopped: true,
    portReleased: false,
    serverStopped: false,
  });
});

test('RELEASE cleanup fails closed when tree termination fails even if root exits and port releases', async () => {
  const child = new EventEmitter();
  Object.assign(child, { pid: 654, exitCode: null, signalCode: null });
  const result = await stopLocalWorker({ child, port: 4322 }, {
    terminateTree: async () => {
      child.exitCode = 1;
      child.emit('exit', 1, null);
      return false;
    },
    probePort: async () => true,
  });

  assert.deepEqual(result, {
    treeTerminationConfirmed: false,
    processTreeStopped: true,
    portReleased: true,
    serverStopped: false,
  });
});

test('RELEASE cleanup refuses an already-exited root without independent descendant-tree proof', async () => {
  let terminateCalls = 0;
  const result = await stopLocalWorker({ child: { pid: 987, exitCode: 0, signalCode: null }, port: 4323 }, {
    terminateTree: async () => { terminateCalls += 1; return true; },
    probePort: async () => true,
  });

  assert.equal(terminateCalls, 0);
  assert.deepEqual(result, {
    treeTerminationConfirmed: false,
    processTreeStopped: true,
    portReleased: true,
    serverStopped: false,
  });
});

test('RELEASE POSIX cleanup does not confuse delivered signals with a vanished owned process group', async () => {
  const child = new EventEmitter();
  Object.assign(child, { pid: 741, exitCode: null, signalCode: null, kill: () => true });
  let clock = 0;
  const signals = [];
  const terminateTree = (pid, timeoutMs) => terminatePosixProcessTree(pid, timeoutMs, {
    signalGroup: (_pid, signal) => {
      signals.push(signal);
      if (signal === 'SIGTERM') {
        child.exitCode = 0;
        child.emit('exit', 0, null);
      }
      return true;
    },
    groupExists: () => true,
    now: () => clock,
    delay: async (ms) => { clock += ms; },
  });
  const cleanup = await stopLocalWorker({ child, port: 4324 }, {
    platform: 'linux',
    terminateTree,
    probePort: async () => true,
  });

  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  assert.deepEqual(cleanup, {
    treeTerminationConfirmed: false,
    processTreeStopped: true,
    portReleased: true,
    serverStopped: false,
  });

  const result = await runReleaseCheck('targeted-browser-journey', {
    profile: 'RELEASE', cwd: process.cwd(), env: {}, artifactRoot: join(tmpdir(), 'openglass-release-posix-group'),
    browserJourneyDependencies: {
      startServer: async () => ({ baseUrl: 'http://127.0.0.1:4324', handle: {} }),
      launchBrowser: async () => ({}),
      runAdapter: async () => ({
        id: 'browser:auth', status: 'PASS', attempts: 1,
        classification: 'DETERMINISTIC', summary: 'adapter passed', details: {}, failureArtifactHints: [],
      }),
      closeBrowser: async () => true,
      stopServer: async () => cleanup,
    },
  });
  assert.equal(result.status, 'FAIL');
  assert.equal(result.classification, 'SAFETY');
  assert.equal(result.diagnostics.lifecycle.serverStopped, false);
});

test('RELEASE propagates startup cleanup failure and never reports serverStopped optimistically', async () => {
  const startup = new Error('local readiness failed');
  startup.cleanup = { treeTerminationConfirmed: false, processTreeStopped: true, portReleased: false, serverStopped: false };
  const result = await runReleaseCheck('targeted-browser-journey', {
    profile: 'RELEASE', cwd: process.cwd(), env: {}, artifactRoot: join(tmpdir(), 'openglass-release-startup-failure'),
    browserJourneyDependencies: { startServer: async () => { throw startup; } },
  });

  assert.equal(result.status, 'FAIL');
  assert.equal(result.classification, 'SAFETY');
  assert.deepEqual(result.diagnostics.lifecycle, {
    browserClosed: true,
    treeTerminationConfirmed: false,
    processTreeStopped: true,
    portReleased: false,
    serverStopped: false,
  });
});

test('RELEASE receipt retains redacted real-browser root cause and first/retry evidence', async () => {
  const repository = createFeatureRepository();
  try {
    commitFile(repository.cwd, 'wrangler.toml', 'name = "release-evidence"\n');
    const receipt = await executeReleaseRun({
      argv: ['release'],
      cwd: repository.cwd,
      mainRef: 'main',
      artifactRoot: join(repository.cwd, 'artifacts', 'qa'),
      runCheckFn: async (id) => id === 'targeted-browser-journey'
        ? {
            id, status: 'FAIL', attempts: 2, classification: 'DETERMINISTIC',
            diagnostics: {
              summary: 'login assertion failed; token=private-value',
              failureArtifactHints: ['first-console', 'retry-console'],
              adapterDetails: {
                firstAttempt: 'FAIL', retryAttempt: 'FAIL',
                firstFailure: { error: 'heading mismatch', consoleCaptured: true, artifacts: { console: 'first.json' } },
                retryFailure: { error: 'heading mismatch again', consoleCaptured: true, artifacts: { console: 'retry.json' } },
              },
              lifecycle: { browserClosed: true, treeTerminationConfirmed: true, processTreeStopped: true, portReleased: true, serverStopped: true },
            },
          }
        : passingCheck(id),
      write: () => {},
    });

    assert.equal(receipt.result, 'FAIL');
    assert.equal(receipt.extensions.realBrowserEvidence.status, 'FAIL');
    assert.equal(receipt.extensions.realBrowserEvidence.attempts, 2);
    assert.equal(receipt.extensions.realBrowserEvidence.diagnostics.summary, 'login assertion failed; [REDACTED]');
    assert.equal(receipt.extensions.realBrowserEvidence.diagnostics.adapterDetails.firstFailure.artifacts.console, 'first.json');
    assert.equal(receipt.extensions.realBrowserEvidence.diagnostics.adapterDetails.retryFailure.artifacts.console, 'retry.json');
  } finally {
    rmSync(repository.cwd, { recursive: true, force: true });
  }
});

test('FEATURE explicit devices hint cannot downgrade an unrelated high-risk changed path', async () => {
  assert.equal(typeof executeFeatureRun, 'function');
  const repository = createFeatureRepository();
  let executed = 0;
  try {
    commitFile(repository.cwd, 'src/pages/admin/index.astro', '<main>admin</main>\n');
    const receipt = await executeFeatureRun({
      argv: ['feature', 'devices'],
      cwd: repository.cwd,
      mainRef: 'main',
      artifactRoot: join(repository.cwd, 'artifacts', 'qa'),
      runCheckFn: async (id) => { executed += 1; return passingCheck(id); },
      write: () => {},
    });

    assert.equal(receipt.result, 'BLOCKED');
    assert.equal(receipt.risk, 'HIGH');
    assert.deepEqual(receipt.areas, ['devices']);
    assert.deepEqual(receipt.expandedAreas, ['devices', 'products', 'search', 'seo']);
    assert.equal(receipt.extensions.changedAreas.includes('admin'), true);
    assert.equal(receipt.extensions.escalationReasons.includes('HIGH_RISK_AREA:admin'), true);
    assert.deepEqual(receipt.selectedChecks, []);
    assert.equal(executed, 0);
  } finally {
    rmSync(repository.cwd, { recursive: true, force: true });
  }
});

function fakeChromiumBrowser(outcomes) {
  const state = {
    screenshots: 0,
    traceStarts: 0,
    traceStops: 0,
    contextOptions: [],
    trafficSent: [],
    trafficBlocked: [],
    webSocketsSent: [],
    webSocketsBlocked: [],
  };
  let attempt = 0;
  return {
    state,
    browserType: () => ({ name: () => 'chromium' }),
    async newContext(options) {
      state.contextOptions.push(options);
      const outcome = outcomes[attempt++] ?? outcomes.at(-1);
      let consoleListener = () => {};
      let contextRouteHandler;
      let pageRouteHandler;
      let webSocketHandler;
      let currentUrl = 'about:blank';
      return {
        async route(_pattern, handler) { contextRouteHandler = handler; },
        async routeWebSocket(_pattern, handler) { webSocketHandler = handler; },
        tracing: {
          async start() { state.traceStarts += 1; },
          async stop(options = {}) {
            state.traceStops += 1;
            if (options.path) {
              mkdirSync(dirname(options.path), { recursive: true });
              writeFileSync(options.path, outcome.binarySentinel ?? 'retrievable trace');
            }
          },
        },
        async newPage() {
          return {
            on(event, listener) { if (event === 'console') consoleListener = listener; },
            off(event, listener) { if (event === 'console' && listener === consoleListener) consoleListener = () => {}; },
            async route(_pattern, handler) { pageRouteHandler = handler; },
            async goto(target) {
              const targetUrl = new URL(target);
              const requests = [
                { url: targetUrl.toString(), method: 'GET', navigation: true },
                ...(outcome.requests ?? []),
              ];
              for (const requestData of requests) {
                let blocked = false;
                const handler = requestData.popup ? contextRouteHandler : pageRouteHandler ?? contextRouteHandler;
                const request = {
                  url: () => requestData.url,
                  method: () => requestData.method ?? 'GET',
                  isNavigationRequest: () => requestData.navigation === true,
                };
                await handler?.({
                  request: () => request,
                  async abort() { blocked = true; state.trafficBlocked.push(requestData.url); },
                  async continue() { state.trafficSent.push(requestData.url); },
                });
                if (!handler) state.trafficSent.push(requestData.url);
                if (blocked && requestData.navigation) throw new Error('navigation blocked before traffic');
              }
              for (const webSocketUrl of outcome.webSockets ?? []) {
                if (webSocketHandler) {
                  await webSocketHandler({
                    url: () => webSocketUrl,
                    async close() { state.webSocketsBlocked.push(webSocketUrl); },
                  });
                } else {
                  state.webSocketsSent.push(webSocketUrl);
                }
              }
              if (outcome.console) consoleListener({ type: () => 'error', text: () => outcome.console });
              if (outcome.error) throw new Error(outcome.error);
              const pathname = targetUrl.pathname;
              const finalPath = pathname === '/devices/' ? '/products/' : pathname === '/forum/' ? '/feed/' : pathname;
              currentUrl = new URL(finalPath, targetUrl.origin).toString();
              const status = outcome.statuses?.[pathname] ?? outcome.status ??
                (pathname === '/api/admin/devices' || pathname === '/api/admin/forum/media' ? 401 : 200);
              return { status: () => status };
            },
            url: () => currentUrl,
            locator(selector) {
              const text = currentUrl.includes('/products/') ? '产品'
                : currentUrl.includes('/feed/') ? '帖子动态'
                  : currentUrl.includes('/login/') ? '登录 / 注册'
                    : currentUrl.includes('/admin/devices/') ? '/admin/devices'
                      : currentUrl.includes('/admin/media/') ? '/admin/media'
                        : '';
              return {
                async waitFor() { if (outcome.assertionError) throw new Error(outcome.assertionError); },
                async textContent() { return outcome.text ?? text; },
                selector,
              };
            },
            async waitForLoadState() {},
            async screenshot(options = {}) {
              state.screenshots += 1;
              if (options.path) {
                mkdirSync(dirname(options.path), { recursive: true });
                writeFileSync(options.path, outcome.binarySentinel ?? 'retrievable screenshot');
              }
              return Buffer.from('png');
            },
            async close() {},
          };
        },
        async close() {},
      };
    },
  };
}

test('targeted Chromium success returns compact evidence without heavy artifact requests', async () => {
  const browser = fakeChromiumBrowser([{ status: 200 }]);
  const result = await runTargetedBrowserCheck({
    group: 'products',
    baseUrl: 'http://127.0.0.1:4321',
    browser,
  });

  assert.equal(result.id, 'browser:products');
  assert.equal(result.status, 'PASS');
  assert.equal(result.attempts, 1);
  assert.equal(result.classification, 'DETERMINISTIC');
  assert.deepEqual(result.failureArtifactHints, []);
  assert.equal(result.details.firstAttempt, 'PASS');
  assert.equal(result.details.retryAttempt, null);
  assert.equal(browser.state.screenshots, 0);
});

test('targeted Chromium retains first-failure evidence requests across one successful retry', async () => {
  const browser = fakeChromiumBrowser([
    { error: 'page.goto: net::ERR_CONNECTION_RESET', console: 'first browser console error' },
    { status: 200 },
  ]);
  const result = await runTargetedBrowserCheck({
    group: 'devices',
    baseUrl: 'http://localhost:4321',
    browser,
  });

  assert.equal(result.status, 'PASS');
  assert.equal(result.attempts, 2);
  assert.equal(result.classification, 'TRANSIENT_RECOVERED');
  assert.equal(result.details.firstAttempt, 'FAIL');
  assert.equal(result.details.retryAttempt, 'PASS');
  assert.deepEqual(result.failureArtifactHints, [
    'browser:devices:first-attempt:console',
  ]);
  assert.equal(result.details.firstFailure.consoleErrors[0], 'first browser console error');
  assert.equal(result.details.firstFailure.screenshotCaptured, false);
  assert.equal(result.details.firstFailure.traceCaptured, false);
  assert.equal(browser.state.screenshots, 0);
});

test('targeted Chromium fails after one retry and never accepts a non-Chromium browser', async () => {
  const browser = fakeChromiumBrowser([
    { error: 'page.goto: net::ERR_CONNECTION_RESET' },
    { error: 'page.goto: net::ERR_CONNECTION_REFUSED' },
  ]);
  const result = await runTargetedBrowserCheck({
    group: 'forum',
    baseUrl: 'http://127.0.0.1:4321',
    browser,
  });

  assert.equal(result.status, 'FAIL');
  assert.equal(result.attempts, 2);
  assert.equal(result.details.firstAttempt, 'FAIL');
  assert.equal(result.details.retryAttempt, 'FAIL');
  assert.equal(browser.state.screenshots, 0);

  await assert.rejects(() => runTargetedBrowserCheck({
    group: 'forum',
    baseUrl: 'http://127.0.0.1:4321',
    browser: { ...browser, browserType: () => ({ name: () => 'firefox' }) },
  }), /Chromium/i);
});

test('targeted browser persists retrievable failure evidence only through an explicit sink', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'openglass-browser-artifacts-'));
  try {
    const sentinel = 'qa_binary_sentinel_never_persist';
    const browser = fakeChromiumBrowser([{
      error: 'page.goto: net::ERR_CONNECTION_RESET',
      console: `OPENAI_API_KEY=${sentinel}`,
      binarySentinel: sentinel,
    }, { status: 200 }]);
    const result = await runTargetedBrowserCheck({
      group: 'products',
      baseUrl: 'http://127.0.0.1:4321',
      browser,
      artifactSink: { directory },
    });

    const evidence = result.details.firstFailure;
    assert.equal(evidence.screenshotCaptured, false);
    assert.equal(evidence.traceCaptured, false);
    assert.equal(evidence.consoleCaptured, true);
    assert.equal(evidence.binaryEvidencePolicy, 'DISCARDED_UNREDACTABLE');
    assert.equal(evidence.artifacts.screenshot, null);
    assert.equal(evidence.artifacts.trace, null);
    assert.deepEqual(JSON.parse(readFileSync(evidence.artifacts.console, 'utf8')), ['OPENAI_API_KEY=[REDACTED]']);
    assert.equal(readdirSync(directory).some((name) => /\.(?:png|zip)$/i.test(name)), false);
    assert.equal(readdirSync(directory).some((name) => readFileSync(join(directory, name)).includes(sentinel)), false);
    assert.equal(browser.state.screenshots, 0);
    assert.equal(browser.state.traceStarts, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('targeted browser context guard blocks popup initial requests and all WebSockets', async () => {
  const popup = 'https://popup.example.test/initial';
  const socket = 'ws://127.0.0.1:4321/realtime';
  const browser = fakeChromiumBrowser([{
    requests: [{ url: popup, method: 'GET', popup: true }],
    webSockets: [socket],
  }]);
  const result = await runTargetedBrowserCheck({
    group: 'products',
    baseUrl: 'http://127.0.0.1:4321',
    browser,
  });

  assert.equal(result.status, 'FAIL');
  assert.equal(result.classification, 'SAFETY');
  assert.equal(result.attempts, 1);
  assert.equal(browser.state.trafficBlocked.includes(popup), true);
  assert.equal(browser.state.trafficSent.includes(popup), false);
  assert.equal(browser.state.webSocketsBlocked.includes(socket), true);
  assert.equal(browser.state.webSocketsSent.includes(socket), false);
});

test('targeted browser blocks cross-origin and mutating traffic before it is sent', async () => {
  const external = 'https://cdn.example.test/client.js';
  const mutation = 'http://127.0.0.1:4321/api/forum/posts';
  const browser = fakeChromiumBrowser([{
    requests: [
      { url: external, method: 'GET' },
      { url: mutation, method: 'POST' },
    ],
  }]);
  const result = await runTargetedBrowserCheck({
    group: 'products',
    baseUrl: 'http://127.0.0.1:4321',
    browser,
  });

  assert.equal(result.status, 'FAIL');
  assert.equal(result.classification, 'SAFETY');
  assert.equal(result.attempts, 1);
  assert.deepEqual(browser.state.contextOptions, [{ serviceWorkers: 'block' }]);
  assert.equal(browser.state.trafficBlocked.includes(external), true);
  assert.equal(browser.state.trafficBlocked.includes(mutation), true);
  assert.equal(browser.state.trafficSent.includes(external), false);
  assert.equal(browser.state.trafficSent.includes(mutation), false);
});

test('targeted browser permits read-only traffic to another loopback port', async () => {
  const localDependency = 'http://127.0.0.1:54321/auth/v1/settings';
  const browser = fakeChromiumBrowser([{
    requests: [{ url: localDependency, method: 'GET' }],
  }]);
  const result = await runTargetedBrowserCheck({
    group: 'products',
    baseUrl: 'http://127.0.0.1:4321',
    browser,
  });

  assert.equal(result.status, 'PASS');
  assert.equal(browser.state.trafficSent.includes(localDependency), true);
  assert.equal(browser.state.trafficBlocked.includes(localDependency), false);
});

test('targeted browser retries transient navigation errors but not HTTP or assertion failures', async () => {
  const httpBrowser = fakeChromiumBrowser([{ status: 503 }, { status: 200 }]);
  const http = await runTargetedBrowserCheck({ group: 'products', baseUrl: 'http://127.0.0.1:4321', browser: httpBrowser });
  assert.equal(http.status, 'FAIL');
  assert.equal(http.classification, 'DETERMINISTIC');
  assert.equal(http.attempts, 1);

  const assertionBrowser = fakeChromiumBrowser([{ assertionError: 'required product region missing' }, { status: 200 }]);
  const assertion = await runTargetedBrowserCheck({ group: 'products', baseUrl: 'http://127.0.0.1:4321', browser: assertionBrowser });
  assert.equal(assertion.status, 'FAIL');
  assert.equal(assertion.classification, 'DETERMINISTIC');
  assert.equal(assertion.attempts, 1);

  const setupBrowser = fakeChromiumBrowser([{ error: 'browser fixture setup failed' }, { status: 200 }]);
  const setup = await runTargetedBrowserCheck({ group: 'products', baseUrl: 'http://127.0.0.1:4321', browser: setupBrowser });
  assert.equal(setup.status, 'FAIL');
  assert.equal(setup.classification, 'DETERMINISTIC');
  assert.equal(setup.attempts, 1);
});

test('each targeted group enforces its scoped route and surface contract', async () => {
  const expected = {
    admin: ['status:/api/admin/devices=401', 'text:h1.community-page-title=/admin/devices'],
    auth: ['text:h1=登录 / 注册', 'visible:.auth-page'],
    devices: ['redirect:/devices/->/products/', 'visible:#products-brand-grid'],
    forum: ['redirect:/forum/->/feed/', 'text:.community-stream-head h2=帖子动态'],
    media: ['status:/api/admin/forum/media=401', 'text:h1.community-page-title=/admin/media'],
    products: ['text:h1=产品', 'visible:#products-brand-grid'],
  };

  for (const [group, assertions] of Object.entries(expected)) {
    const result = await runTargetedBrowserCheck({
      group,
      baseUrl: 'http://127.0.0.1:4321',
      browser: fakeChromiumBrowser([{}]),
    });
    assert.equal(result.status, 'PASS', group);
    assert.deepEqual(result.details.assertions, assertions, group);
  }
});

test('targeted browser groups are real local surfaces and exclude guessed Compare coverage', async () => {
  const groups = Object.values(manifest.areas).flatMap((area) => area.e2eProjectsOrTags).sort();
  assert.deepEqual(groups, ['admin', 'auth', 'devices', 'forum', 'media', 'products']);
  assert.equal(groups.includes('compare'), false);
  for (const name of groups) {
    assert.deepEqual(getArea(name).e2eProjectsOrTags, [name]);
  }

  await assert.rejects(() => runTargetedBrowserCheck({
    group: 'compare',
    baseUrl: 'http://127.0.0.1:4321',
    browser: fakeChromiumBrowser([{ status: 200 }]),
  }), /unknown browser group/i);
});

test('targeted browser adapter rejects non-local origins before opening Chromium context', async () => {
  const browser = fakeChromiumBrowser([{ status: 200 }]);
  await assert.rejects(() => runTargetedBrowserCheck({
    group: 'devices',
    baseUrl: 'https://openglasshub.ogh.workers.dev',
    browser,
  }), /local.*baseUrl/i);
  assert.equal(browser.state.traceStarts, 0);
});
