import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parsePacketDocument } from "./validate-operational-guardrails-r6-single-result.mjs";

export const RECOVERY_PACKET_VERSION = "r6-compact-postflight-recovery-v1";
export const RECOVERY_COLUMNS = [
  "packet_version", "phase", "target_state", "blocking_count", "failed_check_ids", "check_statuses_compact",
  "target_metadata_fingerprint", "target_acl_fingerprint", "index_inventory_fingerprint", "policy_inventory_fingerprint",
  "table_privileges_fingerprint", "resend_metadata_fingerprint", "resend_acl_fingerprint", "relation_present", "overload_count",
  "signature_exact", "return_identity", "owner_postgres", "security_definer", "volatile", "parallel_unsafe", "non_leakproof",
  "search_path_exact", "lock_timeout_exact", "statement_timeout_exact", "public_execute", "anon_execute", "authenticated_execute",
  "service_role_execute", "index_ip_exact", "index_user_exact", "index_no_equivalent_conflict", "resend_identity_exact",
  "resend_acl_exact", "target_resend_identity_separate", "evidence_fingerprint",
];
const fingerprint = /^[0-9a-f]{32}$/;
const booleanColumns = new Set(RECOVERY_COLUMNS.filter((column) => /^(relation_present|signature_exact|return_identity|owner_postgres|security_definer|volatile|parallel_unsafe|non_leakproof|search_path_exact|lock_timeout_exact|statement_timeout_exact|public_execute|anon_execute|authenticated_execute|service_role_execute|index_ip_exact|index_user_exact|index_no_equivalent_conflict|resend_identity_exact|resend_acl_exact|target_resend_identity_separate)$/.test(column)));
const requiredChecks = ["index_ip_exact", "index_no_equivalent_conflict", "index_user_exact", "resend_acl_exact", "resend_identity_exact", "target_acl_exact", "target_owner_postgres", "target_parallel_unsafe", "target_relation_present", "target_return_identity", "target_search_path", "target_security_definer", "target_signature", "target_statement_timeout", "target_volatile", "target_lock_timeout", "target_non_leakproof", "target_resend_identity_separate"];
const exactKeys = (value, expected) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join("\0") === [...expected].sort().join("\0");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (value) => JSON.stringify(value);

export function computeEvidenceFingerprint(packet) {
  const canonicalPacket = Object.fromEntries(RECOVERY_COLUMNS.filter((column) => column !== "evidence_fingerprint").map((column) => [column, packet[column]]));
  return createHash("md5").update(JSON.stringify(canonicalPacket)).digest("hex");
}

export function parseRecoveryPacket(value) {
  const packet = typeof value === "string" ? JSON.parse(value) : value;
  if (!exactKeys(packet, RECOVERY_COLUMNS)) throw new Error("RECOVERY_PACKET_SCHEMA_MISMATCH");
  if (packet.packet_version !== RECOVERY_PACKET_VERSION || packet.phase !== "R6-6-recovery") throw new Error("RECOVERY_PACKET_VERSION_MISMATCH");
  if (!["ABSENT", "EXACT_CANDIDATE", "CONFLICTING"].includes(packet.target_state)) throw new Error("RECOVERY_TARGET_STATE_INVALID");
  if (!Number.isSafeInteger(packet.blocking_count) || packet.blocking_count < 0) throw new Error("RECOVERY_BLOCKING_COUNT_INVALID");
  if (!Number.isSafeInteger(packet.overload_count) || packet.overload_count < 0) throw new Error("RECOVERY_OVERLOAD_COUNT_INVALID");
  for (const column of booleanColumns) if (typeof packet[column] !== "boolean") throw new Error("RECOVERY_BOOLEAN_FIELD_INVALID");
  for (const column of ["target_metadata_fingerprint", "target_acl_fingerprint", "index_inventory_fingerprint", "policy_inventory_fingerprint", "table_privileges_fingerprint", "resend_metadata_fingerprint", "resend_acl_fingerprint", "evidence_fingerprint"]) if (typeof packet[column] !== "string" || !fingerprint.test(packet[column])) throw new Error("RECOVERY_FINGERPRINT_INVALID");
  if (typeof packet.failed_check_ids !== "string" || typeof packet.check_statuses_compact !== "string") throw new Error("RECOVERY_COMPACT_FIELD_INVALID");
  let compact;
  try { compact = JSON.parse(packet.check_statuses_compact); } catch { throw new Error("RECOVERY_CHECK_STATUSES_INVALID"); }
  const rawCheckKeys = [...packet.check_statuses_compact.matchAll(/"([^"\\]+)"\s*:/g)].map((match) => match[1]);
  if (rawCheckKeys.length !== new Set(rawCheckKeys).size) throw new Error("RECOVERY_CHECK_ID_DUPLICATE");
  if (!exactKeys(compact, requiredChecks) || Object.values(compact).some((value) => typeof value !== "boolean")) throw new Error("RECOVERY_CHECK_STATUSES_INVALID");
  if (canonical(compact) !== packet.check_statuses_compact) throw new Error("RECOVERY_COMPACT_ENCODING_NONCANONICAL");
  const failed = requiredChecks.filter((key) => !compact[key]).sort();
  if (packet.failed_check_ids !== failed.join(",") || packet.blocking_count !== failed.length) throw new Error("RECOVERY_CHECK_STATUS_CONTRADICTION");
  const derivedChecks = {
    index_ip_exact: packet.relation_present && packet.index_ip_exact,
    index_no_equivalent_conflict: packet.relation_present && packet.index_no_equivalent_conflict,
    index_user_exact: packet.relation_present && packet.index_user_exact,
    resend_acl_exact: packet.resend_acl_exact,
    resend_identity_exact: packet.resend_identity_exact,
    target_acl_exact: !packet.public_execute && !packet.anon_execute && !packet.authenticated_execute && packet.service_role_execute,
    target_owner_postgres: packet.owner_postgres,
    target_parallel_unsafe: packet.parallel_unsafe,
    target_relation_present: packet.relation_present,
    target_return_identity: packet.return_identity,
    target_search_path: packet.search_path_exact,
    target_security_definer: packet.security_definer,
    target_signature: packet.overload_count === 1 && packet.signature_exact,
    target_statement_timeout: packet.statement_timeout_exact,
    target_volatile: packet.volatile,
    target_lock_timeout: packet.lock_timeout_exact,
    target_non_leakproof: packet.non_leakproof,
    target_resend_identity_separate: packet.target_resend_identity_separate,
  };
  if (requiredChecks.some((key) => compact[key] !== derivedChecks[key])) throw new Error("RECOVERY_CHECK_STATUS_CONTRADICTION");
  if (packet.evidence_fingerprint !== computeEvidenceFingerprint(packet)) throw new Error("RECOVERY_EVIDENCE_FINGERPRINT_INVALID");
  const serialized = `${JSON.stringify(packet)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > 8192) throw new Error("RECOVERY_PACKET_TOO_LARGE");
  return packet;
}

export async function loadBaseline(pathname, expectedSha256) {
  const content = await readFile(pathname, "utf8");
  if (sha256(content) !== expectedSha256) throw new Error("RECOVERY_BASELINE_SHA_MISMATCH");
  const rows = parsePacketDocument(content);
  const map = new Map(rows.map((row) => [row.check_id, row.actual_value_redacted]));
  for (const key of ["index_inventory_fingerprint", "policy_inventory_fingerprint", "table_privileges_fingerprint", "resend_metadata_fingerprint", "resend_acl_fingerprint"]) if (!map.get(key)) throw new Error("RECOVERY_BASELINE_MALFORMED");
  return map;
}

export function classifyRecovery(packet, baseline) {
  let current;
  try { current = parseRecoveryPacket(packet); } catch { return "INSUFFICIENT_EVIDENCE"; }
  if (!(baseline instanceof Map)) return "INSUFFICIENT_EVIDENCE";
  const protectedPairs = [
    ["index_inventory_fingerprint", "index_inventory_fingerprint"], ["policy_inventory_fingerprint", "policy_inventory_fingerprint"],
    ["table_privileges_fingerprint", "table_privileges_fingerprint"], ["resend_metadata_fingerprint", "resend_metadata_fingerprint"],
    ["resend_acl_fingerprint", "resend_acl_fingerprint"],
  ];
  if (protectedPairs.some(([baselineKey]) => !baseline.get(baselineKey))) return "INSUFFICIENT_EVIDENCE";
  const baselineMatches = protectedPairs.every(([baselineKey, packetKey]) => baseline.get(baselineKey) === current[packetKey]);
  const absenceClean = current.target_state === "ABSENT" && current.overload_count === 0 && current.relation_present && current.index_ip_exact && current.index_user_exact && current.index_no_equivalent_conflict && current.resend_identity_exact && current.resend_acl_exact && current.target_resend_identity_separate && baselineMatches;
  const targetExact = current.target_state === "EXACT_CANDIDATE" && current.blocking_count === 0 && current.relation_present && current.overload_count === 1 && current.signature_exact && current.return_identity && current.owner_postgres && current.security_definer && current.volatile && current.parallel_unsafe && current.non_leakproof && current.search_path_exact && current.lock_timeout_exact && current.statement_timeout_exact && !current.public_execute && !current.anon_execute && !current.authenticated_execute && current.service_role_execute && current.index_ip_exact && current.index_user_exact && current.index_no_equivalent_conflict && current.resend_identity_exact && current.resend_acl_exact && current.target_resend_identity_separate && baselineMatches;
  if (targetExact) return "COMMITTED_EXACTLY";
  if (absenceClean) return "NOT_COMMITTED";
  return "CONFLICTING_OR_PARTIAL";
}

const [packetPath, baselinePath, baselineSha256] = process.argv.slice(2);
if (process.argv[1] === fileURLToPath(import.meta.url) && packetPath && baselinePath && baselineSha256) {
  const packet = parseRecoveryPacket(await readFile(packetPath, "utf8"));
  const baseline = await loadBaseline(baselinePath, baselineSha256);
  console.log(JSON.stringify({ status: "PASS", classification: classifyRecovery(packet, baseline), canonicalBytes: Buffer.byteLength(`${JSON.stringify(packet)}\n`, "utf8") }));
}
