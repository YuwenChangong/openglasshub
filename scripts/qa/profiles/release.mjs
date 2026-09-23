import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';
import { registerCheck, runCheck } from '../check-registry.mjs';
import { runTargetedBrowserCheck } from '../checks/playwright.mjs';
import { normalizeCheckResult, QA_PROFILES } from '../contracts.mjs';
import { executeCommand } from '../process-executor.mjs';
import { closeBrowserLifecycle } from '../p6b-local-e2e-runner.mjs';
import { redactValue } from '../receipt.mjs';
import { unstable_readConfig } from 'wrangler';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const NODE = process.execPath;
const NPM = process.platform === 'win32'
  ? Object.freeze([NODE, join(dirname(NODE), 'node_modules', 'npm', 'bin', 'npm-cli.js')])
  : Object.freeze(['npm']);
const WRANGLER = join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const LOCAL_WORKER_CONFIG = join(ROOT, 'dist', 'server', 'wrangler.json');
const productionConfig = unstable_readConfig(
  { config: join(ROOT, 'wrangler.toml'), env: 'production' },
  { hideWarnings: true },
);
const productionSiteOrigin = (() => {
  const value = productionConfig.vars?.SITE_ORIGIN;
  if (typeof value !== 'string' || !value.trim()) return null;
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) throw new TypeError('RELEASE SITE_ORIGIN must be a credential-free origin');
  return url.origin;
})();

const COMMANDS = Object.freeze({
  'admin-device-api': Object.freeze([NODE, 'scripts/test-device-admin-api.mjs']),
  'admin-profile-role-security': Object.freeze([NODE, 'scripts/audit-profile-role-security.mjs', '--strict', '--verbose']),
  'auth-legal-consent': Object.freeze([NODE, 'scripts/test-auth-legal-acknowledgement.mjs']),
  'auth-redirect-safety': Object.freeze([NODE, '--experimental-strip-types', 'scripts/test-auth-redirect-safety.mjs']),
  'database-migration-versions': Object.freeze([NODE, 'scripts/qa/validate-supabase-migration-versions.mjs']),
  'devices-library': Object.freeze([NODE, 'scripts/test-device-library.mjs']),
  'devices-public-data': Object.freeze([NODE, 'scripts/test-public-device-data.mjs']),
  'forum-permissions': Object.freeze([NODE, 'scripts/verify-forum-permissions.cjs']),
  'forum-search': Object.freeze([NODE, '--experimental-strip-types', 'scripts/test-search.mjs']),
  'frontend-astro-build': Object.freeze([NODE, 'scripts/build-workers.mjs']),
  'git-diff-check': Object.freeze(['git', 'diff', '--check']),
  'media-url-privacy': Object.freeze([NODE, 'scripts/audit-media-url-privacy.mjs', '--strict', '--verbose']),
  'news-api-safety': Object.freeze([NODE, 'scripts/test-public-news-api-safety.mjs']),
  'products-page': Object.freeze([NODE, 'scripts/test-product-page.mjs']),
  'project-test': Object.freeze([...NPM, 'test']),
  'qa-harness-core': Object.freeze([NODE, '--test', 'scripts/qa/test-qa-harness-core.mjs']),
  'qa-harness-executor': Object.freeze([NODE, '--test', 'scripts/qa/test-qa-harness-executor.mjs']),
  'qa-harness-manifest': Object.freeze([NODE, '--test', 'scripts/qa/test-qa-harness-manifest.mjs']),
  'qa-harness-profiles': Object.freeze([NODE, '--test', 'scripts/qa/test-qa-harness-profiles.mjs']),
  'qa-harness-receipt': Object.freeze([NODE, '--test', 'scripts/qa/test-qa-harness-receipt.mjs']),
  'qa-harness-risk': Object.freeze([NODE, '--test', 'scripts/qa/test-qa-harness-risk.mjs']),
  'release-b-postgres-adapter-runtime-isolation': Object.freeze([NODE, 'scripts/qa/test-release-b-postgres-adapter-runtime-isolation.mjs']),
  search: Object.freeze([NODE, '--experimental-strip-types', 'scripts/test-search.mjs']),
  'security-headers': Object.freeze([NODE, 'scripts/test-security-headers.mjs']),
  'security-privilege-convergence': Object.freeze([NODE, '--test', 'scripts/qa/test-security-privilege-convergence.mjs']),
  seo: Object.freeze([NODE, 'scripts/verify-seo.cjs']),
  'supabase-config': Object.freeze([NODE, 'scripts/qa/test-workers-environment-contract.mjs']),
  'targeted-browser-contracts': Object.freeze([
    NODE,
    '--test',
    '--test-name-pattern=targeted browser|targeted Chromium|targeted group',
    'scripts/qa/test-qa-harness-profiles.mjs',
  ]),
  'user-profile-api-safety': Object.freeze([NODE, 'scripts/test-user-profile-api-safety.mjs']),
  'user-summary-api-safety': Object.freeze([NODE, 'scripts/test-user-summary-api-safety.mjs']),
  'workers-artifact': Object.freeze([NODE, 'scripts/qa/test-workers-generated-artifact.mjs']),
  'workers-config': Object.freeze([NODE, 'scripts/qa/test-workers-native-config.mjs']),
  'workers-release-guard': Object.freeze([NODE, 'scripts/qa/test-workers-builds-release-guard.mjs']),
});

const REAL_BROWSER_CHECK_ID = 'targeted-browser-journey';
const SELECTED_IDS = Object.freeze([...Object.keys(COMMANDS), REAL_BROWSER_CHECK_ID].sort());
const DATABASE_AREA_CHECK_IDS = Object.freeze([
  'database-migration-versions',
  'release-b-postgres-adapter-runtime-isolation',
]);
const FORBIDDEN_CHECKS = Object.freeze([
  Object.freeze({ id: 'database-replay', reason: 'release_verification_forbids_database_replay' }),
  Object.freeze({ id: 'deployment', reason: 'release_verification_forbids_deployment' }),
  Object.freeze({ id: 'production-smoke', reason: 'release_profile_has_no_production_network' }),
  Object.freeze({ id: 'provider-operations', reason: 'release_verification_forbids_provider_operations' }),
]);

function registerReleaseCommand(id, argv) {
  registerCheck({
    id: `release:${id}`,
    allowedProfiles: [QA_PROFILES.RELEASE],
    timeoutMs: id === 'frontend-astro-build' ? 240_000 : id === 'project-test' ? 180_000 : 90_000,
    retryPolicy: { classification: 'LOCAL', maxRetries: 0 },
    artifactPolicy: { onFailure: true, onSuccess: false },
    classification: 'DETERMINISTIC',
    async run(context, check) {
      const commandEnvironment = id === 'seo' && productionSiteOrigin
        ? { ...(context.env ?? {}), SITE_ORIGIN: productionSiteOrigin }
        : context.env ?? {};
      const result = await executeCommand({
        argv,
        cwd: context.cwd ?? ROOT,
        env: commandEnvironment,
        timeoutMs: check.timeoutMs,
        retryPolicy: check.retryPolicy,
      });
      return normalizeCheckResult({
        id,
        status: result.exitCode === 0 && !result.timedOut && result.signal === null ? 'PASS' : 'FAIL',
        attempts: result.attempts,
        durationMs: result.durationMs,
        classification: 'DETERMINISTIC',
        diagnostics: result.diagnostics,
      });
    },
  });
}

for (const [id, argv] of Object.entries(COMMANDS)) registerReleaseCommand(id, argv);

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : null;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (!Number.isInteger(port)) throw new Error('LOCAL_WORKER_PORT_UNAVAILABLE');
  return port;
}

function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      child.off?.('exit', onExit);
      resolve(false);
    }, timeoutMs);
    child.once('exit', onExit);
  });
}

function terminateWindowsProcessTree(pid, timeoutMs) {
  return new Promise((resolve) => {
    execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      timeout: timeoutMs,
      windowsHide: true,
    }, (error) => resolve(!error));
  });
}

function signalPosixProcessGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false;
  }
}

function posixProcessGroupExists(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

async function waitForPosixGroupRelease(pid, deadline, { groupExists, now, delay }) {
  while (now() < deadline) {
    if (!groupExists(pid)) return true;
    await delay(Math.min(100, Math.max(1, deadline - now())));
  }
  return !groupExists(pid);
}

export async function terminatePosixProcessTree(pid, timeoutMs, dependencies = {}) {
  const signalGroup = dependencies.signalGroup ?? signalPosixProcessGroup;
  const groupExists = dependencies.groupExists ?? posixProcessGroupExists;
  const now = dependencies.now ?? Date.now;
  const delay = dependencies.delay ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const startedAt = now();
  const deadline = startedAt + timeoutMs;
  const termDeadline = startedAt + Math.floor(timeoutMs / 2);
  signalGroup(pid, 'SIGTERM');
  if (await waitForPosixGroupRelease(pid, termDeadline, { groupExists, now, delay })) return true;
  signalGroup(pid, 'SIGKILL');
  return waitForPosixGroupRelease(pid, deadline, { groupExists, now, delay });
}

function portAvailable(port) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}

async function waitForPortRelease(port, timeoutMs) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
  const deadline = Date.now() + timeoutMs;
  do {
    if (await portAvailable(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  return false;
}

export async function stopLocalWorker(handle, dependencies = {}) {
  const child = handle?.child;
  const timeoutMs = 5_000;
  const platform = dependencies.platform ?? process.platform;
  const terminateTree = dependencies.terminateTree ??
    (platform === 'win32' ? terminateWindowsProcessTree : terminatePosixProcessTree);
  const probePort = dependencies.probePort ?? waitForPortRelease;
  let processTreeStopped = !child || child.exitCode !== null || child.signalCode !== null;
  let treeTerminationConfirmed = false;
  if (!processTreeStopped) {
    treeTerminationConfirmed = await terminateTree(child.pid, timeoutMs).catch(() => false) === true;
    processTreeStopped = await waitForChildExit(child, timeoutMs);
    if (!processTreeStopped && platform !== 'win32') {
      child.kill('SIGKILL');
      processTreeStopped = await waitForChildExit(child, timeoutMs);
    }
  }
  const portReleased = await probePort(handle?.port, timeoutMs).catch(() => false);
  return Object.freeze({
    treeTerminationConfirmed,
    processTreeStopped,
    portReleased,
    serverStopped: treeTerminationConfirmed && processTreeStopped && portReleased,
  });
}

async function startLocalWorker({ cwd = ROOT, env = {} } = {}) {
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(NODE, [
    WRANGLER, 'dev', '--config', LOCAL_WORKER_CONFIG, '--local', '--ip', '127.0.0.1', '--port', String(port),
  ], {
    cwd,
    env: { ...env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
    shell: false,
    detached: process.platform !== 'win32',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let childFailure = null;
  child.once('error', (error) => { childFailure = error; });
  child.once('exit', (code, signal) => {
    if (code !== 0 && signal === null) childFailure = new Error(`LOCAL_WORKER_EXIT_${code}`);
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  const handle = { child, port };
  const deadline = Date.now() + 30_000;
  try {
    while (Date.now() < deadline) {
      if (childFailure) throw childFailure;
      try {
        const response = await fetch(`${baseUrl}/login/`, { signal: AbortSignal.timeout(1_000) });
        if (response.status === 200) return { baseUrl, handle };
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('LOCAL_WORKER_READINESS_TIMEOUT');
  } catch (error) {
    const cleanup = await stopLocalWorker(handle);
    const failure = new Error(cleanup.serverStopped
      ? error.message
      : `${error.message}; LOCAL_WORKER_STARTUP_CLEANUP_FAILED`);
    failure.cleanup = cleanup;
    throw failure;
  }
}

function failureClassification(value) {
  return ['DETERMINISTIC', 'TRANSIENT', 'TRANSIENT_RECOVERED', 'SAFETY', 'VALIDATION'].includes(value)
    ? value
    : 'DETERMINISTIC';
}

export async function runReleaseTargetedBrowserJourney({
  cwd = ROOT,
  env = {},
  artifactRoot = 'artifacts/qa',
  dependencies = {},
} = {}) {
  const lifecycle = {
    browserClosed: false,
    treeTerminationConfirmed: false,
    processTreeStopped: false,
    portReleased: false,
    serverStopped: false,
  };
  const startServer = dependencies.startServer ?? startLocalWorker;
  const launchBrowser = dependencies.launchBrowser ?? (() => chromium.launch({ headless: true }));
  const runAdapter = dependencies.runAdapter ?? runTargetedBrowserCheck;
  const closeBrowser = dependencies.closeBrowser ?? ((browser) => closeBrowserLifecycle({ browser }));
  const stopServer = dependencies.stopServer ?? stopLocalWorker;
  let server;
  let browser;
  let adapterResult;
  let lifecycleError = null;
  try {
    server = await startServer({ cwd, env });
    browser = await launchBrowser();
    adapterResult = await runAdapter({
      group: 'auth',
      baseUrl: server.baseUrl,
      browser,
      artifactSink: { directory: resolve(cwd, artifactRoot, 'release-targeted-browser') },
    });
  } catch (error) {
    lifecycleError = error;
    if (error?.cleanup) Object.assign(lifecycle, error.cleanup);
  } finally {
    if (browser) lifecycle.browserClosed = await closeBrowser(browser).catch(() => false);
    else lifecycle.browserClosed = true;
    if (server?.handle) {
      const cleanup = await stopServer(server.handle).catch(() => false);
      if (cleanup === true) Object.assign(lifecycle, {
        treeTerminationConfirmed: true,
        processTreeStopped: true,
        portReleased: true,
        serverStopped: true,
      });
      else if (cleanup && typeof cleanup === 'object') Object.assign(lifecycle, {
        treeTerminationConfirmed: cleanup.treeTerminationConfirmed === true,
        processTreeStopped: cleanup.processTreeStopped === true,
        portReleased: cleanup.portReleased === true,
        serverStopped: cleanup.serverStopped === true,
      });
    } else if (!lifecycleError?.cleanup) {
      Object.assign(lifecycle, {
        treeTerminationConfirmed: true,
        processTreeStopped: true,
        portReleased: true,
        serverStopped: true,
      });
    }
  }

  const cleanupPassed = lifecycle.browserClosed && lifecycle.serverStopped;
  const status = !lifecycleError && adapterResult?.status === 'PASS' && cleanupPassed ? 'PASS' : 'FAIL';
  return normalizeCheckResult({
    id: REAL_BROWSER_CHECK_ID,
    status,
    attempts: adapterResult?.attempts ?? 1,
    classification: status === 'PASS' ? failureClassification(adapterResult?.classification) :
      cleanupPassed ? failureClassification(adapterResult?.classification) : 'SAFETY',
    diagnostics: redactValue({
      adapterId: adapterResult?.id ?? 'browser:auth',
      summary: adapterResult?.summary ?? lifecycleError?.message ?? 'real local browser journey failed',
      failureArtifactHints: adapterResult?.failureArtifactHints ?? [],
      adapterDetails: adapterResult?.details ?? null,
      lifecycle,
    }),
  });
}

registerCheck({
  id: `release:${REAL_BROWSER_CHECK_ID}`,
  allowedProfiles: [QA_PROFILES.RELEASE],
  timeoutMs: 120_000,
  retryPolicy: { classification: 'LOCAL', maxRetries: 0 },
  artifactPolicy: { onFailure: true, onSuccess: false },
  classification: 'DETERMINISTIC',
  run(context) {
    return runReleaseTargetedBrowserJourney({
      cwd: context.cwd ?? ROOT,
      env: context.env ?? {},
      artifactRoot: context.artifactRoot ?? 'artifacts/qa',
      dependencies: context.browserJourneyDependencies ?? {},
    });
  },
});

export function resolveReleaseChecks(context = {}) {
  if (!context || typeof context !== 'object' || Array.isArray(context)) throw new TypeError('RELEASE context must be an object');
  if (context.profile !== QA_PROFILES.RELEASE) throw new TypeError('RELEASE resolver requires profile RELEASE');
  if (!['LOW', 'MEDIUM', 'HIGH'].includes(context.risk)) throw new TypeError('RELEASE context requires a valid risk');
  const areas = context.expandedAreas ?? [];
  if (!Array.isArray(areas) || areas.some((name) => typeof name !== 'string' || !name)) {
    throw new TypeError('RELEASE context areas must be an array of names');
  }

  const databaseRequired = areas.includes('database');
  const selectedIds = databaseRequired
    ? SELECTED_IDS
    : SELECTED_IDS.filter((id) => !DATABASE_AREA_CHECK_IDS.includes(id));
  const skippedChecks = databaseRequired
    ? FORBIDDEN_CHECKS
    : [
        ...FORBIDDEN_CHECKS,
        ...DATABASE_AREA_CHECK_IDS.map((id) => Object.freeze({ id, reason: 'database_area_not_changed' })),
      ]
      .sort((left, right) => left.id.localeCompare(right.id));
  return Object.freeze({
    profile: QA_PROFILES.RELEASE,
    risk: context.risk,
    areas: Object.freeze([...new Set(areas)].sort()),
    blocked: false,
    requiredProfile: null,
    blockedReason: null,
    selectedChecks: Object.freeze(selectedIds.map((id) => Object.freeze({ id, kind: 'command' }))),
    skippedChecks: Object.freeze(skippedChecks.map((entry) => Object.freeze({ ...entry }))),
  });
}

export async function runReleaseCheck(id, context = {}) {
  if (!SELECTED_IDS.includes(id)) {
    const error = new TypeError(`RELEASE_CHECK_UNAVAILABLE: ${id}`);
    error.code = 'RELEASE_CHECK_UNAVAILABLE';
    throw error;
  }
  return runCheck(`release:${id}`, context);
}
