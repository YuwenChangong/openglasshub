import { computeEvidenceFingerprint } from "../../scripts/validate-operational-guardrails-r6-compact-recovery.mjs";

export const baselineRows = [
  ["index_inventory_fingerprint", "11111111111111111111111111111111"],
  ["policy_inventory_fingerprint", "22222222222222222222222222222222"],
  ["table_privileges_fingerprint", "33333333333333333333333333333333"],
  ["resend_metadata_fingerprint", "44444444444444444444444444444444"],
  ["resend_acl_fingerprint", "55555555555555555555555555555555"],
];

export const baselineMap = () => new Map(baselineRows);
const checkNames = ["index_ip_exact", "index_no_equivalent_conflict", "index_user_exact", "resend_acl_exact", "resend_identity_exact", "target_acl_exact", "target_owner_postgres", "target_parallel_unsafe", "target_relation_present", "target_return_identity", "target_search_path", "target_security_definer", "target_signature", "target_statement_timeout", "target_volatile", "target_lock_timeout", "target_non_leakproof", "target_resend_identity_separate"];

export function createRecoveryPacket(overrides = {}) {
  const packet = {
    packet_version: "r6-compact-postflight-recovery-v1",
    phase: "R6-6-recovery",
    target_state: "EXACT_CANDIDATE",
    blocking_count: 0,
    failed_check_ids: "",
    check_statuses_compact: JSON.stringify(Object.fromEntries(checkNames.map((name) => [name, true]))),
    target_metadata_fingerprint: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    target_acl_fingerprint: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    index_inventory_fingerprint: baselineMap().get("index_inventory_fingerprint"),
    policy_inventory_fingerprint: baselineMap().get("policy_inventory_fingerprint"),
    table_privileges_fingerprint: baselineMap().get("table_privileges_fingerprint"),
    resend_metadata_fingerprint: baselineMap().get("resend_metadata_fingerprint"),
    resend_acl_fingerprint: baselineMap().get("resend_acl_fingerprint"),
    relation_present: true,
    overload_count: 1,
    signature_exact: true,
    return_identity: true,
    owner_postgres: true,
    security_definer: true,
    volatile: true,
    parallel_unsafe: true,
    non_leakproof: true,
    search_path_exact: true,
    lock_timeout_exact: true,
    statement_timeout_exact: true,
    public_execute: false,
    anon_execute: false,
    authenticated_execute: false,
    service_role_execute: true,
    index_ip_exact: true,
    index_user_exact: true,
    index_no_equivalent_conflict: true,
    resend_identity_exact: true,
    resend_acl_exact: true,
    target_resend_identity_separate: true,
    evidence_fingerprint: "",
    ...overrides,
  };
  packet.evidence_fingerprint = computeEvidenceFingerprint(packet);
  return packet;
}

export function withFailedChecks(packet, names) {
  const statuses = JSON.parse(packet.check_statuses_compact);
  for (const name of names) statuses[name] = false;
  const next = { ...packet, blocking_count: names.length, failed_check_ids: [...names].sort().join(","), check_statuses_compact: JSON.stringify(statuses), evidence_fingerprint: "" };
  next.evidence_fingerprint = computeEvidenceFingerprint(next);
  return next;
}
