import { createRunContext, normalizeCheckResult, parseInvocation } from './contracts.mjs';
import { pathToFileURL } from 'node:url';

export { QA_PROFILES, RISK_LEVELS, QAInvocationValidationError, createRunContext, normalizeCheckResult, parseInvocation } from './contracts.mjs';

export function parseRun(argv = process.argv.slice(2)) {
  return createRunContext(parseInvocation(argv));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(parseRun())}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}
