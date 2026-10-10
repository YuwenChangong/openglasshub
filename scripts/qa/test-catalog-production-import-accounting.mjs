import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { prepareImport, buildImportBody, key } from "./lib/catalog-production-import.mjs";
import * as accounting from "./lib/catalog-production-segmented-schema.mjs";

const prepared = await prepareImport(fileURLToPath(new URL("../../", import.meta.url)));
const contract = accounting.segmentedExecutionContract(prepared);
assert.equal(contract.importSqlStatementsMax, 1766, "FIXED_TOTAL_CEILING_NEVER_EXPANDS");
assert.equal(contract.importInitializationStatements, 3, "SET_CONSTRAINTS_DO_AND_UPDATE_ALL_COUNT");
assert.equal(contract.importBodyStatementsMax, 1706, "BODY_LIMIT_RESERVES_NONBODY_AND_CLEANUP");
const actions = prepared.operations.map(op => ({ entity: op.entity, identity: key(op.entity, op.row), classification: "ALREADY_PRESENT_PRESERVE" }));
let checks = 3;
for (const n of [0, 1, 3, 1702, 1703]) {
  const plan = { inserts: { device: n }, actions, blockers: [] };
  assert.equal(accounting.importBodyStatementWeight(plan, contract), 3 + n);
  checks++;
}
for (const n of [1704, 1705, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
  assert.throws(() => accounting.importBodyStatementWeight({ inserts: { device: n } }, contract), /IMPORT_STATEMENT_BUDGET_EXHAUSTED/);
  checks++;
}
const zero = buildImportBody(prepared, { actions, blockers: [] });
assert.ok(zero.startsWith("SET CONSTRAINTS ALL DEFERRED;\nDO $$ BEGIN"));
assert.match(zero, /END \$\$;\n\s*UPDATE public\.devices/);
assert.doesNotMatch(zero, /INSERT INTO/i);
checks += 3;
for (const n of [1, 3]) {
  const selected = actions.map((a, i) => ({ ...a, classification: i < n ? "INSERT_MISSING" : a.classification }));
  assert.equal((buildImportBody(prepared, { actions: selected, blockers: [] }).match(/INSERT INTO/gi) ?? []).length, n);
  checks++;
}
const old = { ...contract, importInitializationStatements: 2 };
assert.throws(() => accounting.assertSegmentedExecutionContract({ format: "catalog-stage-c-preparation-v2", executionContract: old }, prepared), /BINDING_INVALID/);
checks++;
console.log(`STAGE_C_STATEMENT_ACCOUNTING=PASS_${checks}`);
