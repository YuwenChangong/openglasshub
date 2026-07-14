# Legal Consent Local Supabase Verification

Status: blocked during the first clean local migration replay. No remote Supabase project was linked, queried, or modified.

Reviewed commit: `5082063d64ce0705ee0bc609c374cac163f48536`

## Local-Only Target Evidence

- Docker Client and Server: `29.6.1`.
- Node.js: `v24.14.1`.
- Supabase CLI: `2.109.1`.
- The repository has no `supabase/config.toml`, no `.supabase` link metadata, and no stored project-ref metadata.
- Only CLI local forms were used or prepared: `supabase start`, `supabase db reset --local`, `supabase db lint --local`, and `supabase test db --local`.
- No `login`, `link`, `--linked`, remote `--db-url`, dashboard API, cloud SQL, or cloud migration command was used.

Docker image pulls were required to prepare the local stack. Supabase CLI debug output also recorded a telemetry POST attempt to `https://eu.i.posthog.com/batch/`; it was not a Supabase project, database, Auth, Storage, or Dashboard request. No cloud Supabase project was contacted.

No local Studio URL is available. The CLI tore down and pruned the failed local containers, database volume, and network.

## Migration Inventory

The legal-consent prerequisite inventory remains 12 files in the reviewed order, with the checksums recorded in `docs/ops/legal-consent-notification-rpc-offline-review.md`. The source inventory itself is intact, but it cannot complete a clean replay with the installed CLI.

The first deterministic collision is version `20260525`:

```text
20260525_forum_phase4_video_media.sql
20260525_forum_phase5_circle_creator_and_images.sql
20260525_forum_phase5_publish_posts_rls.sql
```

The CLI applied the first `20260525` migration, then failed while recording `20260525_forum_phase5_circle_creator_and_images.sql` in `supabase_migrations.schema_migrations`:

```text
SQLSTATE 23505
duplicate key value violates unique constraint "schema_migrations_pkey"
Key (version)=(20260525) already exists
```

Further duplicate migration-version groups found statically are `20260603`, `20260604`, `20260605`, `20260606`, `20260607`, `20260611`, `20260612`, `20260620`, and `20260713`. This is a repository migration-history compatibility blocker, not a migration 12 ACL failure.

## Verification Result

| Check | Result |
| --- | --- |
| Local Docker stack start | Reached local Postgres migration replay, then failed and cleaned itself up |
| Full clean migration replay | Failed at duplicate version `20260525` |
| Upgrade-path simulation | Not started; clean replay is prerequisite |
| `db lint --local` and `test db --local` | Not started; no healthy local database remained |
| Migration 12 application and history | Not reached / not verified locally |
| ACL, SECURITY DEFINER, search-path, and RLS catalog checks | Not started; no healthy local database remained |
| Local Auth, notification RPC, post-view, report-target, consent, and residue smoke checks | Not started by stop condition |
| Repository source files | Unchanged except this documentation record and readiness reference |

No local test identities, data, notifications, report events, safety events, media rows, storage objects, or residue were retained because the CLI pruned the failed local stack.

## Required Remediation Before Re-run

Do not rename, reorder, or repair historical migrations in place during local verification. A separate reviewed migration-history remediation plan must establish an upgrade-safe unique-version strategy for all duplicate groups, including an explicit compatibility path for any already-applied environment. Only after that plan is implemented and independently reviewed may a fresh LOCAL_DOCKER_ONLY replay begin.

The original legal-consent source review remains valid, but local database validation is incomplete. Cloud migrations, cloud ACL verification, runtime configuration verification, operator/contact values, qualified legal review, and production approval remain outstanding.

Next approved action: author and review a dedicated migration-history duplicate-version remediation plan. Do not run cloud or production migration commands.

Classification: `LEGAL_TRUST_CONSENT_FOUNDATION_V1_PREDEPLOYMENT_NO_GO`.
