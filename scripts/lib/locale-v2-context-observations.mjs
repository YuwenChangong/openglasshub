import assert from 'node:assert/strict';

export function createContextObservations({ collect, ledger, onPass = () => {} }) {
  ledger.assertionsTotal ??= 0; ledger.assertionsPassed ??= 0; ledger.failures ??= [];
  const run = (assertion, name) => {
    ledger.assertionsTotal++;
    try { assertion(); }
    catch (error) {
      if (error.code !== 'ERR_ASSERTION') throw error;
      ledger.failures.push(name);
      if (!collect) throw error;
      return;
    }
    ledger.assertionsPassed++; onPass(name);
  };
  return {
    check: (condition, name) => run(() => assert.ok(condition, name), name),
    equal: (actual, expected, name) => run(() => assert.deepEqual(actual, expected, name), name),
    finish: () => assert.equal(ledger.failures.length, 0, 'CONTEXT1_READ_ONLY_OBSERVATIONS_FAILED'),
  };
}
