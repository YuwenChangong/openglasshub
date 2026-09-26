import { createHash } from "node:crypto";

const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SHA256 = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SHA = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fail = () => { throw new Error("C_WINDOW_REENTRY_DENIED"); };

function instant(value) {
  if (typeof value !== "string" || !UTC.test(value)) return NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : NaN;
}

function validWindow(window) {
  if (!window || typeof window.id !== "string" || !/^[a-z0-9][a-z0-9-]{3,63}$/.test(window.id)) return false;
  const start = instant(window.startedAtUtc);
  const deadline = instant(window.deadlineAtUtc);
  const end = instant(window.endedAtUtc);
  return Number.isFinite(start) && Number.isFinite(deadline) && Number.isFinite(end)
    && start <= end && end <= deadline && deadline - start <= 60 * 60 * 1000;
}

export function classifyCWindowIntegrity(evidence) {
  if (!validWindow(evidence?.window)) return "UNKNOWN";
  if (evidence.cause === "PUBLIC_READ_UI_ONLY") {
    const proof = evidence.verificationProof;
    return proof?.windowId === evidence.window.id && SHA256.test(proof.evidenceSha256 ?? "")
      && [proof.challenge, proof.activation, proof.signedMapping, proof.bypass].every((value) => value === "PASS")
      ? "PROVEN" : "SUSPECT";
  }
  if (["CHALLENGE_FAILURE", "ACTIVATION_FAILURE", "SIGNED_MAPPING_FAILURE", "BYPASS_FAILURE"]
    .includes(evidence.cause)) return "SUSPECT";
  return "UNKNOWN";
}

export function classifyStateCExit({ window, nowUtc, dbStage, dProof, rollbackBReady } = {}) {
  if (!validWindow(window)) return "BLOCKED";
  const now = instant(nowUtc);
  if (!Number.isFinite(now) || now < instant(window.startedAtUtc)) return "BLOCKED";
  if (dbStage === "ENFORCEMENT" && dProof === "PASS")
    return now <= instant(window.deadlineAtUtc) ? "ADVANCE_D" : "BLOCKED";
  if (dbStage === "FOUNDATION" && rollbackBReady === true) return "ROLLBACK_B";
  return "BLOCKED";
}

export function assertSafeToReenter(evidence) {
  const classification = classifyCWindowIntegrity(evidence);
  if (classification === "PROVEN") return "PROVEN";
  if (classification !== "SUSPECT") fail();
  const { window, inventory, validRowProofs, revocationReceipt } = evidence;
  if (!inventory || inventory.windowId !== window.id || !Array.isArray(inventory.rows)
    || !SHA256.test(inventory.sha256) || SHA(inventory.rows) !== inventory.sha256
    || !Array.isArray(validRowProofs) || !revocationReceipt) fail();
  const ids = new Set();
  for (const row of inventory.rows) {
    const at = instant(row?.verifiedAtUtc);
    if (!UUID.test(row?.sessionId ?? "") || ids.has(row.sessionId)
      || !Number.isFinite(at) || at < instant(window.startedAtUtc)
      || at >= instant(window.endedAtUtc)) fail();
    ids.add(row.sessionId);
  }
  const proved = new Set();
  for (const proof of validRowProofs) {
    if (!ids.has(proof?.sessionId) || proved.has(proof.sessionId)
      || !SHA256.test(proof.evidenceSha256 ?? "")
      || proof.source !== "provider-session-proof" || proof.reviewed !== true) fail();
    proved.add(proof.sessionId);
  }
  if (typeof revocationReceipt.authorizationId !== "string" || !revocationReceipt.authorizationId.trim()
    || revocationReceipt.windowId !== window.id || revocationReceipt.inventorySha256 !== inventory.sha256
    || !SHA256.test(revocationReceipt.authorizationSha256 ?? "")
    || !Array.isArray(revocationReceipt.revokedSessionIds)) fail();
  const revoked = new Set(revocationReceipt.revokedSessionIds);
  if (revoked.size !== revocationReceipt.revokedSessionIds.length) fail();
  if (revocationReceipt.authorizedSessionIdsSha256 !== SHA(revocationReceipt.revokedSessionIds)
    || revocationReceipt.maxRows !== revoked.size || revocationReceipt.maxAttempts !== 1
    || revocationReceipt.executionResult !== "COMMITTED") fail();
  for (const id of revoked) if (!ids.has(id) || proved.has(id)) fail();
  for (const id of ids) if (!proved.has(id) && !revoked.has(id)) fail();
  const post = revocationReceipt.postcondition;
  if (!post || post.windowId !== window.id || post.queryTemplateId !== "C_WINDOW_AFFECTED_ROWS_V1"
    || typeof post.separateReadAuthorizationId !== "string" || !post.separateReadAuthorizationId.trim()
    || !SHA256.test(post.separateReadAuthorizationSha256 ?? "")
    || !Number.isFinite(instant(post.observedAtUtc))
    || instant(post.observedAtUtc) < instant(window.endedAtUtc)
    || !Array.isArray(post.unrevokedRows) || !Array.isArray(post.revokedRows)
    || !SHA256.test(post.sha256 ?? "")
    || SHA({ unrevokedRows: post.unrevokedRows, revokedRows: post.revokedRows }) !== post.sha256) fail();
  const remaining = new Set();
  for (const row of post.unrevokedRows) {
    if (!proved.has(row?.sessionId) || remaining.has(row.sessionId)
      || !inventory.rows.some((original) => original.sessionId === row.sessionId
        && original.verifiedAtUtc === row.verifiedAtUtc)) fail();
    remaining.add(row.sessionId);
  }
  if (remaining.size !== proved.size) fail();
  const observedRevoked = new Set();
  for (const row of post.revokedRows) {
    const original = inventory.rows.find((item) => item.sessionId === row?.sessionId);
    const revokedAt = instant(row?.revokedAtUtc);
    if (!revoked.has(row?.sessionId) || observedRevoked.has(row.sessionId)
      || !original || original.verifiedAtUtc !== row.verifiedAtUtc
      || !Number.isFinite(revokedAt) || revokedAt < instant(row.verifiedAtUtc)
      || revokedAt > instant(post.observedAtUtc)) fail();
    observedRevoked.add(row.sessionId);
  }
  if (observedRevoked.size !== revoked.size) fail();
  return "SUSPECT_C_WINDOW_ROWS_REVOKED";
}
