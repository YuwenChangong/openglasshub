import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { OUTPUT_COLUMNS, PACKET_VERSION, REQUIRED_SECTIONS, serializeCsv, validateCurrentCatalogRefreshRows } from "./operational-guardrails-current-catalog-refresh-core.mjs";

const sql = await readFile("docs/ops/reconciliation/operational-guardrails-current-catalog-refresh.sql", "utf8");
assert.match(sql, /^BEGIN TRANSACTION READ ONLY;/m);
assert.match(sql, /ROLLBACK;\s*$/m);
assert.doesNotMatch(sql, /from\s+public\.forum_upload_attempts\b/i, "packet must not read application rows");
assert.doesNotMatch(sql, /auth\.users/i, "packet must not inspect auth-user rows");
assert.match(sql, /role_closure\(subject_role, subject_oid, current_oid, path, depth, membership_kind\)/);
assert.match(sql, /::text COLLATE "C"/);
assert.match(sql, /WHERE NOT membership\.roleid = ANY\(closure\.path\)/);
assert.match(sql, /indisvalid, pi\.indisready, pi\.indislive/);
assert.match(sql, /relation_acl_catalog/);
assert.match(sql, /effective_table_privileges/);
assert.match(sql, /function_acl_catalog/);
assert.match(sql, /object_fingerprints/);
assert.match(sql, /operational-guardrails-current-catalog-refresh-v1/);

const row = (sectionOrder, section, rowKey, attribute, value) => ({
  packet_version: PACKET_VERSION, section_order: String(sectionOrder), section, row_key: rowKey,
  object_schema: "public", object_name: "forum_upload_attempts", attribute,
  value: typeof value === "string" ? value : JSON.stringify(value), evidence_status: "PRESENT", security_classification: "SECURITY_BROADENING",
});
const index = (name, keys) => ({ name, method: "btree", unique: false, valid: true, ready: true, live: true, definition: `CREATE INDEX ${name} ON public.forum_upload_attempts USING btree (${keys.join(", ")})`, key_parts: keys, predicate: null, included_parts: [], constraint_backed: false });
const policy = (name, command, using, withCheck) => ({ name, command, permissive: true, roles: "authenticated", using, with_check: withCheck });
const rows = [
  row(1, "packet_manifest", "packet", "packet_identifier", "operational-guardrails-current-catalog-refresh"),
  row(1, "packet_manifest", "packet", "packet_version", PACKET_VERSION),
  row(1, "packet_manifest", "packet", "expected_section_count", String(REQUIRED_SECTIONS.length)),
  row(1, "packet_manifest", "packet", "target_relation", "public.forum_upload_attempts"),
  row(2, "target_relation_identity", "public.forum_upload_attempts", "catalog", { exists: true, relation_kind: "r", owner: "postgres" }),
];
for (const entry of [index("forum_upload_attempts_purpose_ip_created_idx", ["purpose", "ip_hash", "created_at DESC"]), index("forum_upload_attempts_purpose_user_created_idx", ["purpose", "user_id", "created_at DESC"])]) rows.push(row(3, "all_table_indexes", entry.name, "catalog", entry));
for (const name of ["forum_upload_attempts_purpose_ip_created_idx", "forum_upload_attempts_purpose_user_created_idx"]) rows.push(row(4, "target_index_evidence", name, "expected_shape", { name }));
for (const name of ["forum_upload_attempts_purpose_ip_created_idx", "forum_upload_attempts_purpose_user_created_idx"]) rows.push(row(5, "equivalent_index_detection", `${name}|${name}`, "candidate", { expected_name: name, candidate_name: name }));
const policies = [
  policy("forum_upload_attempts_insert_authenticated", "a", null, "((user_id = auth.uid()) OR (user_id IS NULL))"),
  policy("forum_upload_attempts_insert_self", "a", null, "((purpose = ANY (ARRAY['post_create'])) AND (user_id = auth.uid()))"),
  policy("forum_upload_attempts_select_authenticated", "r", "true", null),
  policy("forum_upload_attempts_select_self", "r", "((user_id = auth.uid()) OR (user_id IS NULL))", null),
];
for (const entry of policies) rows.push(row(6, "all_table_policies", entry.name, "definition", entry), row(7, "target_policy_evidence", entry.name, "definition", entry));
rows.push(row(8, "rls_state", "public.forum_upload_attempts", "state", { enabled: true, forced: false }));
rows.push(row(9, "relation_acl_catalog", "postgres", "entry", { grantee_oid: 10, grantee: "postgres", privilege: "SELECT" }));
for (const role of ["PUBLIC", "anon", "authenticated", "service_role", "postgres", "authenticator"]) rows.push(row(10, "effective_table_privileges", role, "effective", { role_exists: true, SELECT: role === "postgres", INSERT: role === "postgres" }));
for (const role of ["anon", "authenticated", "service_role", "postgres", "authenticator"]) rows.push(row(11, "role_membership_topology", `${role}|SELF|0`, "membership", { subject_role: role, inherited_role: role, depth: 0, kind: "SELF" }));
rows.push(row(12, "schema_acl_catalog", "PUBLIC", "entry", { grantee_oid: 0, grantee: "PUBLIC", privilege: "USAGE" }));
for (const role of ["PUBLIC", "anon", "authenticated", "service_role", "postgres", "authenticator"]) rows.push(row(13, "effective_schema_privileges", role, "effective", { role_exists: true, USAGE: true, CREATE: false }));
rows.push(row(14, "sequence_identity_dependencies", "NO_SEQUENCE_DEPENDENCY", "sequence", { sequence_dependency: false }));
rows.push(row(15, "sequence_acl_catalog", "NO_SEQUENCE_ACL", "entry", { sequence_dependency: false }));
rows.push(row(16, "relevant_function_catalog", "NO_RELEVANT_FUNCTION", "metadata", { function_present: false }));
rows.push(row(17, "function_acl_catalog", "NO_FUNCTION_ACL", "entry", { function_acl: false }));
rows.push(row(18, "policy_function_dependency_catalog", "NO_POLICY_FUNCTION_DEPENDENCY", "dependency", { dependency: false }));
rows.push(row(19, "runtime_contract_manifest", "direct_table_path", "operations", "authenticated SELECT and INSERT are currently required by enforceUserRateLimit and enforceUploadRateLimit"));
rows.push(row(20, "object_fingerprints", "relation", "relation_metadata_md5", "0123456789abcdef0123456789abcdef"));
rows.push(row(20, "object_fingerprints", "indexes", "all_index_catalog_md5", "0123456789abcdef0123456789abcdef"));
rows.push(row(20, "object_fingerprints", "policies", "all_policy_catalog_md5", "0123456789abcdef0123456789abcdef"));

const result = validateCurrentCatalogRefreshRows(rows);
assert.equal(result.indexFindings.forum_upload_attempts_purpose_ip_created_idx, "EXACT_INDEX_PRESENT");
assert.equal(result.policyFindings.forum_upload_attempts_insert_self, "RLS_REDUNDANT_PRIVILEGE_HOLD");
assert.equal(result.authenticatedDirectPathAuthorized, false);
assert.equal(result.policyRemovalEligible, false);
assert.throws(() => validateCurrentCatalogRefreshRows(rows.filter((entry) => entry.section !== "object_fingerprints")), /required section/);
assert.throws(() => validateCurrentCatalogRefreshRows([...rows, { ...rows[0] }]), /duplicate/);
assert.throws(() => validateCurrentCatalogRefreshRows(rows.map((entry) => entry.section === "packet_manifest" && entry.attribute === "packet_version" ? { ...entry, value: "wrong" } : entry)), /operational-guardrails-current-catalog-refresh-v1/);
assert.throws(() => validateCurrentCatalogRefreshRows(rows.map((entry) => entry.section === "all_table_indexes" ? { ...entry, value: "user@example.test" } : entry)), /unsafe/);
assert.match(serializeCsv(rows), /^packet_version,section_order,section/);
console.log("operational-guardrails current catalog refresh validator: PASS");
