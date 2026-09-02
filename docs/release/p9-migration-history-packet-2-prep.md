# P9 Packet-2 preparation evidence

## Previous production transport evidence

`P9_CAPTURE_7=PASS_INCOMPLETE_EVIDENCE`. The first read-only packet was accidentally run twice. Both captures used a read-only transaction, captured all four original query units, explicitly rolled back, and reported zero mutations. The distinct backend PIDs were `787960` and `787979`; this is two separate read-only sessions and is retained as evidence, not collapsed into one.

The original `MIGRATION_HISTORY` result established the `supabase_migrations.schema_migrations` column shape but did not capture its rows. Consequently, canonical production-history compatibility is not yet proven.

## Packet-2

- Packet: `docs/ops/p9-migration-history-rows-read-only.sql`
- SHA-256: `6018CE149A1520C7C097E2577281ACE773A2329CC8F36CA74350FD03BE347002`
- Scope: one deterministic `SELECT` from `supabase_migrations.schema_migrations`, ordered by `version, name`.
- Returns only version, name, creator/idempotency metadata, and statement/rollback array lengths. It never returns statement or rollback bodies and never queries application data.
- The future command is `node .\scripts\qa\p9-migration-history-rows-capture.mjs`, with no flags. It hash-validates the packet before spawning a single `psql` process, proves `BEGIN READ ONLY`, preserves one framed result, proves the same backend session, rolls back, and closes.

## Offline and local evidence

- Static packet validation: PASS.
- Fresh local Supabase/Postgres Packet-2 acceptance: PASS (`transaction_read_only=on`, one process/session, one query captured, explicit rollback, connection close, temporary runtime cleanup).
- Local Packet-2 result retained 35 metadata rows and no statement or rollback body fields.
- Production connections and production SQL during this preparation: `0`.

`scripts/qa/p9-migration-history-join.mjs` builds the deterministic 35-file repository comparison table. Until a separately authorized Packet-2 production capture provides its metadata rows, every entry is classified `PENDING_PRODUCTION_PACKET_2`; collision groups remain explicitly represented for subsequent schema-effect analysis.

## Gate

`READY_FOR_P9_PACKET_2_CAPTURE=true`

No Packet-2 production execution occurred during preparation.
