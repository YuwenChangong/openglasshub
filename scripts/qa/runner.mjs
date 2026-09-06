import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { writeFailureArtifacts } from './artifacts.mjs';
import { runCheck } from './check-registry.mjs';
import { createRunContext, normalizeCheckResult, parseInvocation, QAInvocationValidationError, QA_PROFILES } from './contracts.mjs';
import { resolveFastChecks } from './profiles/fast.mjs';
import { resolveFeatureChecks, runFeatureCheck } from './profiles/feature.mjs';
import { resolveReleaseChecks, runReleaseCheck } from './profiles/release.mjs';
import { createReceipt, finalizeReceipt, redactValue, renderSummary } from './receipt.mjs';
import { classifyChanges, collectChangedPaths, resolveComparisonBase, RiskClassificationError } from './risk.mjs';
import { expandDependencies } from './manifest.mjs';

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

function currentBranch(cwd) {
  const branch = execFileSync('git', ['branch', '--show-current'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  if (!branch) throw new RiskClassificationError('BASE_UNRESOLVED', 'detached HEAD has no branch comparison contract');
  return branch;
}

export function resolveFastRunContext({ cwd = process.cwd(), mainRef = 'origin/main' } = {}) {
  const branch = currentBranch(cwd);
  const baseSha = resolveComparisonBase({ branch, mainRef, cwd });
  const paths = collectChangedPaths({ baseSha, cwd });
  const classification = classifyChanges({ paths });
  const context = createRunContext({
    profile: QA_PROFILES.FAST,
    risk: classification.risk,
    commitSha: currentCommit(cwd),
    baseSha,
    changedPathsCount: paths.length,
  });
  return Object.freeze({
    ...context,
    directAreas: classification.directAreas,
    expandedAreas: classification.expandedAreas,
    changedPaths: classification.paths,
    releaseRequired: classification.releaseRequired,
    escalationReasons: classification.escalationReasons,
  });
}

export function resolveFeatureRunContext({ cwd = process.cwd(), mainRef = 'origin/main', explicitArea = null } = {}) {
  const branch = currentBranch(cwd);
  const baseSha = resolveComparisonBase({ branch, mainRef, cwd });
  const paths = collectChangedPaths({ baseSha, cwd });
  const changedClassification = classifyChanges({ paths });
  const combinedClassification = classifyChanges({ paths, explicitArea });
  const directAreas = explicitArea ? [explicitArea] : [...changedClassification.directAreas];
  const expandedAreas = expandDependencies(directAreas);
  const context = createRunContext({
    profile: QA_PROFILES.FEATURE,
    area: explicitArea,
    areas: directAreas,
    risk: combinedClassification.risk,
    commitSha: currentCommit(cwd),
    baseSha,
    changedPathsCount: paths.length,
  });
  return Object.freeze({
    ...context,
    directAreas: Object.freeze(directAreas),
    expandedAreas: Object.freeze(expandedAreas),
    changedAreas: changedClassification.directAreas,
    changedExpandedAreas: changedClassification.expandedAreas,
    changedPaths: changedClassification.paths,
    releaseRequired: combinedClassification.releaseRequired,
    escalationReasons: combinedClassification.escalationReasons,
  });
}

export function resolveReleaseRunContext({ cwd = process.cwd(), mainRef = 'origin/main' } = {}) {
  const branch = currentBranch(cwd);
  const baseSha = resolveComparisonBase({ branch, mainRef, cwd });
  const paths = collectChangedPaths({ baseSha, cwd });
  const classification = classifyChanges({ paths });
  const context = createRunContext({
    profile: QA_PROFILES.RELEASE,
    risk: classification.risk,
    commitSha: currentCommit(cwd),
    baseSha,
    changedPathsCount: paths.length,
  });
  return Object.freeze({
    ...context,
    directAreas: classification.directAreas,
    expandedAreas: classification.expandedAreas,
    changedPaths: classification.paths,
    releaseRequired: classification.releaseRequired,
    escalationReasons: classification.escalationReasons,
  });
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

export async function executeFastRun({
  argv = ['fast'],
  cwd = process.cwd(),
  mainRef = 'origin/main',
  artifactRoot = 'artifacts/qa',
  runCheckFn = runCheck,
  write = (value) => process.stdout.write(value),
} = {}) {
  const invocation = parseRun(argv);
  if (invocation.profile !== QA_PROFILES.FAST) {
    throw new QAInvocationValidationError('INVALID_INVOCATION: this runner profile is not implemented yet');
  }
  const context = resolveFastRunContext({ cwd, mainRef });
  const selection = resolveFastChecks(context);
  const startedAt = new Date().toISOString();
  const receiptDraft = createReceipt({
    runId: `qa-${randomUUID()}`,
    profile: QA_PROFILES.FAST,
    areas: context.directAreas,
    expandedAreas: selection.areas,
    risk: selection.risk,
    commitSha: context.commitSha,
    baseSha: context.baseSha,
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
        results.push(normalizeCheckResult(await runCheckFn(id, executionContext)));
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
  const artifacts = await writeFailureArtifacts({ receipt, failures, artifactRoot });
  write(`${renderProfileOutput(receipt)}\n${renderSummary(receipt)}\nQA_RECEIPT=${artifacts.receipt}\n`);
  return receipt;
}

export async function executeFeatureRun({
  argv = ['feature'],
  cwd = process.cwd(),
  mainRef = 'origin/main',
  artifactRoot = 'artifacts/qa',
  runCheckFn = runFeatureCheck,
  write = (value) => process.stdout.write(value),
} = {}) {
  const invocation = parseRun(argv);
  if (invocation.profile !== QA_PROFILES.FEATURE) {
    throw new QAInvocationValidationError('INVALID_INVOCATION: expected FEATURE profile');
  }
  const context = resolveFeatureRunContext({ cwd, mainRef, explicitArea: invocation.area });
  const selection = resolveFeatureChecks(context);
  const startedAt = new Date().toISOString();
  const receiptDraft = createReceipt({
    runId: `qa-${randomUUID()}`,
    profile: QA_PROFILES.FEATURE,
    areas: context.directAreas,
    expandedAreas: selection.areas,
    risk: selection.risk,
    commitSha: context.commitSha,
    baseSha: context.baseSha,
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
        results.push(normalizeCheckResult(await runCheckFn(id, executionContext)));
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

  const extensions = {
    changedAreas: context.changedAreas,
    changedExpandedAreas: context.changedExpandedAreas,
    escalationReasons: context.escalationReasons,
  };
  if (selection.blocked) extensions.blockedReason = selection.blockedReason;
  const receipt = finalizeReceipt(receiptDraft, {
    completedAt: new Date().toISOString(),
    checkResults: results,
    result: selection.blocked ? 'BLOCKED' : undefined,
    error: selection.blocked ? { code: 'RELEASE_REQUIRED', requiredProfile: 'qa:release' } : null,
    extensions,
  });
  const failures = results.filter(({ status }) => status === 'FAIL');
  const artifacts = await writeFailureArtifacts({ receipt, failures, artifactRoot });
  write(`${renderProfileOutput(receipt)}\n${renderSummary(receipt)}\nQA_RECEIPT=${artifacts.receipt}\n`);
  return receipt;
}

export async function executeReleaseRun({
  argv = ['release'],
  cwd = process.cwd(),
  mainRef = 'origin/main',
  artifactRoot = 'artifacts/qa',
  runCheckFn = runReleaseCheck,
  write = (value) => process.stdout.write(value),
} = {}) {
  const invocation = parseRun(argv);
  if (invocation.profile !== QA_PROFILES.RELEASE) {
    throw new QAInvocationValidationError('INVALID_INVOCATION: expected RELEASE profile');
  }
  const context = resolveReleaseRunContext({ cwd, mainRef });
  const selection = resolveReleaseChecks(context);
  const runId = `qa-${randomUUID()}`;
  const receiptDraft = createReceipt({
    runId,
    profile: QA_PROFILES.RELEASE,
    areas: context.directAreas,
    expandedAreas: selection.areas,
    risk: selection.risk,
    commitSha: context.commitSha,
    baseSha: context.baseSha,
    changedPathsCount: context.changedPathsCount,
    selectedChecks: selection.selectedChecks,
    skippedChecks: selection.skippedChecks,
    startedAt: new Date().toISOString(),
    safety: {
      productionReadOnly: false,
      productionDbConnections: 0,
      productionMutations: 0,
      providerMutations: 0,
    },
  });

  const results = [];
  const executionContext = {
    ...context,
    cwd,
    env: safeChildEnvironment(),
    artifactRoot: resolve(cwd, artifactRoot, runId),
  };
  for (const { id } of selection.selectedChecks) {
    try {
      results.push(normalizeCheckResult(await runCheckFn(id, executionContext)));
    } catch (error) {
      results.push(normalizeCheckResult({
        id,
        status: 'FAIL',
        classification: 'DETERMINISTIC',
        diagnostics: redactValue({ code: error?.code ?? 'CHECK_EXCEPTION', message: error?.message ?? 'check failed' }),
      }));
    }
  }

  const receipt = finalizeReceipt(receiptDraft, {
    completedAt: new Date().toISOString(),
    checkResults: results,
    extensions: { escalationReasons: context.escalationReasons },
  });
  const failures = results.filter(({ status }) => status === 'FAIL');
  const artifacts = await writeFailureArtifacts({ receipt, failures, artifactRoot });
  write(`${renderProfileOutput(receipt)}\n${renderSummary(receipt)}\nQA_RECEIPT=${artifacts.receipt}\n`);
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const argv = process.argv.slice(2);
    const invocation = parseRun(argv);
    const receipt = invocation.profile === QA_PROFILES.FAST
      ? await executeFastRun({ argv })
      : invocation.profile === QA_PROFILES.FEATURE
        ? await executeFeatureRun({ argv })
        : invocation.profile === QA_PROFILES.RELEASE
          ? await executeReleaseRun({ argv })
          : (() => { throw new QAInvocationValidationError('INVALID_INVOCATION: this runner profile is not implemented yet'); })();
    if (receipt.result !== 'PASS') process.exitCode = receipt.result === 'BLOCKED' ? 2 : 1;
  } catch (error) {
    process.stderr.write(`QA_RESULT=FAIL\nQA_ERROR=${error?.code ?? 'HARNESS_FAILURE'}\n`);
    process.exitCode = 2;
  }
}
