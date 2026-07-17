import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { PINNED_PSQL_IMAGE } from "./lib/docker-psql-file-transport.mjs";
import { CONTRACTS, OUTPUT_COLUMNS, validateRows } from "./validate-operational-guardrails-r6-single-result.mjs";
import { RECOVERY_COLUMNS, classifyRecovery, parseRecoveryPacket } from "./validate-operational-guardrails-r6-compact-recovery.mjs";
import { decodeSealedRecoveryToken } from "./lib/operational-guardrails-r6-sealed-token.mjs";
import { persistSealedRecoveryToken } from "./persist-operational-guardrails-r6-sealed-recovery-token.mjs";
import { verifySealedRecoveryToken } from "./verify-operational-guardrails-r6-sealed-recovery-token.mjs";

const root = process.cwd();
const container = `openglass-r6-mirror-${process.pid}-${randomUUID().replaceAll("-", "")}`;
const database = `openglass_r6_${randomUUID().replaceAll("-", "")}`;
const run = (args, options = {}) => {
  const result = spawnSync("docker", args, { encoding: "utf8", ...options });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `docker exited ${result.status}`);
  return result.stdout;
};
const psql = (sql) => {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const result = spawnSync("docker", ["exec", "-i", container, "psql", "-X", "-qAt", "-F", "\t", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database], { input: sql, encoding: "utf8" });
    if (result.status === 0) return result.stdout;
    if (!/No such file or directory/.test(result.stderr ?? "") || attempt === 7) throw new Error(result.stderr || result.stdout || `local psql exited ${result.status}`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
  throw new Error("unreachable local psql retry state");
};
const waitForReady = async () => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const ready = spawnSync("docker", ["exec", container, "pg_isready", "-U", "postgres"], { encoding: "utf8" });
    if (ready.status === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("local R6 mirror PostgreSQL did not become ready");
};
const packetRows = (text) => text.trim().split(/\r?\n/).filter(Boolean).map((line) => {
  const values = line.split("\t");
  assert.equal(values.length, OUTPUT_COLUMNS.length, "R6 mirror packet has the reviewed output schema");
  return Object.fromEntries(OUTPUT_COLUMNS.map((column, index) => [column, column === "blocking" ? (values[index] === "t" ? "true" : values[index] === "f" ? "false" : values[index]) : values[index]]));
});
const compactPacket = (text) => {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  assert.equal(lines.length, 1, "R6 compact recovery returns exactly one row");
  const values = lines[0].split("\t");
  assert.equal(values.length, RECOVERY_COLUMNS.length, "R6 compact recovery has the committed output schema");
  const booleans = new Set(RECOVERY_COLUMNS.filter((column) => /^(relation_present|signature_exact|return_identity|owner_postgres|security_definer|volatile|parallel_unsafe|non_leakproof|search_path_exact|lock_timeout_exact|statement_timeout_exact|public_execute|anon_execute|authenticated_execute|service_role_execute|index_ip_exact|index_user_exact|index_no_equivalent_conflict|resend_identity_exact|resend_acl_exact|target_resend_identity_separate)$/.test(column)));
  return Object.fromEntries(RECOVERY_COLUMNS.map((column, index) => [column, booleans.has(column) ? values[index] === "t" : ["blocking_count", "overload_count"].includes(column) ? Number(values[index]) : values[index]]));
};

const [preflight, postflight, recovery, sealedRecovery, proposal] = await Promise.all([
  readFile(`${root}/docs/ops/reconciliation/operational-guardrails-r6-production-preflight.sql`, "utf8"),
  readFile(`${root}/docs/ops/reconciliation/operational-guardrails-r6-production-postflight.sql`, "utf8"),
  readFile(`${root}/docs/ops/reconciliation/operational-guardrails-r6-production-postflight-recovery.sql`, "utf8"),
  readFile(`${root}/docs/ops/reconciliation/operational-guardrails-r6-production-postflight-recovery-sealed.sql`, "utf8"),
  readFile(`${root}/docs/ops/reconciliation/operational-guardrails-rate-limit-r2-unexecuted-proposal.sql`, "utf8"),
]);

let started = false;
let proofRoot;
try {
  run(["run", "-d", "--name", container, "--network", "none", "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "--tmpfs", "/var/lib/postgresql/data:rw,noexec,nosuid,size=128m", PINNED_PSQL_IMAGE]);
  started = true;
  await waitForReady();
  run(["exec", container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c", `CREATE DATABASE ${database}`]);
  await waitForReady();
  psql(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
    END $$;
    CREATE TABLE public.forum_upload_attempts (
      user_id uuid, purpose text NOT NULL, ip_hash text NOT NULL, bytes bigint NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE public.forum_upload_attempts ENABLE ROW LEVEL SECURITY;
    CREATE POLICY mirror_inventory ON public.forum_upload_attempts FOR SELECT TO authenticated USING (true);
    CREATE INDEX forum_upload_attempts_purpose_ip_created_idx ON public.forum_upload_attempts USING btree (purpose, ip_hash, created_at DESC);
    CREATE INDEX forum_upload_attempts_purpose_user_created_idx ON public.forum_upload_attempts USING btree (purpose, user_id, created_at DESC);
    CREATE FUNCTION public.consume_verification_email_resend_limit(input_ip_hash text, max_attempts integer DEFAULT 5, window_hours integer DEFAULT 24)
    RETURNS TABLE(allowed boolean, attempts integer) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    BEGIN RETURN QUERY SELECT true, 1; END; $$;
    REVOKE ALL ON FUNCTION public.consume_verification_email_resend_limit(text, integer, integer) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.consume_verification_email_resend_limit(text, integer, integer) TO anon;
    GRANT EXECUTE ON FUNCTION public.consume_verification_email_resend_limit(text, integer, integer) TO authenticated;
  `);
  const preflightRows = packetRows(psql(preflight));
  assert.equal(preflightRows.length, CONTRACTS.preflight.checks.length);
  assert.equal(validateRows("preflight", preflightRows, { expectedTargetMarker: preflightRows.find((row) => row.check_id === "target_database_fingerprint")?.actual_value_redacted }).classification, "FUNCTION_ABSENT_SAFE_TO_CREATE");
  await waitForReady();
  psql(proposal);
  await waitForReady();
  const postflightRows = packetRows(psql(postflight));
  assert.equal(postflightRows.length, CONTRACTS.postflight.checks.length);
  assert.equal(validateRows("postflight", postflightRows, { baseline: preflightRows }).classification, "PRODUCTION_RPC_POSTFLIGHT_PASSED");
  const recoveryPacket = parseRecoveryPacket(compactPacket(psql(recovery)));
  const baseline = new Map(preflightRows.map((row) => [row.check_id, row.actual_value_redacted]));
  assert.equal(classifyRecovery(recoveryPacket, baseline), "COMMITTED_EXACTLY");
  const sealedRows = psql(sealedRecovery).trim().split(/\r?\n/).filter(Boolean);
  assert.equal(sealedRows.length, 1, "sealed recovery returns exactly one row");
  const sealedToken = sealedRows[0];
  assert.equal(Buffer.from(sealedToken, "ascii").toString("ascii"), sealedToken, "sealed scalar is ASCII-only");
  assert.equal((sealedToken.match(/\./g) ?? []).length, 3, "sealed scalar has four segments");
  assert.equal((sealedToken.match(/\r/g) ?? []).length, 0, "sealed scalar has no CR");
  assert.equal((sealedToken.match(/\n/g) ?? []).length, 0, "sealed scalar has no LF");
  assert.equal((sealedToken.match(/\s/g) ?? []).length, 0, "sealed scalar has no whitespace");
  assert.equal((sealedToken.match(/=/g) ?? []).length, 0, "sealed scalar has no base64 padding");
  assert.ok(Buffer.byteLength(sealedToken, "ascii") < 900, "sealed scalar fits beneath the proven connector response budget");
  const scalarType = psql(`SELECT pg_typeof(sealed_token)::text FROM (${sealedRecovery.trim().replace(/;$/, "")}) sealed_result;`).trim();
  assert.equal(scalarType, "text", "sealed scalar type is text");
  const sealed = decodeSealedRecoveryToken(sealedToken);
  assert.equal(sealed.declaredLength, sealed.payloadBytes.byteLength, "declared payload length matches decoded bytes");
  const sealedPacket = parseRecoveryPacket(sealed.packet);
  assert.deepEqual(sealedPacket, recoveryPacket, "sealed payload is the compact recovery packet");
  assert.equal(classifyRecovery(sealedPacket, baseline), "COMMITTED_EXACTLY");
  proofRoot = await mkdtemp(path.join(os.tmpdir(), "openglass-r6-sealed-pg-"));
  const baselineText = `${JSON.stringify({ capture_version: "r6-schema-aware-capture-v1", kind: "preflight", rows: preflightRows })}\n`;
  const baselinePath = path.join(proofRoot, "baseline.json");
  const tokenPath = path.join(proofRoot, "token.txt");
  const tokenShaPath = path.join(proofRoot, "token.sha256");
  await writeFile(baselinePath, baselineText, "utf8");
  await persistSealedRecoveryToken({ token: sealedToken, outputPath: tokenPath, shaOutputPath: tokenShaPath });
  const verification = await verifySealedRecoveryToken({ tokenPath, tokenShaPath, outputPath: path.join(proofRoot, "evidence.json"), outputShaPath: path.join(proofRoot, "evidence.sha256"), verificationPath: path.join(proofRoot, "verification.json"), baselinePath, baselineSha256: createHash("sha256").update(baselineText).digest("hex"), approvedCommit: "a25d6e298375582674a730e3d589240c555a34f5" });
  assert.equal(verification.classification, "COMMITTED_EXACTLY", "local verifier accepts the database-produced token");
  console.log(JSON.stringify({ status: "PASS", mode: "LOCAL_DOCKER_ONLY", preflightChecks: preflightRows.length, postflightChecks: postflightRows.length, compactRecoveryBytes: Buffer.byteLength(`${JSON.stringify(recoveryPacket)}\n`), sealedTokenBytes: Buffer.byteLength(sealedToken, "ascii"), sealedPayloadBytes: sealed.declaredLength, scalarType, productionOperations: 0 }));
} finally {
  if (proofRoot) await rm(proofRoot, { recursive: true, force: true });
  if (started) spawnSync("docker", ["rm", "-f", container], { encoding: "utf8" });
}
