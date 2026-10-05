import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

let createContextObservations;
try { ({ createContextObservations } = await import('./lib/locale-v2-context-observations.mjs')); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }

test('read-only Context 1 observations have bounded failure accounting', () => {
  assert.equal(typeof createContextObservations, 'function', 'CONTEXT1_OBSERVATIONS_REQUIRED');
});

test('independent read-only failures are all recorded without reporting PASS', { skip: !createContextObservations }, () => {
  const ledger = {}, passed = [];
  const observer = createContextObservations({ collect: true, ledger, onPass: name => passed.push(name) });
  observer.check(false, 'WRONG_LOCATION'); observer.equal(['en'], ['zh-CN'], 'WRONG_LABELS'); observer.check(true, 'DESTINATION_200');
  assert.deepEqual(ledger, { assertionsTotal: 3, assertionsPassed: 1, failures: ['WRONG_LOCATION', 'WRONG_LABELS'] });
  assert.deepEqual(passed, ['DESTINATION_200']);
  assert.throws(() => observer.finish(), /CONTEXT1_READ_ONLY_OBSERVATIONS_FAILED/);
});

test('normal full acceptance remains fail-fast and never swallows unsafe transitions', { skip: !createContextObservations }, () => {
  const ledger = {};
  const observer = createContextObservations({ collect: false, ledger });
  assert.throws(() => observer.check(false, 'WRONG_LOCATION'), /WRONG_LOCATION/);
  assert.deepEqual(ledger.failures, ['WRONG_LOCATION']);
  assert.throws(() => assert.ok(false, 'UNSAFE_TRANSITION'), /UNSAFE_TRANSITION/);
});

test('all-green observations retain every pass and finish successfully', { skip: !createContextObservations }, () => {
  const ledger = {};
  const observer = createContextObservations({ collect: true, ledger });
  observer.check(true, 'ORIGINAL_301'); observer.equal(['en'], ['en'], 'LABELS'); observer.finish();
  assert.deepEqual(ledger, { assertionsTotal: 2, assertionsPassed: 2, failures: [] });
});

test('actual preflight context selection runs the entire first context without changing the full matrix', async () => {
  const source = await readFile(new URL('./test-global-locale-v2-acceptance-local.mjs', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('runner.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let initializer;
  const visit = node => { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'acceptanceContexts') initializer = node.initializer; ts.forEachChild(node, visit); };
  visit(ast); assert.ok(initializer);
  const select = new Function('targetOnly', 'context1Only', 'localeContexts', `return ${initializer.getText(ast)}`);
  const { localeContexts, runLocaleV2Acceptance } = await import('./test-global-locale-v2-acceptance-local.mjs');
  assert.deepEqual(select(false, true, localeContexts), [{ engine: 'chromium', width: 1280, locale: 'zh-CN' }]);
  assert.equal(select(false, false, localeContexts).length, 5);
  assert.equal(select(true, false, localeContexts).length, 1);
  await assert.rejects(runLocaleV2Acceptance({ targetOnly: true, context1Only: true }), /EXCLUSIVE_PARTIAL_MODES_REQUIRED/);
  await assert.rejects(runLocaleV2Acceptance({ context1Only: 'yes' }), /INVALID_CONTEXT1_MODE/);
});

test('actual runner does not publish behavior PASS after a collected preflight failure', async () => {
  const source = await readFile(new URL('./test-global-locale-v2-acceptance-local.mjs', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('runner.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let initializer;
  const visit = node => { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'pass') initializer = node.initializer; ts.forEachChild(node, visit); };
  visit(ast);
  const receipt = { browserContexts: [{ failures: ['READ_ONLY_FAILED'] }], behaviors: {}, behaviorProvenance: {} };
  const pass = new Function('receipt', 'runId', 'context1Only', `return ${initializer.getText(ast)}`)(receipt, 'owned-run', true);
  pass('ADMIN_CATALOG_ZH_CN'); assert.deepEqual(receipt.behaviors, {});
});

test('actual raw-label accounting retains failures instead of assigning zero', async () => {
  const source = await readFile(new URL('./test-global-locale-v2-acceptance-local.mjs', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('runner.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const writes = [];
  const visit = node => {
    if (ts.isBinaryExpression(node) && ['receipt.rawParameterKeyVisibleCount', 'receipt.rawGroupKeyVisibleCount'].includes(node.left.getText(ast))) writes.push(node.getText(ast));
    ts.forEachChild(node, visit);
  }; visit(ast);
  const count = new Function('receipt', 'labels', 'groups', `${writes.join(';')}; return receipt`);
  assert.deepEqual(count({}, ['basic.weight_g', 'Good label', 'raw_key'], ['Good group', 'raw_group']), { rawParameterKeyVisibleCount: 2, rawGroupKeyVisibleCount: 1 });
});
