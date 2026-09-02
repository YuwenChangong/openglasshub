import { createHash } from "node:crypto";

export const P9_PACKET_2_SHA256 = "6018CE149A1520C7C097E2577281ACE773A2329CC8F36CA74350FD03BE347002";

function executableSql(packet) {
  return packet.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/'(?:''|[^'])*'/g, "''");
}

export function validateP9MigrationHistoryRowsPacket(packet) {
  const sql = String(packet);
  const executable = executableSql(sql);
  const sha256 = createHash("sha256").update(sql).digest("hex").toUpperCase();
  if (
    sha256 !== P9_PACKET_2_SHA256 ||
    (executable.match(/\bSELECT\b/gi) ?? []).length !== 1 ||
    !/\bFROM\s+supabase_migrations\.schema_migrations\b/i.test(executable) ||
    !/\bversion\b/i.test(executable) || !/\bname\b/i.test(executable) ||
    !/\bcreated_by\b/i.test(executable) || !/\bidempotency_key\b/i.test(executable) ||
    !/\barray_length\(statements,\s*1\)\s+AS\s+statement_count\b/i.test(executable) ||
    !/\barray_length\(rollback,\s*1\)\s+AS\s+rollback_statement_count\b/i.test(executable) ||
    !/\bORDER\s+BY\s+version,\s*name\b/i.test(executable) ||
    /\b(?:INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|CALL)\b/i.test(executable) ||
    /\b(?:profiles|auth\.users|posts|forum_notifications|storage\.objects|devices)\b/i.test(executable) ||
    /(?:\bSELECT|,)\s*(?:statements|rollback)\s*(?:,|\bFROM\b)/i.test(executable) ||
    /(?:service[_-]?role|anon[_-]?key|password|token)\s*=\s*[^\s]+/i.test(sql)
  ) throw new Error("P9_PACKET_2_VALIDATION_FAILED");
  return { sha256, statementCount: 1, sql, executable };
}
