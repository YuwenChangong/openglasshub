import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { canonicalJson, createOAuthReadinessAttestation, readOAuthReadinessAttestation, sha256, writeOAuthReadinessAttestation } from "./qa/r6-oauth-readiness-attestation.mjs";
import { issueCurrentCanonicalProductionV3OAuthReadinessAttestation } from "./qa/run-cloudflare-pages-current-canonical-production-v3-preparation.mjs";

const root = await mkdtemp(path.join(os.tmpdir(), "r6-oauth-attestation-"));
const issuedAt = "2099-01-01T00:00:00.000Z";
const nonce = "a".repeat(64);
const session = "11111111-1111-4111-8111-111111111111";
const profile = { profilePath:path.join(root, "profile.toml"), profileFileSha256:"f".repeat(64), token:"secret-canary", hasRefreshCapability:true, expiresAt:"2099-01-01T01:00:00.000Z" };
const base = { executionCommit:"a".repeat(40), branch:"feature/r6-current-canonical-production-identity-v1", wrapperSha256:"b".repeat(64), wranglerVersion:"4.106.0", wranglerEntrySha256:"c".repeat(64), atomicSessionId:session, parentPowerShellPid:42, parentPowerShellStartTime:issuedAt, handoffNonce:nonce };

try {
  const attestation = createOAuthReadinessAttestation({ ...base, profile, now:() => new Date(issuedAt) });
  const file = path.join(root, "attestation.json");
  const envelope = await writeOAuthReadinessAttestation({ attestation, attestationPath:file, attestationRoot:root });
  const raw = await readFile(file, "utf8");
  assert.equal(raw.includes("secret-canary"), false);
  assert.equal(raw.includes(profile.profilePath), false);

  const verified = await readOAuthReadinessAttestation({ attestationPath:file, attestationRoot:root, expectedAttestationSha256:envelope.attestationSha256, atomicSessionId:session, parentPowerShellPid:42, parentPowerShellStartTime:issuedAt, handoffNonce:nonce, now:() => new Date("2099-01-01T00:00:59.000Z"), atomic:true });
  assert.equal(verified.ageSeconds, 59);
  const readAt = (seconds, overrides = {}) => readOAuthReadinessAttestation({ attestationPath:file, attestationRoot:root, expectedAttestationSha256:envelope.attestationSha256, atomicSessionId:session, parentPowerShellPid:42, parentPowerShellStartTime:issuedAt, handoffNonce:nonce, now:() => new Date(Date.parse(issuedAt) + (seconds * 1000)), atomic:true, ...overrides });
  await readAt(0); await readAt(59); await readAt(60);
  await assert.rejects(() => readAt(61), /R6_DRYRUN_OAUTH_ATTESTATION_FRESHNESS_INVALID/);
  await readOAuthReadinessAttestation({ attestationPath:file, attestationRoot:root, expectedAttestationSha256:envelope.attestationSha256, atomicSessionId:session, parentPowerShellPid:42, parentPowerShellStartTime:issuedAt, handoffNonce:nonce, now:() => new Date(Date.parse(issuedAt) + 180000), atomic:false });
  await assert.rejects(() => readOAuthReadinessAttestation({ attestationPath:file, attestationRoot:root, expectedAttestationSha256:envelope.attestationSha256, atomicSessionId:session, parentPowerShellPid:42, parentPowerShellStartTime:issuedAt, handoffNonce:nonce, now:() => new Date(Date.parse(issuedAt) + 181000), atomic:false }), /R6_DRYRUN_OAUTH_ATTESTATION_FRESHNESS_INVALID/);
  await assert.rejects(() => readOAuthReadinessAttestation({ attestationPath:file, attestationRoot:root, expectedAttestationSha256:envelope.attestationSha256, atomicSessionId:"22222222-2222-4222-8222-222222222222", parentPowerShellPid:42, parentPowerShellStartTime:issuedAt, handoffNonce:nonce, now:() => new Date(issuedAt), atomic:true }), /R6_DRYRUN_OAUTH_ATTESTATION_HANDOFF_INVALID/);
  await assert.rejects(() => readOAuthReadinessAttestation({ attestationPath:file, attestationRoot:root, expectedAttestationSha256:envelope.attestationSha256, atomicSessionId:session, parentPowerShellPid:43, parentPowerShellStartTime:issuedAt, handoffNonce:nonce, now:() => new Date(issuedAt), atomic:true }), /R6_DRYRUN_OAUTH_ATTESTATION_HANDOFF_INVALID/);
  await assert.rejects(() => readOAuthReadinessAttestation({ attestationPath:file, attestationRoot:root, expectedAttestationSha256:envelope.attestationSha256, atomicSessionId:session, parentPowerShellPid:42, parentPowerShellStartTime:"2099-01-01T00:00:01.000Z", handoffNonce:nonce, now:() => new Date(issuedAt), atomic:true }), /R6_DRYRUN_OAUTH_ATTESTATION_HANDOFF_INVALID/);
  await assert.rejects(() => readOAuthReadinessAttestation({ attestationPath:file, attestationRoot:root, expectedAttestationSha256:envelope.attestationSha256, atomicSessionId:session, parentPowerShellPid:42, parentPowerShellStartTime:issuedAt, handoffNonce:"b".repeat(64), now:() => new Date(issuedAt), atomic:true }), /R6_DRYRUN_OAUTH_ATTESTATION_HANDOFF_INVALID/);
  await assert.rejects(() => readOAuthReadinessAttestation({ attestationPath:file, attestationRoot:root, expectedAttestationSha256:"0".repeat(64), atomicSessionId:session, parentPowerShellPid:42, parentPowerShellStartTime:issuedAt, handoffNonce:nonce, now:() => new Date(issuedAt), atomic:true }), /R6_DRYRUN_OAUTH_ATTESTATION_SHA_INVALID/);

  const malformed = { ...attestation }; delete malformed.scopeState;
  const malformedRaw = canonicalJson(malformed);
  await import("node:fs/promises").then(({ writeFile }) => writeFile(file, malformedRaw));
  await assert.rejects(() => readOAuthReadinessAttestation({ attestationPath:file, attestationRoot:root, expectedAttestationSha256:sha256(malformedRaw), atomicSessionId:session, parentPowerShellPid:42, parentPowerShellStartTime:issuedAt, handoffNonce:nonce, now:() => new Date(issuedAt), atomic:true }), /R6_OAUTH_READINESS_ATTESTATION_INVALID/);
  await import("node:fs/promises").then(({ writeFile }) => writeFile(file, raw));

  const produced = await issueCurrentCanonicalProductionV3OAuthReadinessAttestation({ ...base, attestationPath:path.join(root, "runner.json"), attestationRoot:root, oauthProfileValidator:async () => profile, now:() => new Date(issuedAt) });
  assert.equal(produced.attestationSchema, "r6-current-canonical-production-v3-oauth-readiness-attestation-v1");
  assert.equal(profile.token, null);
  await assert.rejects(
    () => issueCurrentCanonicalProductionV3OAuthReadinessAttestation({ ...base, attestationPath:path.join(root, "not-ready.json"), oauthProfileValidator:async () => { throw Object.assign(new Error("x"), { code:"R6_OAUTH_PROFILE_REFRESH_REQUIRED" }); } }),
    (error) => error?.code === "R6_OAUTH_PROFILE_REFRESH_REQUIRED",
  );
  await assert.rejects(() => access(path.join(root, "not-ready.json")));

  const cleanupPath = path.join(root, "cleanup-failure.json");
  const cleanupFailureProfile = { profilePath:path.join(root, "cleanup-profile.toml"), profileFileSha256:"e".repeat(64), hasRefreshCapability:true, expiresAt:"2099-01-01T01:00:00.000Z" };
  Object.defineProperty(cleanupFailureProfile, "token", { enumerable:true, get:() => "secret-canary", set:() => { throw new Error("cleanup failure"); } });
  await assert.rejects(() => issueCurrentCanonicalProductionV3OAuthReadinessAttestation({ ...base, attestationPath:cleanupPath, attestationRoot:root, oauthProfileValidator:async () => cleanupFailureProfile, now:() => new Date(issuedAt) }), /R6_OAUTH_READINESS_ATTESTATION_CLEANUP_FAILED/);
  await assert.rejects(() => access(cleanupPath));
  console.log("R6_OAUTH_READINESS_ATTESTATION_FIXTURES_OK");
} finally { await rm(root,{recursive:true,force:true}); }
