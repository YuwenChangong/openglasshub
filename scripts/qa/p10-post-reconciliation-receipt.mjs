import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { runP9ReadOnlyCapture } from "./p9-readonly-postgres-transport.mjs";

export const P10_RECEIPT_SQL_SHA256 = "619EB57B1D9287BE9E28D00B34B96E11EEEF5F379307D85C5B622AA76DAD758A";
export const P10_RECEIPT_CONTRACT = Object.freeze({ packetHash: P10_RECEIPT_SQL_SHA256, queryIds: ["TABLE_COLUMNS", "CONSTRAINTS", "INDEXES", "RLS", "GRANTS", "POLICIES", "FUNCTION_TRIGGERS", "MIGRATION_HISTORY"] });

export function classifyP10Receipt({ fullDevicesContract, historyRowPresent }) {
  if (!fullDevicesContract) return { materializationProven: false, historyRegistrationProven: false, releaseBlockerMigration: true, readyForHistoryRegistrationPrep: false, readyForReleaseAuthorization: false };
  if (!historyRowPresent) return { materializationProven: true, historyRegistrationProven: false, releaseBlockerMigration: true, readyForHistoryRegistrationPrep: true, readyForReleaseAuthorization: false };
  return { materializationProven: true, historyRegistrationProven: true, releaseBlockerMigration: false, readyForHistoryRegistrationPrep: false, readyForReleaseAuthorization: true };
}

export async function runP10ReceiptCapture({ mode = "PRODUCTION", dsn, packet, ...options }) {
  if (createHash("sha256").update(packet).digest("hex").toUpperCase() !== P10_RECEIPT_SQL_SHA256) throw new Error("P10_RECEIPT_SQL_HASH_MISMATCH");
  return runP9ReadOnlyCapture({ mode, dsn, packet, packetContract: P10_RECEIPT_CONTRACT, ...options });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dsn = process.env.P10_PRODUCTION_DATABASE_URL;
  if (!dsn) throw new Error("P10_PRODUCTION_CREDENTIAL_UNAVAILABLE");
  const packet = await readFile(new URL("../../docs/ops/p10-post-reconciliation-receipt-read-only.sql", import.meta.url), "utf8");
  const evidence = await runP10ReceiptCapture({ dsn, packet }); console.log(JSON.stringify(evidence, null, 2)); if (evidence.acceptanceResult !== "PASS") process.exitCode = 1;
}
