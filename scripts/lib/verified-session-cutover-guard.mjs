const OLD_COMMIT = "e6c2141be8827d961fc49462d66be8da9b4993eb";
const COMMIT = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const IDENTITY_FIELDS = ["sourceCommit", "buildSha256", "environmentSha256", "configurationSha256"];

function validIdentity(identity, observed = false) {
  if (!identity || Object.getPrototypeOf(identity) !== Object.prototype) return false;
  const keys = Object.keys(identity).sort();
  const expected = observed ? [...IDENTITY_FIELDS, "provenance"].sort() : [...IDENTITY_FIELDS].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expected)) return false;
  if (observed && identity.provenance !== "observed-build") return false;
  return COMMIT.test(identity.sourceCommit)
    && [identity.buildSha256, identity.environmentSha256, identity.configurationSha256]
      .every((digest) => typeof digest === "string" && SHA256.test(digest));
}

function matches(actual, locked) {
  return IDENTITY_FIELDS.every((field) => actual[field] === locked[field]);
}

export function assertWorkerDbPairing(input) {
  const deny = () => { throw new Error("PAIRING_GUARD_DENY"); };
  if (!input || Object.getPrototypeOf(input) !== Object.prototype) deny();
  const { workerIdentity, dbStage, locks } = input;
  if (!locks || Object.getPrototypeOf(locks) !== Object.prototype
    || JSON.stringify(Object.keys(locks).sort()) !== JSON.stringify(["next", "old", "reviewedNew"])) deny();
  if (!validIdentity(locks.old) || !validIdentity(locks.next, false) || !validIdentity(locks.reviewedNew)
    || locks.old.sourceCommit !== OLD_COMMIT || locks.next.sourceCommit === OLD_COMMIT
    || !matches(locks.next, locks.reviewedNew)
    || !validIdentity(workerIdentity, true)) deny();
  const old = matches(workerIdentity, locks.old);
  const next = matches(workerIdentity, locks.next);
  if (old === next) deny();
  if (old && dbStage === "PRE_V1") return "A";
  if (old && dbStage === "FOUNDATION") return "B";
  if (next && dbStage === "FOUNDATION") return "C";
  if (next && dbStage === "ENFORCEMENT") return "D";
  return deny();
}

export function assertCanEnterStateC(evidence) {
  const deny = () => { throw new Error("STATE_C_ENTRY_DENIED"); };
  if (!evidence || Object.getPrototypeOf(evidence) !== Object.prototype) deny();
  try {
    if (assertWorkerDbPairing({ workerIdentity: evidence.workerIdentity,
      dbStage: evidence.dbStage, locks: evidence.locks }) !== "C") deny();
  } catch { deny(); }
  if (!validIdentity(evidence.oldRollbackIdentity, true)
    || !matches(evidence.oldRollbackIdentity, evidence.locks.old)) deny();
  const { artifacts, matrix, enforcementPreflight, cSmokePlan, authDPacket, sourceLock, window } = evidence;
  if (!artifacts || ![artifacts.foundationSha256, artifacts.enforcementSha256,
    artifacts.reviewedEnforcementSha256, artifacts.cSmokePlanSha256, artifacts.authDPacketSha256]
    .every((value) => typeof value === "string" && SHA256.test(value))
    || artifacts.enforcementSha256 !== artifacts.reviewedEnforcementSha256) deny();
  if (!matrix || !["A", "B", "C", "D"].every((state) => matrix[state]?.status === "PASS")
    || matrix.A.sourceCommit !== evidence.locks.old.sourceCommit
    || matrix.B.sourceCommit !== evidence.locks.old.sourceCommit
    || matrix.C.sourceCommit !== evidence.locks.next.sourceCommit
    || matrix.D.sourceCommit !== evidence.locks.next.sourceCommit
    || matrix.A.workerBuildSha256 !== evidence.locks.old.buildSha256
    || matrix.B.workerBuildSha256 !== evidence.locks.old.buildSha256
    || matrix.B.foundationSha256 !== artifacts.foundationSha256
    || matrix.C.foundationSha256 !== artifacts.foundationSha256
    || matrix.D.foundationSha256 !== artifacts.foundationSha256
    || matrix.C.workerBuildSha256 !== evidence.locks.next.buildSha256
    || matrix.D.workerBuildSha256 !== evidence.locks.next.buildSha256
    || matrix.D.enforcementSha256 !== artifacts.enforcementSha256) deny();
  if (enforcementPreflight?.status !== "PASS"
    || enforcementPreflight.artifactSha256 !== artifacts.enforcementSha256
    || cSmokePlan?.reviewed !== true || cSmokePlan.sha256 !== artifacts.cSmokePlanSha256
    || authDPacket?.prepared !== true || authDPacket.executionStatus !== "NOT_EXECUTED"
    || authDPacket.sha256 !== artifacts.authDPacketSha256
    || sourceLock?.sourceCommit !== evidence.locks.next.sourceCommit
    || sourceLock.buildSha256 !== evidence.locks.next.buildSha256) deny();
  const utc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  const parsed = (value) => typeof value === "string" && utc.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
    ? Date.parse(value) : NaN;
  const start = parsed(window?.startedAtUtc);
  const deadline = parsed(window?.deadlineAtUtc);
  const now = parsed(evidence.nowUtc);
  if (typeof window?.id !== "string" || !/^[a-z0-9][a-z0-9-]{3,63}$/.test(window.id)
    || !Number.isFinite(start) || !Number.isFinite(deadline) || !Number.isFinite(now)
    || deadline - start > 60 * 60 * 1000 || deadline <= start || now < start || now > deadline) deny();
  return "STATE_C_ENTRY_ELIGIBLE";
}
