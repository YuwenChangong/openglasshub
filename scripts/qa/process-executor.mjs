import { spawn } from 'node:child_process';

const OUTPUT_LIMIT = 4_096;
const SENSITIVE_NAME = /(authorization|password|secret|token|api[_-]?key|service[_-]?role|anon[_-]?key|dsn)/i;

export class ProcessExecutionError extends TypeError {
  constructor(message) {
    super(`INVALID_EXECUTION: ${message}`);
    this.name = 'ProcessExecutionError';
    this.code = 'INVALID_EXECUTION';
  }
}

function fail(message) {
  throw new ProcessExecutionError(message);
}

function normalizeArgv(argv) {
  if (!Array.isArray(argv) || argv.length === 0 || argv.some((part) => typeof part !== 'string' || !part.length)) {
    fail('argv must be a non-empty array of non-empty strings');
  }
  return [...argv];
}

function normalizeEnv(env) {
  if (!env || typeof env !== 'object' || Array.isArray(env)) fail('env must be an object');
  return Object.fromEntries(Object.entries(env).map(([key, value]) => [key, String(value)]));
}

function normalizeRetryPolicy(policy) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) fail('retryPolicy must be an object');
  if (!['LOCAL', 'NETWORK'].includes(policy.classification)) fail('retryPolicy classification must be LOCAL or NETWORK');
  if (!Number.isInteger(policy.maxRetries) || policy.maxRetries < 0 || policy.maxRetries > 1) fail('retryPolicy maxRetries must be 0 or 1');
  if (policy.classification === 'LOCAL' && policy.maxRetries !== 0) fail('local executions cannot retry');
  return { classification: policy.classification, maxRetries: policy.maxRetries };
}

function boundedAppend(current, chunk) {
  if (current.length >= OUTPUT_LIMIT) return current;
  return `${current}${chunk}`.slice(0, OUTPUT_LIMIT);
}

function createRedactor(env) {
  const values = Object.entries(env)
    .filter(([key, value]) => SENSITIVE_NAME.test(key) && value)
    .map(([, value]) => value)
    .sort((left, right) => right.length - left.length);
  return (input) => {
    let result = String(input ?? '');
    for (const value of values) result = result.replaceAll(value, '[REDACTED]');
    result = result.replace(/\b([A-Z][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY|SERVICE_ROLE|ANON_KEY)[A-Z0-9_]*)=([^\s]+)/gi, '$1=[REDACTED]');
    result = result.replace(/(postgres(?:ql)?:\/\/)([^\s@/:]+)(?::[^\s@/]*)?@/gi, '$1[REDACTED]@');
    result = result.replace(/\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g, '[REDACTED]');
    return result;
  };
}

function firstFatalLine(stdout, stderr) {
  const lines = `${stderr}\n${stdout}`.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.find((line) => /\b(fatal|error|fail(?:ed|ure)?)\b/i.test(line)) ?? lines[0] ?? null;
}

function executeOnce({ argv, cwd, env, timeoutMs, redact }) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let spawnError = null;
    let settled = false;
    const child = spawn(argv[0], argv.slice(1), { cwd, env, shell: false, windowsHide: true });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout = boundedAppend(stdout, chunk.toString()); });
    child.stderr.on('data', (chunk) => { stderr = boundedAppend(stderr, chunk.toString()); });
    child.once('error', (error) => { spawnError = error.message; });
    child.once('close', (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const rawFatal = firstFatalLine(stdout, stderr) ?? (spawnError ? `error: ${spawnError}` : null);
      resolve(Object.freeze({
        exitCode: exitCode ?? (spawnError ? 1 : null),
        signal: signal ?? null,
        timedOut,
        durationMs: Date.now() - startedAt,
        stdout: redact(stdout),
        stderr: redact(stderr),
        firstFatalLine: rawFatal ? redact(rawFatal) : null,
      }));
    });
  });
}

function failed(result) {
  return result.timedOut || result.exitCode !== 0 || result.signal !== null;
}

export async function executeCommand({ argv, cwd, env, timeoutMs, retryPolicy }) {
  const normalizedArgv = normalizeArgv(argv);
  if (typeof cwd !== 'string' || !cwd) fail('cwd must be a non-empty string');
  const normalizedEnv = normalizeEnv(env);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) fail('timeoutMs must be a positive integer');
  const normalizedRetryPolicy = normalizeRetryPolicy(retryPolicy);
  const redact = createRedactor(normalizedEnv);
  const attemptResults = [];
  do {
    attemptResults.push(await executeOnce({
      argv: normalizedArgv,
      cwd,
      env: normalizedEnv,
      timeoutMs,
      redact,
    }));
  } while (failed(attemptResults.at(-1)) &&
           normalizedRetryPolicy.classification === 'NETWORK' &&
           attemptResults.length <= normalizedRetryPolicy.maxRetries);

  const last = attemptResults.at(-1);
  const firstFailure = attemptResults.find(failed);
  return Object.freeze({
    ...last,
    attempts: attemptResults.length,
    attemptResults: Object.freeze(attemptResults),
    diagnostics: Object.freeze({
      stdout: last.stdout,
      stderr: last.stderr,
      firstFatalLine: firstFailure?.firstFatalLine ?? last.firstFatalLine,
    }),
  });
}
