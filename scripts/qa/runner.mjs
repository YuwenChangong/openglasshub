import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import { writeFailureArtifacts } from './artifacts.mjs';
import { runCheck } from './check-registry.mjs';
import { createRunContext, normalizeCheckResult, parseInvocation, QAInvocationValidationError, QA_PROFILES } from './contracts.mjs';
import { resolveFastChecks } from './profiles/fast.mjs';
import { createReceipt, finalizeReceipt, redactValue, renderSummary } from './receipt.mjs';

export { QA_PROFILES, RISK_LEVELS, QAInvocationValidationError, createRunContext, normalizeCheckResult, parseInvocation } from './contracts.mjs';

export function parseRun(argv = process.argv.slice(2)) {
  return createRunContext(parseInvocation(argv));
}

const SAFE_ENV_NAMES = Object.freeze([
  'CI', 'ComSpec', 'FORCE_COLOR', 'NO_COLOR', 'Path', 'PATH', 'PATHEXT',
  'SystemRoot', 'TEMP', 'TMP', 'WINDIR',
]);

function safeChildEnvironment(source = process.env) {
  return Object.fromEntries(SAFE_ENV_NAMES.flatMap((name) =>
    typeof source[name] === 'string' ? [[name, source[name]]] : []));
}

function currentCommit(cwd) {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim().toLowerCase();
}

export function renderProfileOutput(receipt) {
  const selected = receipt.selectedChecks.map(({ id }) => id).sort().join(',') || '-';
  const skipped = receipt.skippedChecks
    .map(({ id, reason }) => `${id}:${reason}`)
    .sort()
    .join(',') || '-';
  return [
    `QA_PROFILE=${receipt.qaProfile}`,
    `RISK=${receipt.risk}`,
    `SELECTED_CHECKS=${selected}`,
    `SKIPPED_EXPENSIVE_CHECKS=${skipped}`,
    `QA_RESULT=${receipt.result}`,
  ].join('\n');
}

export async function executeFastRun({ argv = ['fast'], cwd = process.cwd(), write = (value) => process.stdout.write(value) } = {}) {
  const context = parseRun(argv);
  if (context.profile !== QA_PROFILES.FAST) {
    throw new QAInvocationValidationError('INVALID_INVOCATION: this runner profile is not implemented yet');
  }
  const selection = resolveFastChecks(context);
  const startedAt = new Date().toISOString();
  const receiptDraft = createReceipt({
    runId: `qa-${randomUUID()}`,
    profile: QA_PROFILES.FAST,
    areas: selection.areas,
    expandedAreas: selection.areas,
    risk: selection.risk,
    commitSha: currentCommit(cwd),
    baseSha: null,
    changedPathsCount: context.changedPathsCount,
    selectedChecks: selection.selectedChecks,
    skippedChecks: selection.skippedChecks,
    startedAt,
    safety: {
      productionReadOnly: false,
      productionDbConnections: 0,
      productionMutations: 0,
      providerMutations: 0,
    },
  });

  const results = [];
  if (!selection.blocked) {
    const executionContext = { ...context, cwd, env: safeChildEnvironment() };
    for (const { id } of selection.selectedChecks) {
      try {
        results.push(await runCheck(id, executionContext));
      } catch (error) {
        results.push(normalizeCheckResult({
          id,
          status: 'FAIL',
          classification: 'DETERMINISTIC',
          diagnostics: redactValue({ code: error?.code ?? 'CHECK_EXCEPTION', message: error?.message ?? 'check failed' }),
        }));
      }
    }
  }

  const receipt = finalizeReceipt(receiptDraft, {
    completedAt: new Date().toISOString(),
    checkResults: results,
    result: selection.blocked ? 'BLOCKED' : undefined,
    error: selection.blocked ? { code: 'RELEASE_REQUIRED', requiredProfile: 'qa:release' } : null,
    extensions: selection.blocked ? { blockedReason: selection.blockedReason } : {},
  });
  const failures = results.filter(({ status }) => status === 'FAIL');
  const artifacts = await writeFailureArtifacts({ receipt, failures });
  write(`${renderProfileOutput(receipt)}\n${renderSummary(receipt)}\nQA_RECEIPT=${artifacts.receipt}\n`);
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const receipt = await executeFastRun();
    if (receipt.result !== 'PASS') process.exitCode = receipt.result === 'BLOCKED' ? 2 : 1;
  } catch (error) {
    process.stderr.write(`QA_RESULT=FAIL\nQA_ERROR=${error?.code ?? 'HARNESS_FAILURE'}\n`);
    process.exitCode = 2;
  }
}
