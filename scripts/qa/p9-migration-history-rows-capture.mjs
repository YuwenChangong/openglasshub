import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { P9_PACKET_2_SHA256, validateP9MigrationHistoryRowsPacket } from "./p9-migration-history-rows-packet.mjs";
import { runP9ReadOnlyCapture } from "./p9-readonly-postgres-transport.mjs";

export const P9_PACKET_2_CONTRACT = Object.freeze({
  packetHash: P9_PACKET_2_SHA256,
  queryIds: ["MIGRATION_HISTORY_ROWS"],
});

export async function runP9MigrationHistoryRowsCapture({ mode = "PRODUCTION", dsn, packet, ...options }) {
  validateP9MigrationHistoryRowsPacket(packet);
  return runP9ReadOnlyCapture({ mode, dsn, packet, packetContract: P9_PACKET_2_CONTRACT, ...options });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const packet = await readFile(new URL("../../docs/ops/p9-migration-history-rows-read-only.sql", import.meta.url), "utf8");
  const dsn = process.env.P9_PRODUCTION_DATABASE_URL;
  if (!dsn) throw new Error("P9_PRODUCTION_CREDENTIAL_UNAVAILABLE");
  const evidence = await runP9MigrationHistoryRowsCapture({ dsn, packet });
  console.log(JSON.stringify(evidence, null, 2));
  if (evidence.acceptanceResult !== "PASS") process.exitCode = 1;
}
