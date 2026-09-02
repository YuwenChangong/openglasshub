import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { P9_PACKET_2_SHA256, validateP9MigrationHistoryRowsPacket } from "./p9-migration-history-rows-packet.mjs";

const packetPath = path.join(process.cwd(), "docs", "ops", "p9-migration-history-rows-read-only.sql");

test("P9P2-01 through P9P2-06 keep Packet-2 limited to deterministic migration metadata", async () => {
  const packet = await readFile(packetPath, "utf8");
  const result = validateP9MigrationHistoryRowsPacket(packet);
  assert.equal(result.sha256, P9_PACKET_2_SHA256);
  assert.equal(result.statementCount, 1);
  assert.match(result.sql, /FROM\s+supabase_migrations\.schema_migrations/i);
  assert.match(result.sql, /array_length\(statements,\s*1\)\s+AS\s+statement_count/i);
  assert.match(result.sql, /array_length\(rollback,\s*1\)\s+AS\s+rollback_statement_count/i);
  assert.match(result.sql, /ORDER\s+BY\s+version,\s*name/i);
  assert.doesNotMatch(result.sql, /(?:SELECT|,)\s*(?:statements|rollback)\s*(?:,|FROM)/i);
  assert.doesNotMatch(result.executable, /\b(?:INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|CALL)\b/i);
  assert.doesNotMatch(result.executable, /\b(?:profiles|auth\.users|posts|forum_notifications|storage\.objects|devices)\b/i);
});

test("P9P2-08 through P9P2-10 reject ambiguous, body-capturing, or unsafe Packet-2 SQL", () => {
  for (const sql of [
    "SELECT version, statements FROM supabase_migrations.schema_migrations ORDER BY version, name;",
    "SELECT version FROM supabase_migrations.schema_migrations;",
    "DELETE FROM supabase_migrations.schema_migrations;",
    "SELECT version FROM public.profiles ORDER BY version;",
  ]) assert.throws(() => validateP9MigrationHistoryRowsPacket(sql), /P9_PACKET_2_VALIDATION_FAILED/);
});
