import { EXPECTED_OLD_WORKER } from "../lib/verified-session-old-worker-baseline.mjs";
import { claimAuthAProductionAttempt, getAuthAProductionAttempt } from
  "../lib/verified-session-auth-a-production-gate.mjs";
import { classifyAuthADatabase } from "./verified-session-auth-a-db-classify.mjs";

const SHA256 = /^[a-f0-9]{64}$/;
const HEAD = /^[a-f0-9]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const DB_FAILURE_STAGES = new Set(["PSQL_EXECUTION", "PROCESS", "RESULT_PARSING", "SESSION_PROOF"]);
const DB_FAILURE_CLASSES = new Set(["AUTHENTICATION_FAILED", "DNS_FAILURE", "SSL_FAILURE",
  "SERVER_CONNECTION_LOST", "NETWORK_UNREACHABLE", "TRANSPORT_UNKNOWN_CONNECTION_FAILURE",
  "P9_PSQL_PROCESS_FAILURE", "P9_RESULT_PRESERVATION_FAILURE", "P9_RESULT_CSV_INVALID",
  "P9_SESSION_PROOF_FAILURE"]);
const P9_ERROR_STAGES = new Map([
  ["P9_PSQL_PROCESS_FAILURE", "PROCESS"],
  ["P9_RESULT_PRESERVATION_FAILURE", "RESULT_PARSING"],
  ["P9_RESULT_CSV_INVALID", "RESULT_PARSING"],
  ["P9_SESSION_PROOF_FAILURE", "SESSION_PROOF"],
]);
const safeQueryId = (value) => value === "SESSION" || value === "SESSION_FINAL"
  || value === "HISTORY_01" || /^CATALOG_(?:0[1-9]|1[01])$/.test(value ?? "")
  ? value : value == null ? "NONE" : "UNKNOWN";
const fail = (code) => { throw new Error(`AUTH_A_ORCHESTRATOR_${code}`); };

function requireDispatchCounts(mode, capability, expected) {
  if (mode !== "PRODUCTION") return;
  const actual = getAuthAProductionAttempt(capability).counts;
  if (Object.keys(expected).some((provider) => actual[provider] !== expected[provider]))
    fail("DISPATCH_PROOF_INVALID");
}

export async function runAuthAOrchestrator({ mode = "LOCAL_TEST", authorization,
  sourceHead, observedHead, packetSha256, observedPacketSha256, worktreeClean, branch,
  capability, steps } = {}) {
  if (authorization?.AUTH_A_EXECUTE !== "1"
    || !/^auth-a-verified-session-[0-9]+$/.test(authorization?.AUTHORIZATION_ID ?? "")
    || ["auth-a-verified-session-001", "auth-a-verified-session-002"].includes(authorization.AUTHORIZATION_ID)
    || !UTC.test(authorization.AUTHORIZED_AT_UTC ?? "")
    || Number.isNaN(Date.parse(authorization.AUTHORIZED_AT_UTC))
    || !HEAD.test(sourceHead ?? "") || sourceHead !== observedHead
    || !SHA256.test(packetSha256 ?? "") || packetSha256 !== observedPacketSha256
    || authorization.SOURCE_HEAD !== sourceHead
    || authorization.PACKET_SHA256 !== packetSha256
    || worktreeClean !== true) fail("AUTHORIZATION_OR_SOURCE_INVALID");

  if (mode !== "LOCAL_TEST" && mode !== "PRODUCTION") fail("MODE_INVALID");
  if (!steps || ["cloudflare", "supabase", "brevo", "database"]
    .some((name) => typeof steps[name] !== "function")) fail("STEPS_INVALID");
  if (mode === "PRODUCTION") claimAuthAProductionAttempt(capability,
    { authorization, observedHead, observedPacketSha256, branch, worktreeClean });

  const observed = { targetWorker: "UNKNOWN", targetSupabase: "UNKNOWN", targetMatch: "UNKNOWN",
    deployedWorkerIdentity: "UNKNOWN", deployedWorkerIdentityMatch: false,
    deployedWorkerIdentityDrift: "UNKNOWN", deployedWorkerSourceEquivalence: "UNKNOWN",
    dbStage: "UNKNOWN", migrationProvenance: "UNKNOWN",
    oldMonolithApplied: "UNKNOWN", oldResendLockApplied: "UNKNOWN",
    newFoundationApplied: "UNKNOWN", newEnforcementApplied: "UNKNOWN",
    v1PrivateTableCount: "UNKNOWN", v1FunctionCount: "UNKNOWN",
    v1RestrictivePolicyCount: "UNKNOWN", resendEffectiveAcl: "UNKNOWN",
    catalogPreflightStatus: "UNKNOWN", catalogDrift: "UNKNOWN",
    dbFailureStage: "UNKNOWN", dbFailureClass: "UNKNOWN", dbFailureQueryId: "UNKNOWN" };
  let stage = "CLOUDFLARE";
  let dbFailureObserved = false;
  try {
    const cf = await steps.cloudflare();
    requireDispatchCounts(mode, capability, { cloudflare: 2, supabase: 0, brevo: 0, database: 0 });
    if (cf?.requestCount !== 2 || cf?.workerName !== EXPECTED_OLD_WORKER.workerName
      || !UUID.test(cf?.activeVersionId ?? "") || !UUID.test(cf?.versionId ?? ""))
      fail("WORKER_IDENTITY_UNKNOWN");
    observed.deployedWorkerIdentity = cf.activeVersionId;
    if (cf.activeVersionId !== EXPECTED_OLD_WORKER.versionId
      || cf.versionId !== cf.activeVersionId) fail("WORKER_VERSION_DRIFT");
    Object.assign(observed, { targetWorker: EXPECTED_OLD_WORKER.workerName,
      deployedWorkerIdentityMatch: true, deployedWorkerIdentityDrift: false,
      deployedWorkerSourceEquivalence: "PROVEN_BY_HISTORICAL_VERSION_BINDING" });
    stage = "SUPABASE";
    const sb = await steps.supabase();
    requireDispatchCounts(mode, capability, { cloudflare: 2, supabase: 2, brevo: 0, database: 0 });
    if (sb.requestCount !== 2) fail("SUPABASE_UNKNOWN");
    if (sb.projectRef !== "xcbnxzjlsvtgzixurcof" || sb.targetMatch !== true
      || sb.projectStatus !== "ACTIVE_HEALTHY" || sb.freePlan !== true) {
      observed.targetMatch = false;
      fail("TARGET_UNKNOWN");
    }
    observed.targetSupabase = sb.projectRef;
    observed.targetMatch = true;
    stage = "BREVO";
    const br = await steps.brevo();
    requireDispatchCounts(mode, capability, { cloudflare: 2, supabase: 2, brevo: 2, database: 0 });
    if (br.requestCount !== 2 || br.plan !== "FREE" || br.senderReady !== true
      || br.capacitySufficient !== true)
      fail("BREVO_UNKNOWN");
    stage = "DATABASE";
    const db = await steps.database();
    requireDispatchCounts(mode, capability, { cloudflare: 2, supabase: 2, brevo: 2, database: 1 });
    const proof = db?.transportProof;
    if (proof?.status === "BLOCKED") {
      dbFailureObserved = true;
      observed.dbFailureStage = DB_FAILURE_STAGES.has(proof.firstFailureStage)
        ? proof.firstFailureStage : "UNKNOWN";
      observed.dbFailureClass = DB_FAILURE_CLASSES.has(proof.failureClass)
        ? proof.failureClass : "UNKNOWN";
      observed.dbFailureQueryId = safeQueryId(proof.firstFailureQueryId);
    }
    if (proof?.status !== "PASS" || (mode === "PRODUCTION" && proof.targetClass !== "PRODUCTION")
      || proof.connectionAttempts !== 1 || proof.psqlProcessCount !== 1
      || proof.queryCount !== 12 || proof.transactionReadOnly !== true || proof.sameBackend !== true
      || proof.rollbackMode !== "EXPLICIT_ROLLBACK") fail("DATABASE_UNKNOWN");
    Object.assign(observed, { dbFailureStage: "NONE", dbFailureClass: "NONE", dbFailureQueryId: "NONE" });
    const classified = classifyAuthADatabase(db);
    Object.assign(observed, { ...classified,
      catalogPreflightStatus: classified.catalogPass ? "PASS" : "FAIL" });
    const inventoryPass = classified?.dbStage === "PRE_V1"
      && classified.migrationProvenance === "CLEAN_UNSHIPPED_V1"
      && classified.catalogPass === true
      && classified.v1PrivateTableCount === 0
      && classified.v1FunctionCount === 0
      && classified.v1RestrictivePolicyCount === 0;
    return Object.freeze({ ...observed, authAStatus: inventoryPass ? "PASS" : "BLOCKED",
      authReleaseStatus: "NO_GO", projectRef: sb.projectRef,
      expectedSourceCommit: EXPECTED_OLD_WORKER.sourceCommit,
      workerIdentityProvenance: EXPECTED_OLD_WORKER.provenance,
      freeCapacityStatus: "UNKNOWN", capacityGate: "BLOCKED_BEFORE_AUTH_B",
      nextAction: inventoryPass ? "REQUEST_SEPARATE_CAPACITY_REVIEW" : "STOP_FOR_REVIEW",
      blockerClass: inventoryPass ? "NONE" : "DATABASE_INVENTORY_BLOCKED",
      cloudflareReadRequests: 2, supabaseReadRequests: 2, brevoReadRequests: 2,
      databaseConnectionAttempts: 1, productionWrites: 0, emailSends: 0, deploys: 0 });
  } catch (error) {
    if (stage === "DATABASE" && !dbFailureObserved && P9_ERROR_STAGES.has(error?.code)) {
      observed.dbFailureStage = P9_ERROR_STAGES.get(error.code);
      observed.dbFailureClass = error.code;
    }
    const versionDrift = ["AUTH_A_CF_VERSION_DRIFT", "AUTH_A_ORCHESTRATOR_WORKER_VERSION_DRIFT"]
      .includes(error?.message);
    return Object.freeze({ ...observed, authAStatus: "BLOCKED", authReleaseStatus: "NO_GO",
      deployedWorkerIdentityMatch: versionDrift ? false : observed.deployedWorkerIdentityMatch,
      deployedWorkerIdentityDrift: versionDrift ? true : observed.deployedWorkerIdentityDrift,
      freeCapacityStatus: "UNKNOWN",
      capacityGate: "BLOCKED_BEFORE_AUTH_B", nextAction: "STOP_FOR_REVIEW",
      blockerClass: versionDrift ? "WORKER_VERSION_DRIFT" : `${stage}_BLOCKED`,
      productionWrites: 0, emailSends: 0, deploys: 0 });
  }
}
