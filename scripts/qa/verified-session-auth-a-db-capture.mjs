import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { assertAuthAProductionCapability, markAuthAExternalDispatch } from
  "../lib/verified-session-auth-a-production-gate.mjs";
import { P9_EXPECTED_PROJECT_REF, parseP9Connection, loadReadOnlyPacketUnits,
  runP9ReadOnlyCapture } from "./p9-readonly-postgres-transport.mjs";

export const AUTH_A_CATALOG_SHA256 = "b033239a1b7bc689e9ad5be1409a19363eaba2c7a8c6eddb791bcabc9cf6bfc7";
export const AUTH_A_HISTORY_SHA256 = "6018ce149a1520c7c097e2577281ace773a2329cc8f36ca74350fd03be347002";
const CATALOG_IDS = Array.from({ length: 11 }, (_, index) => `CATALOG_${String(index + 1).padStart(2, "0")}`);
const HISTORY_IDS = ["HISTORY_01"];
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const deny = (reason) => { throw new Error(`AUTH_A_DB_PACKET_${reason}`); };

export function prepareAuthADbPacket({ catalog, history } = {}) {
  if (typeof catalog !== "string" || sha256(catalog) !== AUTH_A_CATALOG_SHA256) deny("CATALOG_HASH_MISMATCH");
  if (typeof history !== "string" || sha256(history) !== AUTH_A_HISTORY_SHA256) deny("HISTORY_HASH_MISMATCH");
  try {
    loadReadOnlyPacketUnits({ packet: catalog,
      packetContract: { packetHash: AUTH_A_CATALOG_SHA256.toUpperCase(), queryIds: CATALOG_IDS } });
    loadReadOnlyPacketUnits({ packet: history,
      packetContract: { packetHash: AUTH_A_HISTORY_SHA256.toUpperCase(), queryIds: HISTORY_IDS } });
  } catch { deny("NON_SELECT_OR_UNIT_DRIFT"); }
  const packet = `${catalog}\n${history}`;
  const queryIds = [...CATALOG_IDS, ...HISTORY_IDS];
  const packetContract = { packetHash: sha256(packet).toUpperCase(), queryIds };
  try { loadReadOnlyPacketUnits({ packet, packetContract }); }
  catch { deny("COMBINED_UNIT_DRIFT"); }
  return { packet, packetContract, queryIds, catalogSha256: AUTH_A_CATALOG_SHA256,
    historySha256: AUTH_A_HISTORY_SHA256 };
}

export async function runAuthADbCaptureInternal({ mode = "LOCAL_TEST", dsn, catalog, history,
  spawnImpl, psqlPath, nonce, capability } = {}) {
  if (mode === "PRODUCTION") {
    const verified = assertAuthAProductionCapability(capability);
    if (verified.testOnly && typeof spawnImpl !== "function")
      throw new Error("AUTH_A_DB_PACKET_TEST_TRANSPORT_REQUIRED");
    if (!verified.testOnly && (spawnImpl !== undefined || psqlPath !== undefined || nonce !== undefined))
      throw new Error("AUTH_A_DB_PACKET_TEST_TRANSPORT_DENIED");
  }
  parseP9Connection({ mode, dsn });
  const prepared = prepareAuthADbPacket({ catalog, history });
  const guardedSpawn = mode === "PRODUCTION" ? (...args) => {
    markAuthAExternalDispatch(capability, "database");
    return (spawnImpl ?? spawn)(...args);
  } : spawnImpl;
  const result = await runP9ReadOnlyCapture({ mode, dsn, packet: prepared.packet,
    packetContract: prepared.packetContract, ...(guardedSpawn ? { spawnImpl: guardedSpawn } : {}),
    ...(psqlPath ? { psqlPath } : {}), ...(nonce ? { nonce } : {}) });
  const shared = {
    status: result.acceptanceResult === "PASS" ? "PASS" : "BLOCKED",
    targetClass: mode === "LOCAL_TEST" ? "LOCAL_TEST"
      : result.targetMode === "PRODUCTION" && result.targetRef === P9_EXPECTED_PROJECT_REF
        ? "PRODUCTION" : "UNKNOWN",
    connectionAttempts: result.connectionAttempted ? 1 : 0,
    psqlProcessCount: result.psqlProcessCount ?? (result.connectionAttempted ? 1 : 0),
    queryCount: result.queriesCaptured ?? 0,
    transactionReadOnly: result.transactionReadOnlyValue === "on",
    sameBackend: result.backendSessionCorrelation === true,
    rollbackMode: result.rollbackMode,
    catalogSha256: prepared.catalogSha256, historySha256: prepared.historySha256,
    firstFailureStage: ["PSQL_EXECUTION", "PROCESS", "RESULT_PARSING", "SESSION_PROOF"]
      .includes(result.firstFailureStage) ? result.firstFailureStage : null,
    firstFailureQueryId: result.firstFailureQueryId ?? null,
    failureClass: result.firstFailureClass ?? null,
  };
  return { transportProof: shared, queryResults: result.acceptanceResult === "PASS" ? result.perQuery : [] };
}

export async function runAuthADbCapture(options) {
  const internal = await runAuthADbCaptureInternal(options);
  return internal.transportProof;
}
