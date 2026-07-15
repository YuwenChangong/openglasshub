import assert from "node:assert/strict";
import { parseCsv, serializeCsv, OUTPUT_COLUMNS } from "./operational-guardrails-preflight-core.mjs";

export { parseCsv, serializeCsv, OUTPUT_COLUMNS };
export const PACKET_VERSION = "operational-guardrails-current-catalog-refresh-v1";
export const REQUIRED_SECTIONS = [
  "packet_manifest", "target_relation_identity", "all_table_indexes", "target_index_evidence", "equivalent_index_detection",
  "all_table_policies", "target_policy_evidence", "rls_state", "relation_acl_catalog", "effective_table_privileges",
  "role_membership_topology", "schema_acl_catalog", "effective_schema_privileges", "sequence_identity_dependencies",
  "sequence_acl_catalog", "relevant_function_catalog", "function_acl_catalog", "policy_function_dependency_catalog",
  "runtime_contract_manifest", "object_fingerprints",
];
const TARGET_INDEXES = {
  forum_upload_attempts_purpose_ip_created_idx: ["purpose", "ip_hash", "created_at DESC"],
  forum_upload_attempts_purpose_user_created_idx: ["purpose", "user_id", "created_at DESC"],
};
const TARGET_POLICIES = ["forum_upload_attempts_insert_authenticated", "forum_upload_attempts_insert_self", "forum_upload_attempts_select_authenticated", "forum_upload_attempts_select_self"];
const REQUIRED_ROLES = ["PUBLIC", "anon", "authenticated", "service_role", "postgres", "authenticator"];
const unsafeEvidence = /(?:[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|(?:secret|token|password|apikey)\s*[=:]|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|auth\.users|\b[0-9a-f]{64}\b)/i;
const rowsFor = (rows, section, key) => rows.filter((row) => row.section === section && (key === undefined || row.row_key === key));
const json = (row) => { try { return row?.value ? JSON.parse(row.value) : null; } catch { throw new Error(`malformed JSON evidence for ${row?.section}/${row?.row_key}`); } };
const normalize = (value) => String(value ?? "").replace(/::[a-z_ ]+/gi, "").replace(/\s+/g, " ").trim().toLowerCase();
const same = (left, right) => JSON.stringify(left ?? []) === JSON.stringify(right ?? []);

function indexFinding(name, indexes) {
  const expected = TARGET_INDEXES[name];
  const expectedDefinition = `using btree (${expected.join(", ").toLowerCase()})`;
  const matches = (index) => index.method === "btree" && index.unique === false && index.valid === true && index.ready === true && index.live === true && normalize(index.definition).endsWith(expectedDefinition) && !index.predicate && same(index.included_parts, []) && index.constraint_backed === false;
  const named = indexes.find((index) => index.name === name);
  if (named && matches(named)) return "EXACT_INDEX_PRESENT";
  if (indexes.some(matches)) return "EQUIVALENT_INDEX_PRESENT";
  if (named || indexes.some((index) => index.key_parts?.[0] === "purpose")) return "CONFLICTING_OR_INVALID_INDEX";
  return "INDEX_MISSING";
}

function policyFinding(name, policies, effective, rls) {
  const policy = policies[name];
  if (!policy || !rls?.enabled) return "INSUFFICIENT_EVIDENCE";
  if (name === "forum_upload_attempts_insert_authenticated") return normalize(policy.with_check).includes("user_id = auth.uid()") ? "CANONICAL_INSERT_PRESENT" : "CANONICAL_INSERT_DIVERGENT";
  if (name === "forum_upload_attempts_select_authenticated") return normalize(policy.using) === "true" ? "CANONICAL_SELECT_BROAD_IF_GRANTED" : "CANONICAL_SELECT_DIVERGENT";
  if (name === "forum_upload_attempts_insert_self") {
    const canonical = policies.forum_upload_attempts_insert_authenticated;
    return canonical && normalize(canonical.with_check).includes("user_id = auth.uid()") && normalize(canonical.with_check).includes("user_id is null") && normalize(policy.with_check).includes("user_id = auth.uid()")
      ? (effective.authenticated?.INSERT === true ? "RLS_REDUNDANT_RUNTIME_MIGRATION_REQUIRED" : "RLS_REDUNDANT_PRIVILEGE_HOLD") : "HUMAN_DECISION_REQUIRED";
  }
  const canonical = policies.forum_upload_attempts_select_authenticated;
  return canonical && normalize(canonical.using) === "true" && normalize(policy.using).includes("user_id = auth.uid()")
    ? (effective.authenticated?.SELECT === true ? "RLS_REDUNDANT_RUNTIME_MIGRATION_REQUIRED" : "RLS_REDUNDANT_PRIVILEGE_HOLD") : "HUMAN_DECISION_REQUIRED";
}

export function validateCurrentCatalogRefreshRows(rows) {
  if (!rows.length) throw new Error("truncated CSV: no packet rows");
  const seen = new Set();
  for (const row of rows) {
    if (row.packet_version !== PACKET_VERSION) throw new Error("wrong packet version");
    if (row.object_schema !== "public" || row.object_name !== "forum_upload_attempts") throw new Error("non-allowlisted evidence");
    const serialized = OUTPUT_COLUMNS.map((column) => row[column] ?? "").join("\u0000");
    if (seen.has(serialized)) throw new Error("duplicate packet row");
    seen.add(serialized);
    if (unsafeEvidence.test(Object.values(row).filter(Boolean).join(" "))) throw new Error("unsafe secret-like, email-like, auth-user, business-row, or raw fingerprint evidence");
  }
  const sections = new Set(rows.map((row) => row.section));
  if (sections.size !== REQUIRED_SECTIONS.length || REQUIRED_SECTIONS.some((section) => !sections.has(section))) throw new Error("required section missing, unexpected, or truncated");
  const manifest = Object.fromEntries(rowsFor(rows, "packet_manifest").map((row) => [row.attribute, row.value]));
  assert.equal(manifest.packet_identifier, "operational-guardrails-current-catalog-refresh");
  assert.equal(manifest.packet_version, PACKET_VERSION);
  assert.equal(manifest.expected_section_count, String(REQUIRED_SECTIONS.length));
  assert.equal(manifest.target_relation, "public.forum_upload_attempts");
  const target = json(rowsFor(rows, "target_relation_identity", "public.forum_upload_attempts")[0]);
  if (!target?.exists || target.relation_kind !== "r") throw new Error("target relation missing or wrong kind");
  const indexes = rowsFor(rows, "all_table_indexes").filter((row) => row.evidence_status === "PRESENT").map(json);
  if (!indexes.length) throw new Error("all index catalog missing");
  const indexFindings = Object.fromEntries(Object.keys(TARGET_INDEXES).map((name) => [name, indexFinding(name, indexes)]));
  const policies = Object.fromEntries(TARGET_POLICIES.map((name) => [name, json(rowsFor(rows, "target_policy_evidence", name)[0]) ]));
  if (Object.values(policies).some((policy) => !policy)) throw new Error("required policy evidence missing");
  const rls = json(rowsFor(rows, "rls_state", "public.forum_upload_attempts")[0]);
  if (typeof rls?.enabled !== "boolean" || typeof rls?.forced !== "boolean") throw new Error("RLS evidence malformed");
  const effective = Object.fromEntries(rowsFor(rows, "effective_table_privileges").map((row) => [row.row_key, json(row)]));
  for (const role of REQUIRED_ROLES) if (!effective[role] || typeof effective[role].role_exists !== "boolean") throw new Error(`effective privilege evidence missing for ${role}`);
  const membershipRows = rowsFor(rows, "role_membership_topology").map(json);
  for (const role of REQUIRED_ROLES.filter((role) => role !== "PUBLIC")) if (!membershipRows.some((row) => row.subject_role === role && row.kind === "SELF")) throw new Error(`role closure missing self row for ${role}`);
  const policyFindings = Object.fromEntries(TARGET_POLICIES.map((name) => [name, policyFinding(name, policies, effective, rls)]));
  const runtime = Object.fromEntries(rowsFor(rows, "runtime_contract_manifest").map((row) => [row.row_key, row.value]));
  if (!runtime.direct_table_path?.includes("authenticated SELECT and INSERT")) throw new Error("runtime-contract manifest missing direct table path");
  const fingerprints = rowsFor(rows, "object_fingerprints");
  for (const name of ["relation_metadata_md5", "all_index_catalog_md5", "all_policy_catalog_md5"]) if (!fingerprints.some((row) => row.attribute === name && /^[a-f0-9]{32}$/.test(row.value ?? ""))) throw new Error(`fingerprint missing: ${name}`);
  const authenticated = effective.authenticated;
  return {
    packetVersion: PACKET_VERSION,
    rowCount: rows.length,
    sectionCount: REQUIRED_SECTIONS.length,
    indexFindings,
    policyFindings,
    effectiveTablePrivileges: effective,
    rls,
    authenticatedDirectPathAuthorized: authenticated.SELECT === true && authenticated.INSERT === true,
    policyRemovalEligible: false,
    stagedProposalEligible: Object.values(indexFindings).every((finding) => finding === "EXACT_INDEX_PRESENT" || finding === "EQUIVALENT_INDEX_PRESENT") && authenticated.SELECT === false && authenticated.INSERT === false,
    reviewStatus: "CURRENT_CATALOG_REFRESH_COMPLETE",
  };
}
