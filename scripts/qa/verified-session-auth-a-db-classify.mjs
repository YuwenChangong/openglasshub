import { normalizeCatalogCapture } from "../lib/verified-session-catalog-contract.mjs";
import { catalogDigest, classifyVerifiedSessionDbStage } from "../lib/verified-session-db-stage.mjs";
import { REVIEWED_LOCAL_STAGE_DIGESTS } from "../lib/verified-session-stage-digests.mjs";

const IDS = [...Array.from({ length: 11 }, (_, index) => `CATALOG_${String(index + 1).padStart(2, "0")}`), "HISTORY_01"];
const HISTORY_FIELDS = ["version", "name", "created_by", "idempotency_key",
  "statement_count", "rollback_statement_count"];
const TARGETS = [
  ["oldMonolithApplied", "20260923000000", "ogh_verified_session_v1"],
  ["oldResendLockApplied", "20260925012231", "lock_verification_email_resend_limit"],
  ["newFoundationApplied", "20260923000000", "ogh_verified_session_v1_foundation"],
  ["newEnforcementApplied", "20260925012231", "ogh_verified_session_v1_enforcement"],
];

export function classifyAuthADatabase(capture) {
  const unknown = { dbStage: "UNKNOWN", migrationProvenance: "UNKNOWN",
    oldMonolithApplied: "UNKNOWN", oldResendLockApplied: "UNKNOWN",
    newFoundationApplied: "UNKNOWN", newEnforcementApplied: "UNKNOWN",
    v1PrivateTableCount: "UNKNOWN", v1FunctionCount: "UNKNOWN",
    v1RestrictivePolicyCount: "UNKNOWN", resendEffectiveAcl: "UNKNOWN",
    catalogPass: false, catalogDrift: "UNKNOWN" };
  if (capture?.transportProof?.status !== "PASS" || !Array.isArray(capture.queryResults)
    || capture.queryResults.length !== IDS.length
    || capture.queryResults.some((entry, index) => entry?.queryId !== IDS[index]
      || entry.completed !== true || !Array.isArray(entry.fields) || !Array.isArray(entry.rows)
      || entry.rowCount !== entry.rows.length)) return unknown;

  const history = capture.queryResults[11];
  if (JSON.stringify(history.fields) !== JSON.stringify(HISTORY_FIELDS)) return unknown;
  const identities = new Set();
  for (const row of history.rows) {
    if (!row || !/^\d{8,14}$/.test(row.version ?? "")
      || typeof row.name !== "string" || !/^[a-z0-9_]+(?:\.sql)?$/.test(row.name)
      || typeof row.created_by !== "string" || typeof row.idempotency_key !== "string"
      || !/^(?:|\d+)$/.test(row.statement_count ?? "")
      || !/^(?:|\d+)$/.test(row.rollback_statement_count ?? "")) return unknown;
    const identity = `${row.version}/${row.name.replace(/\.sql$/, "")}`;
    if (identities.has(identity)) return unknown;
    identities.add(identity);
  }
  const facts = Object.fromEntries(TARGETS.map(([key, version, name]) =>
    [key, identities.has(`${version}/${name}`)]));
  const collision = history.rows.some((row) => TARGETS.some(([, version, name]) =>
    row.version === version && row.name.replace(/\.sql$/, "") !== name
    && !TARGETS.some(([, targetVersion, targetName]) => targetVersion === version
      && targetName === row.name.replace(/\.sql$/, ""))));

  let snapshot;
  try { snapshot = normalizeCatalogCapture(capture.queryResults.slice(0, 11)); }
  catch { return { ...unknown, ...facts, migrationProvenance: "UNKNOWN" }; }
  const dbStage = classifyVerifiedSessionDbStage(snapshot, REVIEWED_LOCAL_STAGE_DIGESTS);
  const catalogPass = dbStage !== "UNKNOWN";
  const migrationProvenance = collision || Object.values(facts).some(Boolean) ? "DIVERGENT"
    : dbStage === "PRE_V1" ? "CLEAN_UNSHIPPED_V1" : "UNKNOWN";
  const resend = snapshot.functions.find((row) => row.proname === "consume_verification_email_resend_limit");
  return { ...facts, dbStage, migrationProvenance,
    v1PrivateTableCount: snapshot.tables.length,
    v1FunctionCount: snapshot.functions.filter((row) => row.proname.startsWith("ogh_")).length,
    v1RestrictivePolicyCount: snapshot.policies.filter((row) => row.policyname.startsWith("ogh_verified_")
      && row.permissive === "RESTRICTIVE").length,
    resendEffectiveAcl: resend ? { anon: resend.anon_execute, authenticated: resend.authenticated_execute,
      service: resend.service_execute } : "UNKNOWN",
    catalogPass, catalogDrift: catalogPass ? "none" : "UNKNOWN",
    catalogSha256: catalogDigest(snapshot) };
}
