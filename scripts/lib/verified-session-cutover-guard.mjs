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
