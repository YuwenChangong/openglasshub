import { closeBrowserLifecycle, runUiCaseWithLiveness } from '../p6b-local-e2e-runner.mjs';
import { redactValue } from '../receipt.mjs';

const MAX_CONSOLE_ERRORS = 12;
const MAX_CONSOLE_LENGTH = 512;

const browserGroups = Object.freeze({
  admin: Object.freeze({ routes: Object.freeze(['/admin/devices/']) }),
  auth: Object.freeze({ routes: Object.freeze(['/login/']) }),
  devices: Object.freeze({ routes: Object.freeze(['/devices/']) }),
  forum: Object.freeze({ routes: Object.freeze(['/forum/']) }),
  media: Object.freeze({ routes: Object.freeze(['/admin/media/']) }),
  products: Object.freeze({ routes: Object.freeze(['/products/']) }),
});

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
  const localHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  if (!localHost || !['http:', 'https:'].includes(url.protocol)) fail('local baseUrl must use an HTTP origin');
  if (url.username || url.password || url.search || url.hash) fail('baseUrl must not contain credentials, query, or fragment');
  return url.origin;
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

async function runRoutes({ page, baseUrl, definition }) {
  for (const route of definition.routes) {
    const target = new URL(route, baseUrl).toString();
    const response = await page.goto(target, { waitUntil: 'domcontentloaded' });
    const status = response?.status?.();
    if (!Number.isInteger(status) || status < 200 || status >= 400) {
      throw new Error(`browser route failed: ${route} status=${Number.isInteger(status) ? status : 'none'}`);
    }
    await page.locator('body').waitFor({ state: 'visible' });
  }
}

async function requestFailureEvidence({ group, attempt, page, context, consoleErrors, traceStarted }) {
  let screenshotCaptured = false;
  let traceCaptured = false;
  try {
    await page?.screenshot?.({ fullPage: true, type: 'png' });
    screenshotCaptured = true;
  } catch {
    // Artifact hints remain authoritative when browser capture itself fails.
  }
  if (traceStarted) {
    try {
      await context?.tracing?.stop?.();
      traceCaptured = true;
    } catch {
      // Preserve the failed check even if trace finalization also fails.
    }
  }
  const label = attempt === 1 ? 'first-attempt' : 'retry-attempt';
  return {
    hints: [
      `browser:${group}:${label}:console`,
      `browser:${group}:${label}:screenshot`,
      `browser:${group}:${label}:trace`,
    ],
    evidence: {
      consoleErrors: [...consoleErrors],
      screenshotCaptured,
      traceCaptured,
    },
  };
}

async function runAttempt({ group, definition, baseUrl, browser, attempt }) {
  let context;
  let page;
  let traceStarted = false;
  let traceStopped = false;
  const consoleErrors = [];
  let onConsole;
  try {
    context = await browser.newContext();
    await context.tracing?.start?.({ screenshots: true, snapshots: true, sources: false });
    traceStarted = true;
    page = await context.newPage();
    onConsole = consoleListener(consoleErrors);
    page.on?.('console', onConsole);
    const caseResult = await runUiCaseWithLiveness({
      caseId: `QA-BROWSER-${group.toUpperCase()}-${attempt}`,
      expected: `${group} local browser routes`,
      action: () => runRoutes({ page, baseUrl, definition }),
      timeoutMs: 45_000,
    });
    if (caseResult.result === 'PASS') {
      if (traceStarted) {
        await context.tracing?.stop?.();
        traceStopped = true;
      }
      return { status: 'PASS', consoleErrors };
    }
    const captured = await requestFailureEvidence({ group, attempt, page, context, consoleErrors, traceStarted });
    traceStopped = traceStarted;
    return {
      status: 'FAIL',
      error: safeMessage(caseResult.observed),
      consoleErrors: captured.evidence.consoleErrors,
      screenshotCaptured: captured.evidence.screenshotCaptured,
      traceCaptured: captured.evidence.traceCaptured,
      hints: captured.hints,
    };
  } catch (error) {
    const captured = await requestFailureEvidence({ group, attempt, page, context, consoleErrors, traceStarted });
    traceStopped = traceStarted;
    return {
      status: 'FAIL',
      error: safeMessage(error instanceof Error ? error.message : error),
      consoleErrors: captured.evidence.consoleErrors,
      screenshotCaptured: captured.evidence.screenshotCaptured,
      traceCaptured: captured.evidence.traceCaptured,
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

export async function runTargetedBrowserCheck({ group, baseUrl, browser } = {}) {
  const started = Date.now();
  const definition = groupDefinition(group);
  const origin = localBaseUrl(baseUrl);
  const chromium = chromiumBrowser(browser);
  const first = await runAttempt({ group, definition, baseUrl: origin, browser: chromium, attempt: 1 });
  if (first.status === 'PASS') {
    return {
      id: `browser:${group}`,
      status: 'PASS',
      classification: 'DETERMINISTIC',
      durationMs: Date.now() - started,
      attempts: 1,
      summary: `${group} targeted browser check passed`,
      details: { browser: 'chromium', group, routes: [...definition.routes], firstAttempt: 'PASS', retryAttempt: null },
      retryable: true,
      failureArtifactHints: [],
    };
  }

  const retry = await runAttempt({ group, definition, baseUrl: origin, browser: chromium, attempt: 2 });
  const failureArtifactHints = [...new Set([...(first.hints ?? []), ...(retry.status === 'FAIL' ? retry.hints ?? [] : [])])].sort();
  return {
    id: `browser:${group}`,
    status: retry.status,
    classification: retry.status === 'PASS' ? 'TRANSIENT_RECOVERED' : 'TRANSIENT',
    durationMs: Date.now() - started,
    attempts: 2,
    summary: retry.status === 'PASS' ? `${group} targeted browser check recovered` : `${group} targeted browser check failed`,
    details: {
      browser: 'chromium',
      group,
      routes: [...definition.routes],
      firstAttempt: 'FAIL',
      retryAttempt: retry.status,
      firstFailure: {
        error: first.error,
        consoleErrors: first.consoleErrors ?? [],
        screenshotCaptured: first.screenshotCaptured === true,
        traceCaptured: first.traceCaptured === true,
      },
      ...(retry.status === 'FAIL' ? {
        retryFailure: {
          error: retry.error,
          consoleErrors: retry.consoleErrors ?? [],
          screenshotCaptured: retry.screenshotCaptured === true,
          traceCaptured: retry.traceCaptured === true,
        },
      } : {}),
    },
    retryable: true,
    failureArtifactHints,
  };
}
