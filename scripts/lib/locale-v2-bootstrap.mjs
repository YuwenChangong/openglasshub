import assert from 'node:assert/strict';

const steps = Object.freeze(['LOCAL_SUPABASE_READY', 'WORKER_HANDLE_RETURNED',
  'APPLICATION_GETCF_RETURNED', 'APPLICATION_GETWORKER_RETURNED', 'DIRECT_APP_DISPATCH_READY']);

export function createAcceptanceBootstrap(record) {
  Object.assign(record, Object.fromEntries(steps.map(step => [step, false])),
    { result: 'PENDING', activeStage: steps[0], browserReleased: false });
  let next = 0;
  const requireStep = step => {
    assert.equal(record.result, 'PENDING', 'BOOTSTRAP_TERMINAL');
    assert.equal(step, steps[next], 'BOOTSTRAP_STAGE_ORDER');
  };
  const block = () => {
    if (record.result !== 'PENDING') return;
    record.failedStage ??= record.activeStage;
    record.result = 'BLOCKED';
  };
  const complete = step => {
    requireStep(step); record[step] = true; next++;
    record.activeStage = steps[next] ?? null;
    if (next === steps.length) record.result = 'PASS';
  };
  return {
    complete, block,
    async attempt(step, operation) {
      requireStep(step);
      try { const value = await operation(); complete(step); return value; }
      catch (error) { block(); throw error; }
    },
    releaseBrowser() {
      assert.equal(record.result, 'PASS', 'BOOTSTRAP_NOT_READY');
      assert.ok(steps.every(step => record[step] === true), 'BOOTSTRAP_NOT_READY');
      assert.equal(record.browserReleased, false, 'BROWSER_PHASE_ALREADY_RELEASED');
      record.browserReleased = true;
    },
  };
}
