import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { getCheck } from './check-registry.mjs';
import { getArea, manifest } from './manifest.mjs';
import { runTargetedBrowserCheck } from './checks/playwright.mjs';
import { resolveFastChecks } from './profiles/fast.mjs';
import { resolveFeatureChecks } from './profiles/feature.mjs';
import { executeFastRun, executeFeatureRun, renderProfileOutput } from './runner.mjs';

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

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

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

test('package exposes only the implemented fast and feature public profiles', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  const qaScripts = Object.keys(packageJson.scripts).filter((name) => name.startsWith('qa:')).sort();

  assert.deepEqual(qaScripts, ['qa:fast', 'qa:feature']);
  assert.equal(packageJson.scripts['qa:fast'], 'node scripts/qa/runner.mjs fast');
  assert.equal(packageJson.scripts['qa:feature'], 'node scripts/qa/runner.mjs feature');
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
  const state = { screenshots: 0, traceStarts: 0, traceStops: 0 };
  let attempt = 0;
  return {
    state,
    browserType: () => ({ name: () => 'chromium' }),
    async newContext() {
      const outcome = outcomes[attempt++] ?? outcomes.at(-1);
      let consoleListener = () => {};
      return {
        tracing: {
          async start() { state.traceStarts += 1; },
          async stop() { state.traceStops += 1; },
        },
        async newPage() {
          return {
            on(event, listener) { if (event === 'console') consoleListener = listener; },
            off(event, listener) { if (event === 'console' && listener === consoleListener) consoleListener = () => {}; },
            async goto() {
              if (outcome.console) consoleListener({ type: () => 'error', text: () => outcome.console });
              if (outcome.error) throw new Error(outcome.error);
              return { status: () => outcome.status ?? 200 };
            },
            locator() { return { waitFor: async () => {} }; },
            async screenshot() { state.screenshots += 1; return Buffer.from('png'); },
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
    { error: 'transient navigation failure', console: 'first browser console error' },
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
    'browser:devices:first-attempt:screenshot',
    'browser:devices:first-attempt:trace',
  ]);
  assert.equal(result.details.firstFailure.consoleErrors[0], 'first browser console error');
  assert.equal(browser.state.screenshots, 1);
});

test('targeted Chromium fails after one retry and never accepts a non-Chromium browser', async () => {
  const browser = fakeChromiumBrowser([{ status: 503 }, { error: 'still unavailable' }]);
  const result = await runTargetedBrowserCheck({
    group: 'forum',
    baseUrl: 'http://127.0.0.1:4321',
    browser,
  });

  assert.equal(result.status, 'FAIL');
  assert.equal(result.attempts, 2);
  assert.equal(result.details.firstAttempt, 'FAIL');
  assert.equal(result.details.retryAttempt, 'FAIL');
  assert.equal(browser.state.screenshots, 2);

  await assert.rejects(() => runTargetedBrowserCheck({
    group: 'forum',
    baseUrl: 'http://127.0.0.1:4321',
    browser: { ...browser, browserType: () => ({ name: () => 'firefox' }) },
  }), /Chromium/i);
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
