# P9 final production migration-history analysis

## Scope and source

This is an offline reconciliation of the already-authorized captures. No database client, SQL, Supabase command, deployment, or mutation was run for this analysis.

- Source commit: `f3ffb175f62d5e575c7906c408fa5b625656a92f`
- Canonical inventory: 35 files, 19 unique version prefixes, and 10 collision groups.
- Canonical historical files were not renamed, edited, deleted, or combined.
- The deterministic full-SHA inventory is produced by `scripts/qa/p9-migration-history-join.mjs` using `analyzeMigrations`; its ordering is numeric version then filename.

## Capture accounting

Packet-1 was frozen at `5AC18441DBD61A36DB88300F333A40752173E224BFA9247AF28AA55E3B97E0A7`. It was accidentally captured twice, with backend PIDs `787960` and `787979`. Both were distinct read-only sessions, captured the four authorized units, explicitly rolled back, and made zero mutations. They are retained as duplicate transport evidence, not counted as independent schema evidence.

Packet-2 was captured once through the Supavisor session pooler. Its frozen packet hash is `6018CE149A1520C7C097E2577281ACE773A2329CC8F36CA74350FD03BE347002`; its sanitized result hash is `6807CCA63FC81A52051EFFDCF88C7293D51BEC6415703FDE906E3F9DE9088B81`. It proved one process/session, `transaction_read_only=on`, one captured query, explicit rollback, closed connection, and zero DDL/DML/mutations.

The Packet-1 result hash was not supplied with the authoritative evidence and is intentionally not invented here.

## Sanitized production history fixture and join

The offline fixture contains only these three rows:

| Version | Name | Statement count | Canonical mapping |
| --- | --- | ---: | --- |
| `20260518` | `forum_phase1_schema` | 103 | Exact name/version match: `20260518_forum_phase1_schema.sql` |
| `20260703` | `moderation_action_notifications` | 3 | Exact name/version match: `20260703_moderation_action_notifications.sql` |
| `20260815010632` | `admin_circle_lifecycle_and_safe_purge` | 1 | No canonical version/file match; retained as unmatched sanitized provenance |

The join reports 35 repository entries, 19 unique versions, 10 collision groups, three production rows, two canonical history matches, and one unmatched production row. A missing individual history row is not treated as an unapplied schema effect.

## Canonical inventory and collision analysis

The join supplies full repository SHA-256 values for each canonical filename. Purpose/effect inventory is derived from the canonical migration filenames and SQL; the collision rows below identify every version whose historical provenance cannot distinguish individual files.

| Collision version | Canonical files/effects | Production history | Observed production facts | Classification |
| --- | --- | --- | --- | --- |
| `20260525` | video media; circle owner/image fields and RLS; post publish RLS | Absent | circle policies partially observed; media and columns not observed | `INSUFFICIENT_SCHEMA_EVIDENCE` |
| `20260603` | circle management; comments/reactions; post hot-sort/name guard | Absent | circle insert/update and `can_manage_post` observed; comments and hot-sort facts not observed | `INSUFFICIENT_SCHEMA_EVIDENCE` |
| `20260604` | circle-cover storage; circle soft-delete/status | Absent | no circle delete policy observed (consistent with this file's policy removal); status column/storage facts not observed | `INSUFFICIENT_SCHEMA_EVIDENCE` |
| `20260605` | public circle cover; post body shortening; rate-limit purpose fields | Absent | post table/select/insert/update policies observed; affected columns/storage/rate facts not observed | `INSUFFICIENT_SCHEMA_EVIDENCE` |
| `20260606` | forum notifications; profile banner/storage | Absent | notification table, three user policies, and post-like function observed; profile/banner/storage facts not observed | `INSUFFICIENT_SCHEMA_EVIDENCE` |
| `20260607` | resend limit; realtime; notification relike guard | Absent | no resend/realtime/relike catalog fact was captured | `INSUFFICIENT_SCHEMA_EVIDENCE` |
| `20260611` | notification realtime; permission lockdown; notification realtime permissions | Absent | notification table/policies observed, but exact functions, replica identity, and publication facts not observed | `INSUFFICIENT_SCHEMA_EVIDENCE` |
| `20260612` | news table; news storage; view-count RPC | Absent | news table and five RLS policies observed; storage and `increment_news_article_view` were not observed | `INSUFFICIENT_SCHEMA_EVIDENCE` |
| `20260620` | admin grant path; profile role-change lock | Absent | profile table/policies observed; trigger/grant facts not observed | `INSUFFICIENT_SCHEMA_EVIDENCE` |
| `20260829` | device persistence/RLS; immutable device slug trigger | Absent | `public.devices` was explicitly queried by Packet-1 and absent; no device policies could exist | `MISSING_SCHEMA_EFFECT` |

For all ten collision groups, `production_history_present=false`, `production_recorded_name=null`, and `history_distinguishes_individual_file=false`. No collision group can be upgraded to an explicit individual-file history match. This is provenance ambiguity, not by itself a schema failure.

## Product-critical schema matrix

| Required current contract | Expected canonical effect | Production evidence | Result |
| --- | --- | --- | --- |
| Profiles and role-based staff authorization | `profiles` plus public select/self insert/self-or-staff update; `can_manage_post` depends on moderator/admin helper | table and all three policies observed; `can_manage_post(uuid)` observed as `SECURITY DEFINER`, `STABLE`, `search_path=public` and calling `is_moderator_or_admin()` | MATCH for bounded observed contract |
| Circles | `circles`, public select, owner/staff insert/update, lifecycle status handling | table plus select/insert/update policies observed; status/catalog facts not observed | UNKNOWN beyond bounded observed contract |
| Posts | published visibility and self/staff write contract | table plus select/insert/update policies observed; delete policy and column facts not observed | UNKNOWN for full canonical contract |
| Forum notifications and post-like notification | notification table, recipient policies, `notify_post_like` invoking `insert_forum_notification` | table and three recipient policies observed; function semantics observed | MATCH for bounded post-like contract |
| News | table and public/staff RLS; view-count RPC | table and five RLS policies observed; view-count RPC not observed | UNKNOWN |
| Device public/admin runtime | `public.devices`, published public read, staff CRUD RLS, slug-lock support | Packet-1 queried `devices` among six exact names and returned only the other five; runtime directly selects/inserts/updates/deletes `devices` | MISSING |
| Circle lifecycle/safe purge provenance | material effect of unmatched production row | unmatched production history name/version only; no canonical source identity or catalog fact | UNKNOWN, not treated as drift |

## Decision

Final classification: `FORWARD_ONLY_RECONCILIATION_REQUIRED`.

The device database contract is materially absent and is directly required by the current public device reads and admin device CRUD paths. This is sufficient to block release and require a new forward-only reconciliation migration. Historical `20260829` files must not be renamed or replayed as historical repairs because their shared version is a collision group. The unmatched production safe-purge record is not enough to prove or disprove current circle lifecycle compatibility, but it is not evidence of unsafe drift.

Packet-3 is not prepared: a narrow additional read-only query cannot change the decisive fact that `public.devices` is absent. The next authorized schema work is a reviewed, forward-only reconciliation plan; it is not authorized by this analysis.

## Release flags

```text
CANONICAL_PRODUCTION_HISTORY_COMPATIBILITY_PROVEN=true
CANONICAL_PRODUCTION_HISTORY_PROVENANCE_AMBIGUOUS=true
P8_PRODUCTION_RELEASE_BLOCKER_DEPENDENCIES=false
P8_PRODUCTION_RELEASE_BLOCKER_MIGRATION=true
READY_FOR_PRODUCTION_RECONCILIATION=true
READY_FOR_PRODUCTION_RELEASE_AUTHORIZATION=false
P9_FINAL_ANALYSIS_PRODUCTION_CONNECTIONS=0
P9_FINAL_ANALYSIS_PRODUCTION_SQL=0
P9_FINAL_ANALYSIS_PRODUCTION_MUTATIONS=0
READY_FOR_P9_PACKET_3_CAPTURE=false
```
