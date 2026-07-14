# Legal Consent Local Supabase Verification

Status: blocked during the first clean local migration replay. No remote Supabase project was linked, queried, or modified.

Original replay commit: `5082063d64ce0705ee0bc609c374cac163f48536`
Forensic audit baseline: `80b2ed4753fcd3845bd0f11c3ac79a775c1633f2`

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

## Duplicate-Version Forensic Audit

The repository contains 43 migration files. Every filename matches the installed CLI's timestamp-prefix convention (`<8-to-14-digit-version>_<name>.sql`), so there are no malformed filenames. The lexical file order is the order listed below. The replay demonstrated that the CLI records the numeric prefix as a unique `supabase_migrations.schema_migrations.version`; after it records the first `20260525` file, it cannot record the second. The observed pre-failure effective order matched the lexical order through the first collision. A complete effective order cannot be observed until the collision is resolved.

```text
20260518_forum_phase1_schema.sql
20260519_forum_phase2_grants.sql
20260524_forum_phase3_post_media.sql
20260525_forum_phase4_video_media.sql
20260525_forum_phase5_circle_creator_and_images.sql
20260525_forum_phase5_publish_posts_rls.sql
20260531_forum_phase6_upload_guardrails.sql
20260603_forum_circle_owner_management.sql
20260603_forum_comments_interactions.sql
20260603_forum_hot_sort_and_circle_name_guard.sql
20260604_circle_cover_storage_policy.sql
20260604_forum_circle_soft_delete_and_management.sql
20260605_circle_cover_public_select.sql
20260605_forum_posts_body_short_content.sql
20260605_forum_rate_limit_purposes.sql
20260606_forum_notifications_mvp.sql
20260606_profile_banner_and_storage.sql
20260607_auth_resend_confirmation_limit.sql
20260607_enable_forum_realtime.sql
20260607_fix_notification_relike_update_guard.sql
20260611_fix_forum_notification_realtime.sql
20260611_forum_permission_lockdown.sql
20260611_stabilize_forum_notifications_realtime_permissions.sql
20260612_hot_news_mvp.sql
20260612_news_media_storage_policy.sql
20260612_news_view_count_and_pagination.sql
20260616_community_moderation_mvp.sql
20260620_admin_qa_role_grant_path.sql
20260620_lock_profile_role_updates.sql
20260626_user_safety_states_and_bans.sql
20260627_reports_optimization_mvp.sql
20260703_moderation_action_notifications.sql
20260712_legal_policy_acceptances.sql
20260713_comment_creation_circle_authorization.sql
20260713_comment_reaction_visibility_authorization.sql
20260713_comment_read_circle_visibility_authorization.sql
20260713_forum_posts_circle_authorization.sql
20260713_forum_report_target_authorization.sql
20260713_post_bound_media_provenance.sql
20260714_circle_cover_public_visibility_authorization.sql
20260715_post_media_delivery_visibility_authorization.sql
20260716_profile_media_delivery_authorization.sql
20260717_security_definer_execute_hardening.sql
```

All 30 files in the ten duplicate groups are `REPOSITORY_EVIDENCE_INCONCLUSIVE`: local Git proves when files entered and changed the repository, but neither Git nor the checked-in documentation contains an authoritative `schema_migrations` export, migration-runner log, or deployment record that identifies which duplicate names were recorded remotely. `docs/moderation-mvp-notes.md` records only that `20260703_moderation_action_notifications.sql` was applied in production; it does not prove the history or content of any earlier duplicate-version file.

| Version | Files and SHA-256 |
| --- | --- |
| `20260525` | `forum_phase4_video_media` `EE26A91B82D17302438D862638B92915B4D292CDA1820C193500DC1EB254B90D`; `forum_phase5_circle_creator_and_images` `62C0AF5CA0DFF6548449720F274B1D267E3E83B76A99572D90E3AF23193D6739`; `forum_phase5_publish_posts_rls` `37B615099E2E255666201E5F7CA65B4F75D22D625E32D6A0347862F4825D92C5` |
| `20260603` | `forum_circle_owner_management` `C3E7D38F03D3B4E3E49D58ACC932B3BC392907B976E27571D388125988E0510F`; `forum_comments_interactions` `E7B7187CCB3F0F660D3F5E367BB1E791D14335E1365E7ADED8FBE4C64FBC6300`; `forum_hot_sort_and_circle_name_guard` `562338885BD27B18ADE1D7AD5BBF45726BD26F7286B1A3437DA96415E121429C` |
| `20260604` | `circle_cover_storage_policy` `B6BD9197865429711F90634384F724ACFBDD8084503F9708E11C16AD1EE490E0`; `forum_circle_soft_delete_and_management` `564874A3D66450492E5819A81BA54BF42EBCBCAC4E99C5439327F9EFA7D142D9` |
| `20260605` | `circle_cover_public_select` `3A18980810D10E237663562E2960136976BBC8250004099A745426CC8CBF842F`; `forum_posts_body_short_content` `21CE077F23C4AA14911B20CD00545190E3FBA7410821F3B0BE5AA449DE260EAA`; `forum_rate_limit_purposes` `9E44B98B5C0FF8D9E0CFCA61FD5CF87F2404C436D414153AD54BD59D91480EE3` |
| `20260606` | `forum_notifications_mvp` `DDA6E1880623BF4B8AC25E3FB2D5F3E6A13F11C91A0A41963D1FF38E4C2A63DD`; `profile_banner_and_storage` `A35F93B2897B9BAF80CB58F135ED81254F151579C4F074DCDB11EB0FCCD0A29A` |
| `20260607` | `auth_resend_confirmation_limit` `F4AD22566547C9507C5D63ACA7EDEC9643CE773FCAD765F10A08DF8FA32F9706`; `enable_forum_realtime` `0F967E7C373E6AA7B078A33E2BF2A79257F337CC08388714AF9F8EA8E79C2B6C`; `fix_notification_relike_update_guard` `77803C5F67C5AB24597EC752D67B795255D442EACAE9C983DF447C21F907930A` |
| `20260611` | `fix_forum_notification_realtime` `4818C597E624219A559D4E5808413354674AC28EF5A5C0B4B826811ECE51D836`; `forum_permission_lockdown` `6EFD25F000F4562149C9B48C5498E9DA0D2059425542D93F0E6EED6F13B88848`; `stabilize_forum_notifications_realtime_permissions` `AFF3D78F91BAD8F62A993BB541433DDC1EA0F086BAD55439FF1CBA42DB45A170` |
| `20260612` | `hot_news_mvp` `E19091424CDA9BBA8BA2118032533E07F39B0922918261BFF40CD73C499C93CE`; `news_media_storage_policy` `F4CF5AD75CD07F70D51AC267963C17348D972F73DE1160B9A56C02D5B84A7F5B`; `news_view_count_and_pagination` `19FBD86B4157693EF485E7D9AC53C364F8576B1B0C383A79960C816C346464BF` |
| `20260620` | `admin_qa_role_grant_path` `3CFDE2376D29D4E28DD6336167A09CE15161081980C9E2B732E9813215FC353E`; `lock_profile_role_updates` `AB48116782A8C7855AC2A43856B8164D7E0F73EBB6989289241D830E17FC9D30` |
| `20260713` | `comment_creation_circle_authorization` `84FDAA9B3519FF38ECF1B3ECF43E3601BC28D72F842418E986B351BB32618F26`; `comment_reaction_visibility_authorization` `09CD413FF6D6271522F59066A4E698188C4EA41B914C795E377A96ECCDA07BB6`; `comment_read_circle_visibility_authorization` `A09A1BBE73E3BC7729CB5D41D312E4A2487D3F1109317840EC6D6F802FA99845`; `forum_posts_circle_authorization` `5486FE9DCBC4123F35D2F0640A0CBDF0D90790710AF6A6F2BDDB49B627F13A5A`; `forum_report_target_authorization` `E1513EE78CD48DFAAA686F66A7B123A7270C88DE06964EF015E94168A1128121`; `post_bound_media_provenance` `B8C18247DBA2F62F373D61BF8ED6EF3C7D556B01FA791CC51C35FEF42C82D59E` |

### `20260525` Provenance And Dependency Evidence

| File | Git provenance | Purpose and dependencies | Later consumers / repeat safety |
| --- | --- | --- | --- |
| `20260525_forum_phase4_video_media.sql` | Added by `1be4a8a0000e2f9c6896e4257964b03812cd5020` at `2026-05-25T16:46:42+12:00`; modified by `a6e8bac695b01c2ce4dff18c12af11c77c81db6c` at `2026-05-25T17:09:46+12:00`. | Alters `public.post_media` (video metadata columns and five constraints) and updates `storage.buckets` for `post-media`. Requires the Phase 1 `posts`/`profiles` objects and Phase 3 `post_media` table and bucket. Creates no function or policy. | Phase 6 adds a `post_media` index and the June circle-owner migration creates a `post_media` read policy. The `if not exists` columns do not make reapplying the whole migration proven safe: it drops/recreates constraints and changes bucket metadata. |
| `20260525_forum_phase5_publish_posts_rls.sql` | Added by `0f81af5b2dcc4ddd114f22e3f323588db7794df3` at `2026-05-25T21:02:52+12:00`; no later file modification. | Drops/recreates `posts_insert_self` on `public.posts`, requiring the Phase 1 table, `status` enum, and baseline policy. Creates no table, function, or data mutation. | The July posts authorization migration later replaces this policy. Reapplying is a live policy replacement, not a proven no-op. |
| `20260525_forum_phase5_circle_creator_and_images.sql` | Added by `4392b54db61f3902d56036eb919fd4aef23124d0` at `2026-05-25T22:22:08+12:00`; no later file modification. | Alters `public.circles` with `owner_id` and `image_path`, creates `circles_owner_idx`, and replaces three owner/staff policies. Requires Phase 1 `profiles`, `circles`, RLS helper, and base staff policy. Creates no function or data mutation. | The June 3 circle-owner migration updates the same policy family and the June 4 management migration drops the delete policy. Reapplying is not proven safe because it can reinstate superseded policy definitions. |

The chronological commit order is phase-4 video, posts RLS, then circle ownership. The two Phase 5 files have no direct SQL-object dependency on one another, so source alone does not establish a strict relative order between them; the recorded CLI pre-failure order is video, circle ownership, then posts RLS. No unique replacement version can be selected safely: inserting one before or after an existing historical version can cause a remote migration runner either to skip an already-applied SQL body under its old version or to treat that same body as new.

## Decision: Remote History Confirmation Required

This is `REMOTE_HISTORY_CONFIRMATION_REQUIRED`, not `SAFE_CANONICAL_VERSION_CORRECTION`. The repository cannot prove that exactly one duplicate file is unexecuted, preserve one deployed identity, or establish a replacement version that every already-applied environment would interpret safely. No migration was renamed, deleted, reordered, squashed, repaired, or otherwise modified.

The minimal operator-only, read-only confirmation is one controlled Dashboard SQL Editor query against the intended project. It must not use a CLI link, password, token, migration command, repair command, or write operation:

```sql
select version, name, cardinality(statements) as statement_count
from supabase_migrations.schema_migrations
where version in (
  '20260525', '20260603', '20260604', '20260605', '20260606',
  '20260607', '20260611', '20260612', '20260620', '20260713'
)
order by version, name;
```

Return only the three displayed fields and the project environment label, with all project identifiers, credentials, and statement bodies omitted. Current CLI metadata has a unique version plus `name` and parsed `statements`; `name` can identify the recorded duplicate. If the target metadata table has only `version` or an empty `name`, it cannot distinguish the competing files. In that case the additional required read-only evidence is the immutable migration-runner/deployment log naming the applied file and commit for each duplicate version. A history row alone still does not prove an edited SQL body's schema effect, so any later remediation plan must reconcile this result with a reviewed schema/object comparison. No migration repair, history update, remote rename, `db push`, `db pull`, or remote CLI command is approved by this report.

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

Do not rename, reorder, or repair historical migrations in place during local verification. A separate reviewed migration-history remediation plan must establish an upgrade-safe unique-version strategy for all duplicate groups, including an explicit compatibility path for any already-applied environment. Only after the read-only history evidence is reviewed and that plan is implemented may a fresh LOCAL_DOCKER_ONLY replay begin.

The original legal-consent source review remains valid, but local database validation is incomplete. Cloud migrations, cloud ACL verification, runtime configuration verification, operator/contact values, qualified legal review, and production approval remain outstanding.

Next approved action: author and review a dedicated migration-history duplicate-version remediation plan. Do not run cloud or production migration commands.

Classification: `LEGAL_TRUST_CONSENT_FOUNDATION_V1_PREDEPLOYMENT_NO_GO`.
