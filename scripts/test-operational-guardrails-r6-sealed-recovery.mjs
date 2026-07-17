import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createSealedRecoveryToken, decodeSealedRecoveryToken, SEALED_PAYLOAD_MAX_BYTES } from "./lib/operational-guardrails-r6-sealed-token.mjs";
import { persistSealedRecoveryToken } from "./persist-operational-guardrails-r6-sealed-recovery-token.mjs";
import { verifySealedRecoveryToken } from "./verify-operational-guardrails-r6-sealed-recovery-token.mjs";
import { baselineRows, createRecoveryPacket, withFailedChecks } from "../tests/fixtures/operational-guardrails-r6-compact-recovery.mjs";
import { classifyRecovery } from "./validate-operational-guardrails-r6-compact-recovery.mjs";

const baselineDocument = `${JSON.stringify({ capture_version: "r6-schema-aware-capture-v1", kind: "preflight", rows: baselineRows.map(([check_id, actual_value_redacted], index) => ({ packet_version: "r6-single-result-preflight-v3", phase: "R6-2", section_order: "1", check_order: String(index + 1), check_id, object_identity: "public.forum_upload_attempts", expected_value: "redacted", actual_value_redacted, status: "PASS", blocking: "false", classification: "FUNCTION_ABSENT_SAFE_TO_CREATE", evidence_fingerprint: createHash("md5").update(check_id).digest("hex") })) })}\n`;
const baselineHash = createHash("sha256").update(baselineDocument).digest("hex");
const root = await mkdtemp(path.join(os.tmpdir(), "openglass r6 sealed token "));
const baselinePath = path.join(root, "baseline.json");
await writeFile(baselinePath, baselineDocument, "utf8");
const packet = createRecoveryPacket();
const token = createSealedRecoveryToken(JSON.stringify(packet));
const tokenPath = path.join(root, "sealed-token.txt");
const tokenShaPath = path.join(root, "sealed-token.sha256");
const persisted = await persistSealedRecoveryToken({ token, outputPath: tokenPath, shaOutputPath: tokenShaPath });
assert.equal(persisted.declaredLength, Buffer.byteLength(JSON.stringify(packet), "utf8"));
const result = await verifySealedRecoveryToken({ tokenPath, tokenShaPath, outputPath: path.join(root, "evidence.json"), outputShaPath: path.join(root, "evidence.sha256"), verificationPath: path.join(root, "verification.json"), baselinePath, baselineSha256: baselineHash, approvedCommit: "5ab57dc7e597ffd16616108eb5ad60e58d966605" });
assert.equal(result.classification, "COMMITTED_EXACTLY");
assert.deepEqual(JSON.parse(await readFile(path.join(root, "evidence.json"), "utf8")), packet);
assert.match(await readFile(path.join(root, "verification.json"), "utf8"), /"token_sha_verified": true/);
await assert.rejects(() => access(path.join(root, "raw-connector-envelope.json")));
await assert.rejects(() => verifySealedRecoveryToken({ tokenPath, tokenShaPath, outputPath: path.join(process.cwd(), "r6-sealed-evidence.json"), outputShaPath: path.join(root, "inside-repository.sha256"), verificationPath: path.join(root, "inside-repository-verification.json"), baselinePath, baselineSha256: baselineHash, approvedCommit: "5ab57dc7e597ffd16616108eb5ad60e58d966605" }), /PATH_MUST_BE_OUTSIDE_REPOSITORY/);

const invalid = (name, value, code) => assert.throws(() => decodeSealedRecoveryToken(value), new RegExp(code), name);
invalid("wrong-prefix", token.replace("R6SEALED1", "R6SEALED2"), "FORMAT");
invalid("missing-length", token.replace(/^R6SEALED1\.\d+\./, "R6SEALED1.."), "FORMAT");
invalid("non-decimal-length", token.replace(/^R6SEALED1\.\d+\./, "R6SEALED1.x."), "FORMAT");
invalid("uppercase-digest", token.replace(/\.[0-9a-f]{64}\./, (value) => value.toUpperCase()), "FORMAT");
invalid("padding", `${token}=`, "FORMAT");
invalid("whitespace", `${token} `, "FORMAT");
invalid("markdown", `\`${token}\``, "FORMAT");
invalid("prefix-text", `x${token}`, "FORMAT");
invalid("truncated", token.slice(0, -1), "SHA|BASE64URL|LENGTH");
invalid("mutated", `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`, "SHA");
invalid("length-mismatch", token.replace(/^R6SEALED1\.\d+\./, "R6SEALED1.1."), "LENGTH");
invalid("oversized", createSealedRecoveryToken(JSON.stringify(packet)).replace(/^R6SEALED1\.\d+\./, `R6SEALED1.${SEALED_PAYLOAD_MAX_BYTES + 1}.`), "LENGTH");
const unknownPacket = { ...packet, unknown: true };
const unknownToken = createSealedRecoveryToken(JSON.stringify(unknownPacket));
const unknownRoot = await mkdtemp(path.join(os.tmpdir(), "openglass r6 sealed unknown "));
const unknownTokenPath = path.join(unknownRoot, "token.txt");
const unknownTokenSha = path.join(unknownRoot, "token.sha256");
await persistSealedRecoveryToken({ token: unknownToken, outputPath: unknownTokenPath, shaOutputPath: unknownTokenSha });
await assert.rejects(() => verifySealedRecoveryToken({ tokenPath: unknownTokenPath, tokenShaPath: unknownTokenSha, outputPath: path.join(unknownRoot, "evidence.json"), outputShaPath: path.join(unknownRoot, "evidence.sha256"), verificationPath: path.join(unknownRoot, "verification.json"), baselinePath, baselineSha256: baselineHash, approvedCommit: "5ab57dc7e597ffd16616108eb5ad60e58d966605" }), /PAYLOAD_SCHEMA/);
const conflicting = withFailedChecks({ ...createRecoveryPacket({ target_state: "CONFLICTING" }), evidence_fingerprint: "" }, ["target_owner_postgres"]);
assert.equal(decodeSealedRecoveryToken(createSealedRecoveryToken(JSON.stringify(conflicting))).payloadText, JSON.stringify(conflicting));

const baseline = new Map(baselineRows);
const absent = withFailedChecks(createRecoveryPacket({ target_state: "ABSENT", overload_count: 0, signature_exact: false, return_identity: false, owner_postgres: false, security_definer: false, volatile: false, parallel_unsafe: false, non_leakproof: false, search_path_exact: false, lock_timeout_exact: false, statement_timeout_exact: false, service_role_execute: false }), ["target_acl_exact", "target_lock_timeout", "target_non_leakproof", "target_owner_postgres", "target_parallel_unsafe", "target_return_identity", "target_search_path", "target_security_definer", "target_signature", "target_statement_timeout", "target_volatile"]);
const unsafe = (override, checks) => withFailedChecks({ ...createRecoveryPacket({ target_state: "CONFLICTING", ...override }), evidence_fingerprint: "" }, checks);
const equivalenceCases = [
  ["exact", createRecoveryPacket(), "COMMITTED_EXACTLY"],
  ["absent", absent, "NOT_COMMITTED"],
  ["wrong-owner", unsafe({ owner_postgres: false }, ["target_owner_postgres"]), "CONFLICTING_OR_PARTIAL"],
  ["security-invoker", unsafe({ security_definer: false }, ["target_security_definer"]), "CONFLICTING_OR_PARTIAL"],
  ["wrong-signature", unsafe({ signature_exact: false }, ["target_signature"]), "CONFLICTING_OR_PARTIAL"],
  ["wrong-return", unsafe({ return_identity: false }, ["target_return_identity"]), "CONFLICTING_OR_PARTIAL"],
  ["extra-overload", unsafe({ overload_count: 2 }, ["target_signature"]), "CONFLICTING_OR_PARTIAL"],
  ["wrong-search-path", unsafe({ search_path_exact: false }, ["target_search_path"]), "CONFLICTING_OR_PARTIAL"],
  ["missing-lock-timeout", unsafe({ lock_timeout_exact: false }, ["target_lock_timeout"]), "CONFLICTING_OR_PARTIAL"],
  ["missing-statement-timeout", unsafe({ statement_timeout_exact: false }, ["target_statement_timeout"]), "CONFLICTING_OR_PARTIAL"],
  ["public-execute", unsafe({ public_execute: true }, ["target_acl_exact"]), "CONFLICTING_OR_PARTIAL"],
  ["anon-execute", unsafe({ anon_execute: true }, ["target_acl_exact"]), "CONFLICTING_OR_PARTIAL"],
  ["authenticated-execute", unsafe({ authenticated_execute: true }, ["target_acl_exact"]), "CONFLICTING_OR_PARTIAL"],
  ["service-role-absent", unsafe({ service_role_execute: false }, ["target_acl_exact"]), "CONFLICTING_OR_PARTIAL"],
  ["policy-drift", createRecoveryPacket({ policy_inventory_fingerprint: "cccccccccccccccccccccccccccccccc" }), "CONFLICTING_OR_PARTIAL"],
  ["privilege-drift", createRecoveryPacket({ table_privileges_fingerprint: "dddddddddddddddddddddddddddddddd" }), "CONFLICTING_OR_PARTIAL"],
  ["index-drift", createRecoveryPacket({ index_inventory_fingerprint: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" }), "CONFLICTING_OR_PARTIAL"],
  ["invalid-index", unsafe({ index_ip_exact: false }, ["index_ip_exact"]), "CONFLICTING_OR_PARTIAL"],
  ["unready-index", unsafe({ index_user_exact: false }, ["index_user_exact"]), "CONFLICTING_OR_PARTIAL"],
  ["resend-metadata-drift", createRecoveryPacket({ resend_metadata_fingerprint: "ffffffffffffffffffffffffffffffff" }), "CONFLICTING_OR_PARTIAL"],
  ["resend-acl-drift", createRecoveryPacket({ resend_acl_fingerprint: "99999999999999999999999999999999" }), "CONFLICTING_OR_PARTIAL"],
  ["resend-missing", unsafe({ resend_identity_exact: false }, ["resend_identity_exact"]), "CONFLICTING_OR_PARTIAL"],
  ["identity-collision", unsafe({ target_resend_identity_separate: false }, ["target_resend_identity_separate"]), "CONFLICTING_OR_PARTIAL"],
  ["missing-baseline", createRecoveryPacket(), "INSUFFICIENT_EVIDENCE", new Map()],
  ["malformed-baseline", createRecoveryPacket(), "INSUFFICIENT_EVIDENCE", new Map([["index_inventory_fingerprint", "x"]])],
  ["contradictory-evidence", { ...createRecoveryPacket(), blocking_count: 1 }, "INSUFFICIENT_EVIDENCE"],
];
for (const [name, value, expected, caseBaseline = baseline] of equivalenceCases) {
  const decoded = decodeSealedRecoveryToken(createSealedRecoveryToken(JSON.stringify(value)));
  assert.equal(classifyRecovery(decoded.payloadText, caseBaseline), expected, name);
}
console.log(JSON.stringify({ status: "PASS", tokenOnlyPersistence: true, exactEvidence: true, negativeCases: 14, semanticEquivalenceStates: equivalenceCases.length, rawEnvelopePersisted: false }));
