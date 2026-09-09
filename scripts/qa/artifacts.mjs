import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { redactValue } from './receipt.mjs';

const MAX_STRING_LENGTH = 1_024;
const MAX_KEYS = 24;
const MAX_ARRAY_ITEMS = 12;

function bounded(value) {
  if (typeof value === 'string') return value.length <= MAX_STRING_LENGTH ? value : `${value.slice(0, MAX_STRING_LENGTH)}…[TRUNCATED]`;
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY_ITEMS).map(bounded);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().slice(0, MAX_KEYS).map((key) => [key, bounded(value[key])]));
  }
  return value;
}

function failureName(id, index) {
  return `${String(id ?? `failure-${index + 1}`).replace(/[^a-z0-9._-]/gi, '-')}.json`;
}

function artifactPaths(receipt, hasFailures) {
  const base = `artifacts/qa/${receipt.runId}`;
  return { receipt: `${base}/receipt.json`, failureDir: hasFailures ? `${base}/failure` : null };
}

function serializedReceipt(receipt) {
  const safe = redactValue(receipt);
  const payload = Object.fromEntries(Object.entries(safe).map(([key, value]) => [key, bounded(value)]));
  // These are contract collections, not sampled diagnostics. Their complete
  // membership must agree with selection and result counters in the receipt.
  for (const key of ['areas', 'expandedAreas', 'selectedChecks', 'skippedChecks']) {
    payload[key] = safe[key].map(bounded);
  }
  if (Array.isArray(safe.extensions?.checkResults)) {
    payload.extensions.checkResults = safe.extensions.checkResults.map(bounded);
  }
  return payload;
}

export async function writeFailureArtifacts({ receipt, failures = [], artifactRoot = 'artifacts/qa' } = {}) {
  if (!receipt || receipt.schemaVersion !== 'openglass-qa/v1' || typeof receipt.runId !== 'string' || !receipt.result || !receipt.completedAt || !Number.isFinite(receipt.durationMs) || !Number.isInteger(receipt.passCount) || !Number.isInteger(receipt.failCount) || !receipt.safety) throw new TypeError('INVALID_ARTIFACTS: finalized v1 receipt is required');
  if (!Array.isArray(failures)) throw new TypeError('INVALID_ARTIFACTS: failures must be an array');
  if (typeof artifactRoot !== 'string' || !artifactRoot) throw new TypeError('INVALID_ARTIFACTS: artifactRoot must be a non-empty string');
  const hasFailures = failures.length > 0 || receipt.failCount > 0 || receipt.result === 'FAIL';
  const artifacts = artifactPaths(receipt, hasFailures);
  const runDirectory = join(artifactRoot, receipt.runId);
  await mkdir(runDirectory, { recursive: true, mode: 0o700 });
  await writeFile(join(runDirectory, 'receipt.json'), `${JSON.stringify(serializedReceipt({ ...receipt, artifacts }))}\n`, { encoding: 'utf8', mode: 0o600 });
  if (!hasFailures) return artifacts;
  const failureDirectory = join(runDirectory, 'failure');
  await mkdir(failureDirectory, { recursive: true, mode: 0o700 });
  const entries = failures.length > 0 ? failures : [{ id: 'run-failure', error: receipt.error }];
  for (const [index, failure] of entries.entries()) {
    const payload = bounded(redactValue(failure));
    await writeFile(join(failureDirectory, failureName(failure?.id, index)), `${JSON.stringify(payload)}\n`, { encoding: 'utf8', mode: 0o600 });
  }
  return artifacts;
}
