-- P9 Packet-2: production migration-history metadata only.
SELECT
  version,
  name,
  created_by,
  idempotency_key,
  array_length(statements, 1) AS statement_count,
  array_length(rollback, 1) AS rollback_statement_count
FROM supabase_migrations.schema_migrations
ORDER BY version, name;
