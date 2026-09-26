const SHA256 = /^[a-f0-9]{64}$/;
const HEAD = /^[a-f0-9]{40}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const PINNED_OLD_SOURCE = "e6c2141be8827d961fc49462d66be8da9b4993eb";
const fail = (code) => { throw new Error(`AUTH_A_ORCHESTRATOR_${code}`); };

export async function runAuthAOrchestrator({ mode = "LOCAL_TEST", authorization,
  sourceHead, observedHead, packetSha256, observedPacketSha256, worktreeClean,
  pinnedWorkerArtifact, steps } = {}) {
  if (authorization?.AUTH_A_EXECUTE !== "1"
    || !/^auth-a-verified-session-[0-9]+$/.test(authorization?.AUTHORIZATION_ID ?? "")
    || authorization.AUTHORIZATION_ID === "auth-a-verified-session-001"
    || !UTC.test(authorization.AUTHORIZED_AT_UTC ?? "")
    || Number.isNaN(Date.parse(authorization.AUTHORIZED_AT_UTC))
    || !HEAD.test(sourceHead ?? "") || sourceHead !== observedHead
    || !SHA256.test(packetSha256 ?? "") || packetSha256 !== observedPacketSha256
    || authorization.SOURCE_HEAD !== sourceHead
    || authorization.PACKET_SHA256 !== packetSha256
    || worktreeClean !== true) fail("AUTHORIZATION_OR_SOURCE_INVALID");

  // No hosted dispatch until Production client authorization is independently reviewed.
  if (mode !== "LOCAL_TEST") fail("PRODUCTION_DISABLED");
  if (!steps || ["cloudflare", "supabase", "brevo", "database"]
    .some((name) => typeof steps[name] !== "function")) fail("STEPS_INVALID");

  try {
    const cf = await steps.cloudflare();
    if (cf.requestCount !== 2 || cf.workerName !== "openglasshub"
      || !SHA256.test(cf.artifactSha256 ?? "") || !SHA256.test(cf.configSha256 ?? "")
      || !pinnedWorkerArtifact || pinnedWorkerArtifact.sourceCommit !== PINNED_OLD_SOURCE
      || !SHA256.test(pinnedWorkerArtifact.artifactSha256 ?? "")
      || !SHA256.test(pinnedWorkerArtifact.configSha256 ?? "")
      || cf.artifactSha256 !== pinnedWorkerArtifact.artifactSha256
      || cf.configSha256 !== pinnedWorkerArtifact.configSha256) fail("WORKER_ARTIFACT_MISMATCH");
    const sb = await steps.supabase();
    if (sb.requestCount !== 2) fail("SUPABASE_UNKNOWN");
    const br = await steps.brevo();
    if (br.requestCount !== 2 || br.plan !== "FREE" || br.senderReady !== true)
      fail("BREVO_UNKNOWN");
    if (sb.projectRef !== "xcbnxzjlsvtgzixurcof" || sb.targetMatch !== true
      || sb.projectStatus !== "ACTIVE_HEALTHY" || sb.freePlan !== true) fail("TARGET_UNKNOWN");
    const db = await steps.database();
    const proof = db?.transportProof;
    if (proof?.status !== "PASS" || proof.connectionAttempts !== 1 || proof.psqlProcessCount !== 1
      || proof.queryCount !== 12 || proof.transactionReadOnly !== true || proof.sameBackend !== true
      || proof.rollbackMode !== "EXPLICIT_ROLLBACK") fail("DATABASE_UNKNOWN");
    const classified = classifyAuthADatabase(db);
    const inventoryPass = classified?.dbStage === "PRE_V1"
      && classified.migrationProvenance === "CLEAN_UNSHIPPED_V1"
      && classified.catalogPass === true
      && classified.v1PrivateTableCount === 0
      && classified.v1FunctionCount === 0
      && classified.v1RestrictivePolicyCount === 0;
    return Object.freeze({ authAStatus: inventoryPass ? "PASS" : "BLOCKED",
      authReleaseStatus: "NO_GO", projectRef: sb.projectRef,
      deployedWorkerIdentityMatch: true,
      deployedWorkerSourceEquivalence: "PROVEN_BY_EXACT_ARTIFACT",
      freeCapacityStatus: "UNKNOWN", capacityGate: "BLOCKED_BEFORE_AUTH_B",
      nextAction: inventoryPass ? "REQUEST_SEPARATE_CAPACITY_REVIEW" : "STOP_FOR_REVIEW",
      cloudflareReadRequests: 2, supabaseReadRequests: 2, brevoReadRequests: 2,
      databaseConnectionAttempts: 1, productionWrites: 0, emailSends: 0, deploys: 0 });
  } catch {
    return Object.freeze({ authAStatus: "BLOCKED", authReleaseStatus: "NO_GO",
      deployedWorkerIdentityMatch: false, freeCapacityStatus: "UNKNOWN",
      capacityGate: "BLOCKED_BEFORE_AUTH_B", nextAction: "STOP_FOR_REVIEW",
      productionWrites: 0, emailSends: 0, deploys: 0 });
  }
}
import { classifyAuthADatabase } from "./verified-session-auth-a-db-classify.mjs";
