import { OUTPUT_COLUMNS, parseCsv, serializeCsv } from "./operational-guardrails-preflight-core.mjs";

export { OUTPUT_COLUMNS, parseCsv, serializeCsv };
export const PACKET_VERSION = "operational-guardrails-supplemental-preflight-v1";
export const REQUIRED_SECTIONS = ["packet_manifest", "all_table_indexes", "target_index_equivalence_evidence", "relevant_policies", "all_table_policies", "relation_acl_catalog", "effective_role_privileges", "rls_state", "policy_dependency_catalog", "runtime_contract_manifest"];
const TARGETS = {
  forum_upload_attempts_purpose_ip_created_idx: ["purpose", "ip_hash", "created_at DESC"],
  forum_upload_attempts_purpose_user_created_idx: ["purpose", "user_id", "created_at DESC"],
};
const expectedIndexDefinition = (name) => `create index ${name} on public.forum_upload_attempts using btree (${TARGETS[name].join(", ")})`;
const structuralIndexDefinition = (definition) => norm(definition).replace(/^create index [^ ]+ on /, "create index on ");
const TARGET_POLICIES = ["forum_upload_attempts_insert_authenticated", "forum_upload_attempts_select_authenticated", "forum_upload_attempts_insert_self", "forum_upload_attempts_select_self"];
const rowsFor = (rows, section, rowKey) => rows.filter((row) => row.section === section && (rowKey === undefined || row.row_key === rowKey));
const absent = (rows, section, key) => rowsFor(rows, section, key).some((row) => row.evidence_status === "MISSING");
const json = (row) => { try { return row?.value ? JSON.parse(row.value) : null; } catch { throw new Error(`malformed JSON evidence for ${row?.section}/${row?.row_key}`); } };
const norm = (value) => String(value ?? "").replace(/::[a-z_ ]+/gi, "").replace(/\s+/g, " ").trim().toLowerCase();
const same = (left, right) => JSON.stringify(left ?? []) === JSON.stringify(right ?? []);

function classifyIndex(name, indexes, relationMissing) {
  if (relationMissing) return "INSUFFICIENT_EVIDENCE";
  if (!indexes.length) return "INDEX_MISSING";
  const expectedKeys = TARGETS[name];
  const usable = indexes.filter((index) => index.valid && index.ready);
  const exactShape = (index) => index.method === "btree" && index.unique === false && structuralIndexDefinition(index.definition) === structuralIndexDefinition(expectedIndexDefinition(name)) && !index.predicate && same(index.included_parts, []);
  const named = usable.find((index) => index.name === name);
  if (named && exactShape(named)) return "EXACT_INDEX_PRESENT";
  if (usable.some(exactShape)) return "EQUIVALENT_INDEX_PRESENT";
  if (indexes.some((index) => index.name === name || index.key_parts?.[0] === "purpose")) return "PARTIAL_OR_CONFLICTING_INDEX_PRESENT";
  return "INDEX_MISSING";
}

function classifyPolicy(kind, canonical, extra, rls, effective) {
  if (!canonical || !extra || !rls?.rls_enabled || !effective?.role_exists) return "INSUFFICIENT_EVIDENCE";
  if (!canonical.permissive || !extra.permissive || canonical.roles !== "authenticated" || extra.roles !== "authenticated") return "HUMAN_DECISION_REQUIRED";
  if (kind === "insert") {
    const canonicalCovers = norm(canonical.with_check).includes("user_id = auth.uid()") && norm(canonical.with_check).includes("user_id is null");
    const extraNarrower = norm(extra.with_check).includes("user_id = auth.uid()") && norm(extra.with_check).includes("post_create") && norm(extra.with_check).includes("external_video_upload");
    if (canonicalCovers && extraNarrower) return "REDUNDANT_SAFE_TO_REMOVE";
    if (norm(extra.with_check) === "true" && norm(canonical.with_check) !== "true") return "SECURITY_BROADENING";
    return "HUMAN_DECISION_REQUIRED";
  }
  if (norm(canonical.using) === "true" && norm(extra.using).includes("user_id = auth.uid()")) return "REDUNDANT_SAFE_TO_REMOVE";
  if (norm(extra.using) === "true" && norm(canonical.using) !== "true") return "SECURITY_BROADENING";
  return "HUMAN_DECISION_REQUIRED";
}

export function validateSupplementalRows(rows) {
  if (!rows.length) throw new Error("truncated CSV: no packet rows");
  const seen = new Set();
  for (const row of rows) {
    if (row.packet_version !== PACKET_VERSION) throw new Error("unsupported packet version");
    const key = OUTPUT_COLUMNS.map((column) => row[column] ?? "").join("\u0000"); if (seen.has(key)) throw new Error("duplicate packet row"); seen.add(key);
    const text = Object.values(row).filter(Boolean).join(" ");
    if (/(?:[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|(?:secret|token|password|apikey)\s*[=:]|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|auth\.users)/i.test(text)) throw new Error("unsafe secret-like, email-like, or auth-user evidence");
    if (row.object_schema !== "public" || row.object_name !== "forum_upload_attempts") throw new Error("non-allowlisted business-row evidence");
  }
  for (const section of REQUIRED_SECTIONS) if (!rowsFor(rows, section).length) throw new Error(`required section missing or truncated: ${section}`);
  const manifest = Object.fromEntries(rowsFor(rows, "packet_manifest").map((row) => [row.attribute, row.value]));
  if (manifest.packet_identifier !== "operational-guardrails-production-preflight-supplemental" || manifest.packet_version !== PACKET_VERSION || manifest.expected_section_count !== String(REQUIRED_SECTIONS.length) || manifest.target_relation !== "public.forum_upload_attempts") throw new Error("packet manifest mismatch");
  const aclRows = rowsFor(rows, "relation_acl_catalog").filter((row) => row.evidence_status === "PRESENT").map(json);
  for (const acl of aclRows) if (acl.grantee === "PUBLIC" && acl.grantee_oid !== 0) throw new Error("PUBLIC ACL evidence must use grantee OID 0");
  const effectiveRows = Object.fromEntries(rowsFor(rows, "effective_role_privileges").map((row) => [row.row_key, json(row)]));
  for (const role of ["anon", "authenticated", "service_role", "postgres"]) if (!effectiveRows[role] || typeof effectiveRows[role].role_exists !== "boolean") throw new Error(`missing effective role evidence: ${role}`);
  const indexes = rowsFor(rows, "all_table_indexes").filter((row) => row.evidence_status === "PRESENT").map(json);
  const relationMissing = absent(rows, "rls_state", "public.forum_upload_attempts");
  const indexFindings = Object.fromEntries(Object.keys(TARGETS).map((name) => [name, classifyIndex(name, indexes, relationMissing)]));
  const policies = Object.fromEntries(TARGET_POLICIES.map((name) => [name, absent(rows, "relevant_policies", name) ? null : json(rowsFor(rows, "relevant_policies", name)[0])]));
  const rls = json(rowsFor(rows, "rls_state", "public.forum_upload_attempts")[0]);
  const policyFindings = {
    forum_upload_attempts_insert_self: classifyPolicy("insert", policies.forum_upload_attempts_insert_authenticated, policies.forum_upload_attempts_insert_self, rls, effectiveRows.authenticated),
    forum_upload_attempts_select_self: classifyPolicy("select", policies.forum_upload_attempts_select_authenticated, policies.forum_upload_attempts_select_self, rls, effectiveRows.authenticated),
  };
  const policyRemovalRlsRedundant = Object.values(policyFindings).every((status) => status === "REDUNDANT_SAFE_TO_REMOVE");
  const runtimePrivilegeBlockers = ["SELECT", "INSERT"].filter((privilege) => effectiveRows.authenticated?.[privilege] !== true);
  const policyRemovalBehaviorPreserving = policyRemovalRlsRedundant && runtimePrivilegeBlockers.length === 0;
  const indexProposalEligible = Object.values(indexFindings).every((status) => status === "INDEX_MISSING");
  return { packetVersion: PACKET_VERSION, rowCount: rows.length, sectionCount: REQUIRED_SECTIONS.length, indexFindings, policyFindings, publicAclCatalog: aclRows.filter((row) => row.grantee === "PUBLIC"), effectiveRolePrivileges: effectiveRows, policyRemovalRlsRedundant, runtimePrivilegeBlockers, policyRemovalBehaviorPreserving, indexProposalEligible, createIndexConcurrentlyRequired: indexProposalEligible ? Object.keys(TARGETS) : [], overallProposalEligible: indexProposalEligible && policyRemovalBehaviorPreserving, preflightStatus: "SUPPLEMENTAL_CATALOG_REVIEW_COMPLETE" };
}
