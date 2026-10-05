import assert from 'node:assert/strict';
import test from 'node:test';
import { createAcceptanceBootstrap } from './lib/locale-v2-bootstrap.mjs';
import { createDirectAppDispatch } from './lib/locale-v2-direct-app-transport.mjs';

const steps = ['LOCAL_SUPABASE_READY', 'WORKER_HANDLE_RETURNED', 'APPLICATION_GETCF_RETURNED',
  'APPLICATION_GETWORKER_RETURNED', 'DIRECT_APP_DISPATCH_READY'];

test('browser is blocked at every pre-terminal stage and success releases exactly once', async () => {
  const record = {}, gate = createAcceptanceBootstrap(record); let browsers = 0;
  for (const step of steps) {
    assert.throws(() => { gate.releaseBrowser(); browsers++; }, /BOOTSTRAP_NOT_READY/);
    await gate.attempt(step, async () => true);
  }
  assert.equal(record.result, 'PASS'); assert.ok(steps.every(step => record[step] === true));
  gate.releaseBrowser(); browsers++;
  assert.throws(() => { gate.releaseBrowser(); browsers++; }, /BROWSER_PHASE_ALREADY_RELEASED/);
  assert.equal(browsers, 1);
});

test('Supabase setup rejection terminally blocks browser and forbids a second bootstrap attempt', async () => {
  const record = {}, gate = createAcceptanceBootstrap(record); let setupCalls = 0;
  await assert.rejects(gate.attempt(steps[0], async () => { setupCalls++; throw Error('OWNED_SETUP_FAILURE'); }), /OWNED_SETUP_FAILURE/);
  assert.equal(record.result, 'BLOCKED'); assert.equal(record.failedStage, steps[0]);
  assert.throws(() => gate.releaseBrowser(), /BOOTSTRAP_NOT_READY/);
  await assert.rejects(gate.attempt(steps[0], async () => { setupCalls++; }), /BOOTSTRAP_TERMINAL/);
  assert.equal(setupCalls, 1); assert.equal(record.browserReleased, false);
});

test('real direct-acquisition helper getWorker rejection blocks browser before dispatch readiness', async () => {
  const record = {}, gate = createAcceptanceBootstrap(record);
  await gate.attempt(steps[0], async () => true); await gate.attempt(steps[1], async () => true);
  let acquisitions = 0;
  const worker = { config: { name: 'owned', dev: { remote: false } }, raw: {
    runtimes: [{ mf: { getCf: async () => ({ country: 'US' }), getWorker: async () => { acquisitions++; throw TypeError('OWNED_ACQUISITION_FAILURE'); } } }],
    proxy: { ready: { promise: Promise.resolve({ proxyWorker: {} }) } },
  } };
  await assert.rejects(createDirectAppDispatch(worker, { bootstrap: gate }), /OWNED_ACQUISITION_FAILURE/);
  assert.equal(record.result, 'BLOCKED'); assert.equal(record.APPLICATION_GETCF_RETURNED, true);
  assert.equal(record.APPLICATION_GETWORKER_RETURNED, false); assert.equal(record.DIRECT_APP_DISPATCH_READY, false);
  assert.throws(() => gate.releaseBrowser(), /BOOTSTRAP_NOT_READY/); assert.equal(acquisitions, 1);
});

test('out-of-order completion cannot open browser', () => {
  const record = {}, gate = createAcceptanceBootstrap(record);
  assert.throws(() => gate.complete(steps.at(-1)), /BOOTSTRAP_STAGE_ORDER/);
  assert.throws(() => gate.releaseBrowser(), /BOOTSTRAP_NOT_READY/);
});

test('successful direct acquisition records both returned APIs before dispatch readiness and browser release', async () => {
  const record = {}, gate = createAcceptanceBootstrap(record), calls = [];
  await gate.attempt(steps[0], async () => true); await gate.attempt(steps[1], async () => true);
  const worker = { config: { name: 'owned', dev: { remote: false } }, raw: {
    runtimes: [{ mf: { getCf: async () => { calls.push('cf'); return { country: 'US' }; },
      getWorker: async () => { calls.push('worker'); return { fetch: async () => new Response('owned') }; } } }],
    proxy: { ready: { promise: Promise.resolve({ proxyWorker: {} }) } },
  } };
  const direct = await createDirectAppDispatch(worker, { bootstrap: gate });
  assert.deepEqual(calls, ['cf', 'worker']); assert.equal(record.result, 'PENDING');
  assert.throws(() => gate.releaseBrowser(), /BOOTSTRAP_NOT_READY/);
  assert.equal(typeof direct.fetch, 'function'); gate.complete(steps.at(-1)); gate.releaseBrowser();
  assert.equal(record.result, 'PASS'); assert.equal(record.browserReleased, true);
});

test('post-bootstrap failure cannot rewrite terminal PASS or invent a failed bootstrap stage', async () => {
  const record = {}, gate = createAcceptanceBootstrap(record);
  for (const step of steps) await gate.attempt(step, async () => true);
  gate.block();
  assert.equal(record.result, 'PASS'); assert.equal(record.failedStage, undefined);
});
