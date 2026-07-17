import { createHash } from "node:crypto";
import { computeEvidenceFingerprint, parseRecoveryPacket } from "../validate-operational-guardrails-r6-compact-recovery.mjs";

export const SEALED_TOKEN_PREFIX = "R6SEALED1";
export const SEALED_COMPACT_PAYLOAD_VERSION = "R6SEALED2";
export const SEALED_PAYLOAD_MAX_BYTES = 4096;
export const SEALED_TOKEN_MAX_BYTES = 6144;
export const SEALED_TOKEN_PATTERN = /^R6SEALED1\.([0-9]+)\.([0-9a-f]{64})\.([A-Za-z0-9_-]+)$/;

const BOOLEAN_FIELDS = [
  "relation_present", "signature_exact", "return_identity", "owner_postgres", "security_definer", "volatile", "parallel_unsafe", "non_leakproof", "search_path_exact", "lock_timeout_exact", "statement_timeout_exact", "public_execute", "anon_execute", "authenticated_execute", "service_role_execute", "index_ip_exact", "index_user_exact", "index_no_equivalent_conflict", "resend_identity_exact", "resend_acl_exact", "target_resend_identity_separate",
];
const FINGERPRINT_FIELDS = ["target_metadata_fingerprint", "target_acl_fingerprint", "index_inventory_fingerprint", "policy_inventory_fingerprint", "table_privileges_fingerprint", "resend_metadata_fingerprint", "resend_acl_fingerprint"];
const CHECK_FIELDS = ["index_ip_exact", "index_no_equivalent_conflict", "index_user_exact", "resend_acl_exact", "resend_identity_exact", "target_acl_exact", "target_owner_postgres", "target_parallel_unsafe", "target_relation_present", "target_return_identity", "target_search_path", "target_security_definer", "target_signature", "target_statement_timeout", "target_volatile", "target_lock_timeout", "target_non_leakproof", "target_resend_identity_separate"];
const STATE_CODES = new Map([["A", "ABSENT"], ["E", "EXACT_CANDIDATE"], ["C", "CONFLICTING"]]);

export const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export function createSealedRecoveryToken(payloadText) {
  const payloadBytes = Buffer.from(payloadText, "utf8");
  if (payloadBytes.byteLength < 1 || payloadBytes.byteLength > SEALED_PAYLOAD_MAX_BYTES) throw new Error("R6_SEALED_PAYLOAD_SIZE_INVALID");
  const token = `${SEALED_TOKEN_PREFIX}.${payloadBytes.byteLength}.${sha256(payloadBytes)}.${payloadBytes.toString("base64url")}`;
  if (Buffer.byteLength(token, "ascii") > SEALED_TOKEN_MAX_BYTES) throw new Error("R6_SEALED_TOKEN_SIZE_INVALID");
  return token;
}

export function createCompactSealedRecoveryPayload(packet) {
  const verified = parseRecoveryPacket(packet);
  const stateCode = new Map([["ABSENT", "A"], ["EXACT_CANDIDATE", "E"], ["CONFLICTING", "C"]]).get(verified.target_state);
  return JSON.stringify([
    SEALED_COMPACT_PAYLOAD_VERSION,
    stateCode,
    verified.overload_count,
    BOOLEAN_FIELDS.map((field) => verified[field] ? "1" : "0").join(""),
    ...FINGERPRINT_FIELDS.map((field) => verified[field]),
  ]);
}

function reconstructCompactPacket(value) {
  if (!Array.isArray(value) || value.length !== 11 || value[0] !== SEALED_COMPACT_PAYLOAD_VERSION || !STATE_CODES.has(value[1]) || !Number.isSafeInteger(value[2]) || value[2] < 0 || typeof value[3] !== "string" || !/^[01]{21}$/.test(value[3]) || value.slice(4).some((fingerprint) => typeof fingerprint !== "string" || !/^[0-9a-f]{32}$/.test(fingerprint))) throw new Error("R6_SEALED_COMPACT_PAYLOAD_INVALID");
  const booleans = Object.fromEntries(BOOLEAN_FIELDS.map((field, index) => [field, value[3][index] === "1"]));
  const checks = {
    index_ip_exact: booleans.relation_present && booleans.index_ip_exact,
    index_no_equivalent_conflict: booleans.relation_present && booleans.index_no_equivalent_conflict,
    index_user_exact: booleans.relation_present && booleans.index_user_exact,
    resend_acl_exact: booleans.resend_acl_exact,
    resend_identity_exact: booleans.resend_identity_exact,
    target_acl_exact: !booleans.public_execute && !booleans.anon_execute && !booleans.authenticated_execute && booleans.service_role_execute,
    target_owner_postgres: booleans.owner_postgres,
    target_parallel_unsafe: booleans.parallel_unsafe,
    target_relation_present: booleans.relation_present,
    target_return_identity: booleans.return_identity,
    target_search_path: booleans.search_path_exact,
    target_security_definer: booleans.security_definer,
    target_signature: value[2] === 1 && booleans.signature_exact,
    target_statement_timeout: booleans.statement_timeout_exact,
    target_volatile: booleans.volatile,
    target_lock_timeout: booleans.lock_timeout_exact,
    target_non_leakproof: booleans.non_leakproof,
    target_resend_identity_separate: booleans.target_resend_identity_separate,
  };
  const failed = CHECK_FIELDS.filter((field) => !checks[field]).sort();
  const packet = {
    packet_version: "r6-compact-postflight-recovery-v1",
    phase: "R6-6-recovery",
    target_state: STATE_CODES.get(value[1]),
    blocking_count: failed.length,
    failed_check_ids: failed.join(","),
    check_statuses_compact: JSON.stringify(checks),
    ...Object.fromEntries(FINGERPRINT_FIELDS.map((field, index) => [field, value[index + 4]])),
    ...booleans,
    overload_count: value[2],
    evidence_fingerprint: "",
  };
  packet.evidence_fingerprint = computeEvidenceFingerprint(packet);
  return parseRecoveryPacket(packet);
}

export function decodeSealedRecoveryToken(token) {
  if (typeof token !== "string" || Buffer.byteLength(token, "ascii") > SEALED_TOKEN_MAX_BYTES) throw new Error("R6_SEALED_TOKEN_SIZE_INVALID");
  const match = SEALED_TOKEN_PATTERN.exec(token);
  if (!match) throw new Error("R6_SEALED_TOKEN_FORMAT_INVALID");
  const declaredLength = Number(match[1]);
  if (!Number.isSafeInteger(declaredLength) || declaredLength < 1 || declaredLength > SEALED_PAYLOAD_MAX_BYTES || match[1] !== String(declaredLength)) throw new Error("R6_SEALED_TOKEN_LENGTH_INVALID");
  if (match[3].length % 4 === 1) throw new Error("R6_SEALED_TOKEN_BASE64URL_INVALID");
  const payloadBytes = Buffer.from(match[3], "base64url");
  if (payloadBytes.toString("base64url") !== match[3]) throw new Error("R6_SEALED_TOKEN_BASE64URL_INVALID");
  if (payloadBytes.byteLength !== declaredLength) throw new Error("R6_SEALED_TOKEN_LENGTH_MISMATCH");
  if (sha256(payloadBytes) !== match[2]) throw new Error("R6_SEALED_TOKEN_SHA_MISMATCH");
  let payloadText;
  try { payloadText = new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes); } catch { throw new Error("R6_SEALED_TOKEN_UTF8_INVALID"); }
  if (!Buffer.from(payloadText, "utf8").equals(payloadBytes)) throw new Error("R6_SEALED_TOKEN_UTF8_INVALID");
  let value;
  try { value = JSON.parse(payloadText); } catch { throw new Error("R6_SEALED_PAYLOAD_JSON_INVALID"); }
  if (JSON.stringify(value) !== payloadText) throw new Error("R6_SEALED_PAYLOAD_NONCANONICAL");
  const payloadFormat = Array.isArray(value) ? "compact-v2" : "legacy-packet";
  const packet = Array.isArray(value) ? reconstructCompactPacket(value) : parseRecoveryPacket(value);
  return { token, declaredLength, payloadSha256: match[2], payloadBytes, payloadText, payloadFormat, packet };
}
