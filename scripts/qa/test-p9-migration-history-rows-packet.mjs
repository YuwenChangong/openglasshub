import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { P9_PACKET_2_SHA256, validateP9MigrationHistoryRowsPacket } from "./p9-migration-history-rows-packet.mjs";

const packet = await readFile(new URL("../../docs/ops/p9-migration-history-rows-read-only.sql", import.meta.url), "utf8");
const result = validateP9MigrationHistoryRowsPacket(packet);
if (result.sha256 !== P9_PACKET_2_SHA256) throw new Error("P9_PACKET_2_HASH_FREEZE_FAILED");
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) console.log("P9_MIGRATION_HISTORY_ROWS_PACKET_READ_ONLY_OK");
