import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { OUTPUT_COLUMNS, PACKET_VERSION, REQUIRED_SECTIONS, parseCsv, serializeCsv, validatePacketRows } from "./circles-visibility-preflight-core.mjs";

const root = process.cwd();
const sql = await readFile(path.join(root, "docs", "ops", "reconciliation", "circles-visibility-production-preflight-one-shot.sql"), "utf8");
const uncommented = sql.replace(/--[^\n]*/g, "");
assert.match(uncommented, /^\s*BEGIN TRANSACTION READ ONLY;/);
assert.match(uncommented, /\nROLLBACK;\s*$/);
assert.doesNotMatch(uncommented, /^\s*(?:CREATE|ALTER|DROP|GRANT|REVOKE|INSERT|UPDATE|DELETE|MERGE|TRUNCATE|COPY|DO|CALL|EXECUTE)\b/im);
assert.match(sql, /FROM public\.circles/);
assert.match(sql, /count\(\*\)/);
assert.doesNotMatch(sql, /auth\.users|storage\.objects|public\.(?:posts|comments|post_media|reports)/i);
assert.doesNotMatch(sql, /increment_post_view_count|insert_forum_notification/i);
assert.equal((sql.match(/SELECT packet_version, section_order/g) ?? []).length, 1, "packet must emit one result set");

const base = (section, order, rowKey, attribute, value, evidenceStatus = "PRESENT", securityClassification = "NON_SECURITY_DRIFT", objectName = "circles") => Object.fromEntries(OUTPUT_COLUMNS.map((column) => [column, {
  packet_version: PACKET_VERSION, section_order: String(order), section, row_key: rowKey, object_schema: "public", object_name: objectName,
  attribute, value, evidence_status: evidenceStatus, security_classification: securityClassification,
}[column]]));

function fixture({ hidden = 2, unknown = 0, selectUsing = "true", deleteUsing = "((owner_id = auth.uid()) OR ( SELECT is_moderator_or_admin() AS is_moderator_or_admin))", missingHelper = false } = {}) {
  const rows = [
    base("packet_manifest", 1, "packet", "packet_identifier", "circles-visibility-production-preflight"),
    base("packet_manifest", 1, "packet", "packet_version", PACKET_VERSION),
    base("packet_manifest", 1, "packet", "expected_section_count", "10"),
    base("packet_manifest", 1, "packet", "target_relation", "public.circles"),
    base("packet_manifest", 1, "packet", "query_scope", "PostgreSQL catalogs plus aggregate-only public.circles safety counts"),
    base("packet_manifest", 1, "packet", "read_only_classification", "CATALOG_AND_AGGREGATE_READ_ONLY"),
    base("circles_relation_rls_acl", 2, "public.circles", "present", "true", "PRESENT", "SECURITY_BROADENING"),
  ];
  for (const column of ["id", "owner_id", "status", "slug", "name"]) rows.push(base("circles_columns", 3, column, column, JSON.stringify({ data_type: column === "id" || column === "owner_id" ? "uuid" : "text" }), "PRESENT", "NON_SECURITY_DRIFT"));
  rows.push(base("circles_status_constraint", 4, "circles_status_check", "definition", "CHECK (status = ANY (ARRAY['active'::text, 'hidden'::text, 'deleted'::text]))", "PRESENT", "PRODUCT_SEMANTIC_DIFFERENCE"));
  const aggregates = { total_circle_count: 9, active_circle_count: 4, hidden_circle_count: hidden, deleted_circle_count: 3, null_status_count: 0, unknown_status_count: unknown, expected_constraint_violation_count: hidden + unknown, current_anonymous_public_visible_count: 9, expected_anonymous_public_visible_count: 4, current_vs_expected_anonymous_visibility_delta: 5, potential_delete_policy_impact_count: 9 };
  for (const [attribute, value] of Object.entries(aggregates)) rows.push(base("circles_status_aggregate_counts", 5, attribute, attribute, String(value), "PRESENT", "NON_SECURITY_DRIFT"));
  for (const [attribute, value] of Object.entries({ command: "r", permissive: "true", roles: "anon,authenticated", using_expression: selectUsing, with_check_expression: "" })) rows.push(base("circles_select_policy", 6, "circles_select_public", attribute, value, "PRESENT", attribute === "using_expression" ? "SECURITY_BROADENING" : "NON_SECURITY_DRIFT"));
  for (const [attribute, value] of Object.entries({ command: "d", permissive: "true", roles: "authenticated", using_expression: deleteUsing, with_check_expression: "" })) rows.push(base("circles_delete_policy", 7, "circles_delete_owner_or_staff", attribute, value, "PRESENT", "PRODUCT_SEMANTIC_DIFFERENCE"));
  for (const [rowKey, objectName, attribute, value] of [["circles_select_public", "circles_select_public", "expected_roles", "anon,authenticated"], ["circles_select_public", "can_access_public_circle", "expected_helper", "public.can_access_public_circle(uuid)"], ["circles_select_public", "is_moderator_or_admin", "expected_helper", "public.is_moderator_or_admin()"], ["circles_delete_owner_or_staff", "circles_delete_owner_or_staff", "expected_runtime_delete_model", "soft_delete_status_update_only; hard_delete_runtime_not_observed"], ["circles_delete_owner_or_staff", "is_moderator_or_admin", "observed_helper_dependency", "public.is_moderator_or_admin()"]]) rows.push(base("policy_roles_and_dependencies", 8, rowKey, attribute, value, "PRESENT", "PRODUCT_SEMANTIC_DIFFERENCE", objectName));
  rows.push(base("visibility_helper_functions", 9, "public.can_access_public_circle(uuid)", "present", missingHelper ? null : "true", missingHelper ? "MISSING" : "PRESENT", missingHelper ? "INSUFFICIENT_EVIDENCE" : "SECURITY_BROADENING", "can_access_public_circle"));
  rows.push(base("visibility_helper_functions", 9, "public.is_moderator_or_admin()", "present", "true", "PRESENT", "SECURITY_BROADENING", "is_moderator_or_admin"));
  for (const [rowKey, objectName, attribute, value] of [["relation", "circles", "rls_dependency", "public.circles RLS state captured in circles_relation_rls_acl"], ["select_policy", "circles_select_public", "expected_predicate_dependency", "public.can_access_public_circle(uuid) plus owner/staff branches"], ["delete_policy", "circles_delete_owner_or_staff", "authorization_dependency", "owner_id = auth.uid() or public.is_moderator_or_admin()"]]) rows.push(base("dependent_catalog_objects", 10, rowKey, attribute, value, "PRESENT", "PRODUCT_SEMANTIC_DIFFERENCE", objectName));
  return rows;
}

const validRows = fixture();
const parsed = parseCsv(serializeCsv(validRows));
assert.equal(parsed.length, validRows.length);
assert.deepEqual(new Set(parsed.map((row) => row.section)), new Set(REQUIRED_SECTIONS));
const broad = validatePacketRows(parsed);
assert.equal(broad.repairObjects["public.circles.circles_status_check"], "PRODUCT_SEMANTIC_DIFFERENCE");
assert.equal(broad.repairObjects["public.circles.circles_select_public"], "SECURITY_BROADENING");
assert.equal(broad.repairObjects["public.circles.circles_delete_owner_or_staff"], "HUMAN_DECISION_REQUIRED");
assert.equal(broad.productOrDataDecisionRequired, true);

const expectedPolicy = fixture({ hidden: 0, selectUsing: "(can_access_public_circle(id) OR (owner_id = auth.uid()) OR ( SELECT is_moderator_or_admin() AS is_moderator_or_admin))" });
assert.equal(validatePacketRows(expectedPolicy).repairObjects["public.circles.circles_select_public"], "PRESENT_AND_MATCHING");
const broadDelete = fixture({ hidden: 0, deleteUsing: "true" });
assert.equal(validatePacketRows(broadDelete).repairObjects["public.circles.circles_delete_owner_or_staff"], "SECURITY_BROADENING");
assert.equal(validatePacketRows(fixture({ hidden: 0, unknown: 2, missingHelper: true })).helperStatus["public.can_access_public_circle(uuid)"], "MISSING");
const missingConstraint = validRows.map((row) => row.section === "circles_status_constraint" ? base("circles_status_constraint", 4, "circles_status_check", "definition", null, "MISSING", "INSUFFICIENT_EVIDENCE") : row);
assert.equal(validatePacketRows(missingConstraint).repairObjects["public.circles.circles_status_check"], "INSUFFICIENT_EVIDENCE");
const missingSelect = [...validRows.filter((row) => row.section !== "circles_select_policy"), base("circles_select_policy", 6, "circles_select_public", "definition", null, "MISSING", "INSUFFICIENT_EVIDENCE")];
assert.equal(validatePacketRows(missingSelect).repairObjects["public.circles.circles_select_public"], "INSUFFICIENT_EVIDENCE");

assert.throws(() => validatePacketRows([...validRows, { ...validRows[0] }]), /duplicate packet row/);
assert.throws(() => validatePacketRows(validRows.filter((row) => row.section !== "circles_select_policy")), /required sections|truncated/);
assert.throws(() => parseCsv("packet_version\n"), /header and at least one data row/);
assert.throws(() => validatePacketRows(validRows.map((row, index) => index === 0 ? { ...row, value: "person@example.test" } : row)), /email-like/);

const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "openglass-circles-preflight-"));
const temporaryCsv = path.join(temporaryDirectory, "circles-visibility-production-preflight.csv");
await writeFile(temporaryCsv, serializeCsv(validRows));
const validator = spawnSync(process.execPath, [path.join(root, "scripts", "validate-circles-visibility-production-preflight.mjs"), temporaryCsv], { encoding: "utf8" });
await rm(temporaryDirectory, { recursive: true, force: true });
assert.equal(validator.status, 0, validator.stderr);
assert.match(validator.stdout, /ONE_SHOT_PREFLIGHT_PACKET_READY/);

console.log(JSON.stringify({ packetVersion: PACKET_VERSION, requiredSections: REQUIRED_SECTIONS.length, validRows: validRows.length, broadSelectDetected: true, noRealOperations: true }));
