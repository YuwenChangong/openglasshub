import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { compareFingerprint, parseExport } from "./compare-production-schema-fingerprint.mjs";
import { loadPacketSql, PACKET_COLUMNS, parseCsv, rowsFromFingerprint, validateProductionExport } from "./production-schema-fingerprint-core.mjs";
import { generateLocalFingerprint } from "./generate-local-production-schema-fingerprint.mjs";

const root = process.cwd();
const expected = JSON.parse(await readFile(path.join(root, "tests", "fixtures", "production-schema-expected-fingerprint.json"), "utf8"));
assert.equal(expected.format, "openglass-production-schema-fingerprint-v1");
assert.equal(expected.canonicalMigrationCount, 43);
assert.equal(expected.legalConsentPrerequisiteCount, 12);
assert(expected.objectCount > 1000, "expected manifest must cover the migration-managed catalog");
assert(expected.objects.some((entry) => entry.identity.startsWith("insert_forum_notification") && entry.attribute === "service_role_execute"));
assert(expected.objects.some((entry) => entry.identity.startsWith("increment_post_view_count") && entry.attribute === "definition"));
assert(expected.objects.some((entry) => entry.identity.startsWith("can_create_user_report_target") && entry.attribute === "definition"));
for (const label of ["legal-consent-persistence", "notification-recipient-isolation", "post-view-visibility", "report-target-authorization", "comment-circle-authorization", "comment-reaction-visibility", "comment-read-visibility", "post-media-provenance", "circle-cover-delivery", "post-media-delivery", "profile-media-delivery", "user-safety-authorization", "reports-and-moderation"]) {
  assert(expected.objects.some((entry) => entry.label === label), `expected fingerprint must label ${label}`);
}

const packet = await loadPacketSql(root);
const stripped = packet.replace(/--[^\n]*/g, "").replace(/'(?:''|[^'])*'/g, "''");
assert.match(packet, /^BEGIN TRANSACTION READ ONLY;/);
assert.match(packet, /\nROLLBACK;$/);
assert.doesNotMatch(stripped, /\b(?:insert|update|delete|merge|truncate|alter|create|drop|grant|revoke|comment|security\s+label|execute)\b/i);
assert.doesNotMatch(packet, /(?:auth\.users|vault|current_setting|pg_settings|pg_stat_activity|inet_server_addr|connection)/i);
assert.doesNotMatch(packet, /\bproject_ref\b/i);
assert.doesNotMatch(packet, /\b(?:insert_forum_notification|increment_post_view_count|record_current_legal_policy_acceptance)\s*\(/i, "packet must not invoke a known mutating RPC");
assert.doesNotMatch(packet, /from\s+public\./i, "packet must not inspect public business rows");
assert.match(packet, /FROM storage\.buckets/);
assert.match(packet, /FROM pg_(?:class|proc|policy|namespace|constraint|trigger|type|index)/);

const local = await generateLocalFingerprint({ root });
assert.deepEqual(local, expected, "local expected fingerprint generation must be stable");

const exact = compareFingerprint(expected, rowsFromFingerprint(expected));
assert.equal(exact.counts.MATCH, expected.objectCount);
assert.equal(exact.hardBlockers.length, 0);
const rows = rowsFromFingerprint(expected);
assert(validateProductionExport(rows).rowCount > 1000, "complete packet validation must accept the expected catalog-only export");
assert.throws(() => validateProductionExport([...rows, { ...rows[0] }]), /duplicate row key/);
assert.throws(() => validateProductionExport(rows.slice(0, 100)), /100-row limit/);
assert.throws(() => validateProductionExport(rows.filter((row) => !(row.section === "packet_sections" && row.object_name === "policies"))), /required packet sections missing: policies/);
assert.throws(() => validateProductionExport([...rows, { ...rows[0], identity: "secret", value: "postgresql://user:password@example.test/db" }]), /secret-like/);
assert.throws(() => validateProductionExport([...rows, { ...rows[0], section: "functions", object_type: "report", identity: "public.reports.live_content" }]), /not a catalog object allowed/);
assert.throws(() => parseCsv(`${PACKET_COLUMNS.join(",")}\nonly,two\n`), /expected 8 columns, received 2/);
assert.deepEqual(parseExport(`\uFEFF${PACKET_COLUMNS.join(",")}\npacket_sections,section_marker,,,,collected,true,\n`, "packet.csv"), [{ section: "packet_sections", object_type: "section_marker", schema_name: "", object_name: "", identity: "", attribute: "collected", value: "true", definition_hash: "" }]);

const missing = compareFingerprint(expected, rows.slice(1));
assert.equal(missing.counts.MISSING_IN_PRODUCTION + missing.counts.INSUFFICIENT_EVIDENCE > 0, true);
const policyIndex = rows.findIndex((row) => row.section === "policies");
const divergentRows = rows.map((row) => ({ ...row }));
divergentRows[policyIndex].value += " changed";
const divergent = compareFingerprint(expected, divergentRows);
assert.equal(divergent.counts.DIVERGENT_IN_PRODUCTION, 1);
assert.equal(divergent.hardBlockers.length, 1, "policy divergence is a hard security review blocker");
const extra = compareFingerprint(expected, [...rows, { ...rows[0], identity: "unexpected.identity" }]);
assert.equal(extra.counts.EXTRA_IN_PRODUCTION, 1);
const broadExtraGrant = compareFingerprint(expected, [...rows, { section: "grants", object_type: "function_grant", schema_name: "public", object_name: "unexpected_function", identity: "unexpected_function()", attribute: "PUBLIC:EXECUTE", value: "true", definition_hash: "" }]);
assert(broadExtraGrant.hardBlockers.some((result) => result.classification === "EXTRA_IN_PRODUCTION" && result.severity === "SECURITY_BROADENING"));
const extraPolicy = compareFingerprint(expected, [...rows, { section: "policies", object_type: "policy", schema_name: "public", object_name: "unexpected_table", identity: "public.unexpected_table.unreviewed_policy", attribute: "SELECT", value: "using=(true)", definition_hash: "" }]);
assert(extraPolicy.hardBlockers.some((result) => result.classification === "EXTRA_IN_PRODUCTION" && result.severity === "POSSIBLE_SECURITY_BROADENING"));
const aclIndex = rows.findIndex((row) => row.identity.startsWith("insert_forum_notification") && row.attribute === "PUBLIC_execute");
const wrongAclRows = rows.map((row) => ({ ...row }));
wrongAclRows[aclIndex].value = "true";
const wrongAcl = compareFingerprint(expected, wrongAclRows);
assert(wrongAcl.hardBlockers.some((result) => result.severity === "SECURITY_BROADENING"));

const ledgerOnly = compareFingerprint(expected, [{ section: "migration_ledger", object_type: "migration", schema_name: "supabase_migrations", object_name: "untrusted", identity: "20260713", attribute: "statement_count", value: "1", definition_hash: "" }]);
assert.notEqual(ledgerOnly.migrationResults.find((result) => result.migration === "20260713_comment_creation_circle_authorization.sql").classification, "EFFECTIVELY_PRESENT", "ledger-only evidence cannot prove migration application");
const unrecordedPresent = compareFingerprint(expected, rows);
assert.equal(unrecordedPresent.migrationResults.find((result) => result.migration === "20260713_comment_creation_circle_authorization.sql").classification, "EFFECTIVELY_PRESENT", "matching objects can prove effective presence without ledger evidence");
assert(compareFingerprint(expected, []).counts.INSUFFICIENT_EVIDENCE > 0, "missing section markers must be reported as insufficient evidence");
assert.throws(() => parseCsv("bad,input\n"), /required fingerprint columns/);
assert.deepEqual(PACKET_COLUMNS.length, 8);
console.log(JSON.stringify({ fingerprintObjects: expected.objectCount, packetReadOnly: true, comparisonCases: 17, realOperations: 0 }));
