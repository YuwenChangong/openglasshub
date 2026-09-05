import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { closeBrowserLifecycle, runUiCaseWithLiveness } from '../p6b-local-e2e-runner.mjs';
import { redactValue } from '../receipt.mjs';

const MAX_CONSOLE_ERRORS = 12;
const MAX_CONSOLE_LENGTH = 512;
const TRANSIENT_NETWORK = 'TARGETED_BROWSER_TRANSIENT_NETWORK';
const DETERMINISTIC_HTTP = 'TARGETED_BROWSER_HTTP_FAILURE';
const DETERMINISTIC_ASSERTION = 'TARGETED_BROWSER_ASSERTION_FAILURE';
const SAFETY_FAILURE = 'TARGETED_BROWSER_TRAFFIC_REJECTED';

const browserGroups = Object.freeze({
  admin: Object.freeze({
    steps: Object.freeze([
      Object.freeze({ route: '/admin/devices/', statuses: Object.freeze([200]), text: Object.freeze({ selector: 'h1.community-page-title', value: '/admin/devices' }) }),
      Object.freeze({ route: '/api/admin/devices', statuses: Object.freeze([401, 403]), protectedNegativeAuth: true }),
    ]),
  }),
  auth: Object.freeze({
    steps: Object.freeze([
      Object.freeze({ route: '/login/', statuses: Object.freeze([200]), text: Object.freeze({ selector: 'h1', value: '登录 / 注册' }), visible: '.auth-page' }),
    ]),
  }),
  devices: Object.freeze({
    steps: Object.freeze([
      Object.freeze({ route: '/devices/', statuses: Object.freeze([200]), finalPath: '/products/', visible: '#products-brand-grid' }),
    ]),
  }),
  forum: Object.freeze({
    steps: Object.freeze([
      Object.freeze({ route: '/forum/', statuses: Object.freeze([200]), finalPath: '/feed/', text: Object.freeze({ selector: '.community-stream-head h2', value: '帖子动态' }) }),
    ]),
  }),
  media: Object.freeze({
    steps: Object.freeze([
      Object.freeze({ route: '/admin/media/', statuses: Object.freeze([200]), text: Object.freeze({ selector: 'h1.community-page-title', value: '/admin/media' }) }),
      Object.freeze({ route: '/api/admin/forum/media', statuses: Object.freeze([401, 403]), protectedNegativeAuth: true }),
    ]),
  }),
  products: Object.freeze({
    steps: Object.freeze([
      Object.freeze({ route: '/products/', statuses: Object.freeze([200]), text: Object.freeze({ selector: 'h1', value: '产品' }), visible: '#products-brand-grid' }),
    ]),
  }),
});

class BrowserCheckFailure extends Error {
  constructor(message, failureClassification) {
    super(message);
    this.name = 'BrowserCheckFailure';
    this.failureClassification = failureClassification;
  }
}

function fail(message) {
  throw new TypeError(`TARGETED_BROWSER_INVALID: ${message}`);
}

function localBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail('baseUrl must be a valid local URL');
  }
  if (!isLoopbackHostname(url.hostname) || !['http:', 'https:'].includes(url.protocol)) fail('local baseUrl must use an HTTP origin');
  if (url.username || url.password || url.search || url.hash) fail('baseUrl must not contain credentials, query, or fragment');
  return url.origin;
}

function isLoopbackHostname(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function chromiumBrowser(value) {
  if (!value || typeof value !== 'object' || typeof value.newContext !== 'function') {
    fail('browser must be a launched Chromium-compatible browser');
  }
  const name = value.browserType?.().name?.();
  if (name !== 'chromium') fail('only a Chromium-compatible browser is supported in v1');
  return value;
}

function groupDefinition(name) {
  if (typeof name !== 'string' || !Object.hasOwn(browserGroups, name)) fail(`unknown browser group: ${String(name)}`);
  return browserGroups[name];
}

function artifactDirectory(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || typeof value.directory !== 'string' || !value.directory.trim()) {
    fail('artifactSink.directory must be a non-empty path');
  }
  return resolve(value.directory);
}

function artifactPaths(directory, group, attempt) {
  if (!directory) return null;
  const label = attempt === 1 ? 'first-attempt' : 'retry-attempt';
  return Object.freeze({
    screenshot: join(directory, `${group}-${label}.png`),
    trace: join(directory, `${group}-${label}.zip`),
    console: join(directory, `${group}-${label}-console.json`),
  });
}

function safeMessage(value) {
  const message = redactValue(String(value ?? 'browser check failed'));
  return message.length <= MAX_CONSOLE_LENGTH ? message : `${message.slice(0, MAX_CONSOLE_LENGTH)}…[TRUNCATED]`;
}

function consoleListener(errors) {
  return (message) => {
    if (message?.type?.() !== 'error' || errors.length >= MAX_CONSOLE_ERRORS) return;
    errors.push(safeMessage(message.text?.()));
  };
}

function rejectTraffic(violations, reason, method, url) {
  if (violations.length === 0) violations.push(Object.freeze({ reason, method, url: safeMessage(url) }));
}

async function installTrafficGuard({ page, violations }) {
  if (typeof page?.route !== 'function') throw new BrowserCheckFailure('browser page does not support traffic interception', DETERMINISTIC_ASSERTION);
  await page.route('**/*', async (route) => {
    const request = route.request();
    const method = String(request.method?.() ?? '').toUpperCase();
    let url;
    try {
      url = new URL(request.url?.());
    } catch {
      rejectTraffic(violations, 'invalid_url', method, request.url?.());
      await route.abort('blockedbyclient');
      return;
    }
    if (!['GET', 'HEAD'].includes(method)) {
      rejectTraffic(violations, 'mutating_method', method, url.toString());
      await route.abort('blockedbyclient');
      return;
    }
    if (!['http:', 'https:'].includes(url.protocol) || !isLoopbackHostname(url.hostname) || url.username || url.password) {
      rejectTraffic(violations, 'non_loopback_origin', method, url.toString());
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
}

function assertTrafficSafe(violations) {
  if (violations.length === 0) return;
  const first = violations[0];
  throw new BrowserCheckFailure(`browser traffic rejected: ${first.reason} ${first.method}`, SAFETY_FAILURE);
}

function isTransientNetworkFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:\bECONNRESET\b|\bECONNREFUSED\b|\bETIMEDOUT\b|\bEAI_AGAIN\b|net::ERR_(?:CONNECTION_(?:RESET|REFUSED|CLOSED)|NETWORK_CHANGED|TIMED_OUT)\b)/i.test(message);
}

async function navigate(page, target, violations) {
  try {
    const response = await page.goto(target, { waitUntil: 'domcontentloaded' });
    assertTrafficSafe(violations);
    return response;
  } catch (error) {
    assertTrafficSafe(violations);
    throw new BrowserCheckFailure(
      error instanceof Error ? error.message : String(error),
      isTransientNetworkFailure(error) ? TRANSIENT_NETWORK : DETERMINISTIC_ASSERTION,
    );
  }
}

async function assertVisible(page, selector) {
  try {
    await page.locator(selector).waitFor({ state: 'visible' });
  } catch (error) {
    throw new BrowserCheckFailure(error instanceof Error ? error.message : String(error), DETERMINISTIC_ASSERTION);
  }
}

async function assertText(page, assertion) {
  try {
    const locator = page.locator(assertion.selector);
    await locator.waitFor({ state: 'visible' });
    const actual = String(await locator.textContent() ?? '').trim();
    if (actual !== assertion.value) throw new Error(`expected ${assertion.value}, observed ${actual || 'empty'}`);
  } catch (error) {
    throw new BrowserCheckFailure(error instanceof Error ? error.message : String(error), DETERMINISTIC_ASSERTION);
  }
}

async function runGroup({ page, baseUrl, definition, violations }) {
  const assertions = [];
  for (const step of definition.steps) {
    const response = await navigate(page, new URL(step.route, baseUrl).toString(), violations);
    const status = response?.status?.();
    if (!Number.isInteger(status) || !step.statuses.includes(status)) {
      throw new BrowserCheckFailure(
        `browser route failed: ${step.route} status=${Number.isInteger(status) ? status : 'none'}`,
        DETERMINISTIC_HTTP,
      );
    }
    if (step.protectedNegativeAuth) assertions.push(`status:${step.route}=${status}`);
    if (step.finalPath) {
      let finalPath;
      try { finalPath = new URL(page.url()).pathname; } catch { finalPath = null; }
      if (finalPath !== step.finalPath) throw new BrowserCheckFailure(`browser redirect failed: ${step.route}`, DETERMINISTIC_ASSERTION);
      assertions.push(`redirect:${step.route}->${step.finalPath}`);
    }
    if (step.text) {
      await assertText(page, step.text);
      assertions.push(`text:${step.text.selector}=${step.text.value}`);
    }
    if (step.visible) {
      await assertVisible(page, step.visible);
      assertions.push(`visible:${step.visible}`);
    }
    await page.waitForLoadState?.('load');
    assertTrafficSafe(violations);
  }
  return Object.freeze(assertions.sort());
}

function failureKind(failureClassification) {
  if (failureClassification === TRANSIENT_NETWORK) return 'TRANSIENT';
  if (failureClassification === SAFETY_FAILURE) return 'SAFETY';
  return 'DETERMINISTIC';
}

async function retrievable(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function requestFailureEvidence({ group, attempt, page, context, consoleErrors, traceStarted, paths }) {
  let screenshotCaptured = false;
  let traceCaptured = false;
  let consoleCaptured = false;
  if (paths) {
    await mkdir(dirname(paths.screenshot), { recursive: true, mode: 0o700 });
    try {
      await page?.screenshot?.({ fullPage: true, type: 'png', path: paths.screenshot });
      screenshotCaptured = await retrievable(paths.screenshot);
    } catch {
      screenshotCaptured = false;
    }
    if (traceStarted) {
      try {
        await context?.tracing?.stop?.({ path: paths.trace });
        traceCaptured = await retrievable(paths.trace);
      } catch {
        traceCaptured = false;
      }
    }
    try {
      await writeFile(paths.console, `${JSON.stringify(consoleErrors)}\n`, { encoding: 'utf8', mode: 0o600 });
      consoleCaptured = await retrievable(paths.console);
    } catch {
      consoleCaptured = false;
    }
  }
  const label = attempt === 1 ? 'first-attempt' : 'retry-attempt';
  return {
    hints: [
      `browser:${group}:${label}:console`,
      `browser:${group}:${label}:screenshot`,
      `browser:${group}:${label}:trace`,
    ],
    traceStopped: traceStarted,
    evidence: {
      consoleErrors: [...consoleErrors],
      screenshotCaptured,
      traceCaptured,
      consoleCaptured,
      artifacts: {
        screenshot: screenshotCaptured ? paths.screenshot : null,
        trace: traceCaptured ? paths.trace : null,
        console: consoleCaptured ? paths.console : null,
      },
    },
  };
}

async function runAttempt({ group, definition, baseUrl, browser, attempt, artifactRoot }) {
  let context;
  let page;
  let traceStarted = false;
  let traceStopped = false;
  const consoleErrors = [];
  const violations = [];
  const paths = artifactPaths(artifactRoot, group, attempt);
  let onConsole;
  try {
    context = await browser.newContext({ serviceWorkers: 'block' });
    if (paths) {
      await mkdir(dirname(paths.trace), { recursive: true, mode: 0o700 });
      if (typeof context.tracing?.start === 'function' && typeof context.tracing?.stop === 'function') {
        await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
        traceStarted = true;
      }
    }
    page = await context.newPage();
    await installTrafficGuard({ page, violations });
    onConsole = consoleListener(consoleErrors);
    page.on?.('console', onConsole);
    const caseResult = await runUiCaseWithLiveness({
      caseId: `QA-BROWSER-${group.toUpperCase()}-${attempt}`,
      expected: `${group} scoped local browser contract`,
      action: async () => ({ assertions: await runGroup({ page, baseUrl, definition, violations }) }),
      timeoutMs: 45_000,
    });
    if (caseResult.result === 'PASS') {
      if (traceStarted) {
        await context.tracing.stop();
        traceStopped = true;
      }
      return { status: 'PASS', assertions: caseResult.assertions ?? [] };
    }
    const captured = await requestFailureEvidence({ group, attempt, page, context, consoleErrors, traceStarted, paths });
    traceStopped = captured.traceStopped;
    return {
      status: 'FAIL',
      kind: failureKind(caseResult.failureClassification),
      error: safeMessage(caseResult.observed),
      ...captured.evidence,
      hints: captured.hints,
    };
  } catch (error) {
    const captured = await requestFailureEvidence({ group, attempt, page, context, consoleErrors, traceStarted, paths });
    traceStopped = captured.traceStopped;
    return {
      status: 'FAIL',
      kind: failureKind(error?.failureClassification),
      error: safeMessage(error instanceof Error ? error.message : error),
      ...captured.evidence,
      hints: captured.hints,
    };
  } finally {
    page?.off?.('console', onConsole);
    if (traceStarted && !traceStopped) {
      try { await context?.tracing?.stop?.(); } catch {}
    }
    await closeBrowserLifecycle({ page, context });
  }
}

function failureDetails(failure) {
  return {
    error: failure.error,
    consoleErrors: failure.consoleErrors ?? [],
    screenshotCaptured: failure.screenshotCaptured === true,
    traceCaptured: failure.traceCaptured === true,
    consoleCaptured: failure.consoleCaptured === true,
    artifacts: failure.artifacts ?? { screenshot: null, trace: null, console: null },
  };
}

function resultBase({ group, definition, started }) {
  return {
    id: `browser:${group}`,
    durationMs: Date.now() - started,
    details: {
      browser: 'chromium',
      group,
      routes: definition.steps.map(({ route }) => route),
    },
  };
}

export async function runTargetedBrowserCheck({ group, baseUrl, browser, artifactSink } = {}) {
  const started = Date.now();
  const definition = groupDefinition(group);
  const origin = localBaseUrl(baseUrl);
  const chromium = chromiumBrowser(browser);
  const artifactRoot = artifactDirectory(artifactSink);
  const first = await runAttempt({ group, definition, baseUrl: origin, browser: chromium, attempt: 1, artifactRoot });
  const base = resultBase({ group, definition, started });
  if (first.status === 'PASS') {
    return {
      ...base,
      status: 'PASS',
      classification: 'DETERMINISTIC',
      attempts: 1,
      summary: `${group} targeted browser check passed`,
      details: { ...base.details, assertions: [...first.assertions], firstAttempt: 'PASS', retryAttempt: null },
      retryable: false,
      failureArtifactHints: [],
    };
  }

  if (first.kind !== 'TRANSIENT') {
    return {
      ...base,
      status: 'FAIL',
      classification: first.kind,
      attempts: 1,
      summary: `${group} targeted browser check failed`,
      details: { ...base.details, assertions: [], firstAttempt: 'FAIL', retryAttempt: null, firstFailure: failureDetails(first) },
      retryable: false,
      failureArtifactHints: [...new Set(first.hints ?? [])].sort(),
    };
  }

  const retry = await runAttempt({ group, definition, baseUrl: origin, browser: chromium, attempt: 2, artifactRoot });
  const failureArtifactHints = [...new Set([...(first.hints ?? []), ...(retry.status === 'FAIL' ? retry.hints ?? [] : [])])].sort();
  return {
    ...base,
    status: retry.status,
    classification: retry.status === 'PASS' ? 'TRANSIENT_RECOVERED' : retry.kind,
    attempts: 2,
    summary: retry.status === 'PASS' ? `${group} targeted browser check recovered` : `${group} targeted browser check failed`,
    details: {
      ...base.details,
      assertions: retry.status === 'PASS' ? [...retry.assertions] : [],
      firstAttempt: 'FAIL',
      retryAttempt: retry.status,
      firstFailure: failureDetails(first),
      ...(retry.status === 'FAIL' ? { retryFailure: failureDetails(retry) } : {}),
    },
    retryable: retry.status === 'FAIL' && retry.kind === 'TRANSIENT',
    failureArtifactHints,
  };
}
