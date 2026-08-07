import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildFixtureManifest, compileStructuralDriftFixture, FIXTURE_FORMAT, loadFrozenDriftInputs, runNormalizedFixtureRuntime } from "./lib/production-drift-structural-fixture.mjs";

const root = process.cwd();
const fixture = JSON.parse(await readFile(path.join(root, "tests", "fixtures", "qa-production-drift-structural-fixture-manifest.json"), "utf8"));
const inputs = await loadFrozenDriftInputs(root);
const manifest = buildFixtureManifest(inputs);
assert.equal(manifest.format, FIXTURE_FORMAT);
assert.deepEqual(manifest.expectedCounts, fixture.expectedCounts);
assert.equal(manifest.expectedHardBlockers, fixture.expectedHardBlockers);
assert.equal(manifest.differenceCount, fixture.differenceCount);
const compiled = compileStructuralDriftFixture(inputs);
assert.equal(compiled.differences.length, 110);
assert.equal(compiled.differences.filter((entry) => entry.classification === "MISSING_IN_PRODUCTION").length, 71);
assert.equal(compiled.differences.filter((entry) => entry.classification === "DIVERGENT_IN_PRODUCTION").length, 19);
assert.equal(compiled.differences.filter((entry) => entry.classification === "EXTRA_IN_PRODUCTION").length, 20);
assert(compiled.statements.some((statement) => statement.startsWith("UPDATE storage.buckets")));
assert(!compiled.statements.some((statement) => /^\s*(?:INSERT|DELETE)\s+INTO\s+(?:public\.|auth\.|storage\.objects)/i.test(statement)));
assert(!compiled.statements.some((statement) => /\bsupabase\s+(?:migration|db)/i.test(statement)));
const runtimeA = await runNormalizedFixtureRuntime({ root, inputs, label: "A" });
const runtimeB = await runNormalizedFixtureRuntime({ root, inputs, label: "B" });
for (const runtime of [runtimeA, runtimeB]) {
  assert.deepEqual(runtime.canonicalComparison.counts, { MATCH: 1133, MISSING_IN_PRODUCTION: 0, DIVERGENT_IN_PRODUCTION: 0, EXTRA_IN_PRODUCTION: 0, INSUFFICIENT_EVIDENCE: 0 });
  assert.deepEqual(runtime.comparison.counts, fixture.expectedCounts);
  assert.equal(runtime.comparison.hardBlockers.length, fixture.expectedHardBlockers);
  assert.equal(runtime.comparison.objectResults.length, 1153);
  assert.equal(runtime.fidelity.identityMismatches, 0);
  assert.equal(runtime.fidelity.valueHashMismatches, 0);
  assert.deepEqual(runtime.fidelity.securityPriorities, { SECURITY_CRITICAL: 55, HIGH: 53, MEDIUM: 2 });
}
assert.equal(runtimeA.canonicalFingerprintSha256, runtimeB.canonicalFingerprintSha256);
assert.equal(runtimeA.compiled.statementSha256, runtimeB.compiled.statementSha256);
assert.equal(runtimeA.observedFingerprintSha256, runtimeB.observedFingerprintSha256);
console.log(JSON.stringify({ classification: "R6_PRODUCTION_DRIFT_STRUCTURAL_FIXTURE_FIDELITY_VALIDATED", runtimes: 2, baselineFingerprintSha256: runtimeA.canonicalFingerprintSha256, fixtureStatementSha256: runtimeA.compiled.statementSha256, totals: runtimeA.comparison.counts, hardBlockers: runtimeA.comparison.hardBlockers.length, productionOperations: 0, formalLegalEvidence: false, migrationHistoryWritesOutsideNormalizedBootstrap: 0 }));
