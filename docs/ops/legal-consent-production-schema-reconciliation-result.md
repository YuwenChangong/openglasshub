# Production Schema Reconciliation Result

## Scope and integrity

- Compared commit: `f067f33fd89bfbd0b3473c4e65f8a17b197cf3f1`.
- Export: `production-schema-fingerprint.csv`.
- Export SHA-256: `665B90027392A3D91FB45E4A88D6B0B7F4A10E98FB2B292FD5BE775A84DCBAEF`.
- Expected local fingerprint: `1,133` normalized non-ledger entries from `43` canonical migrations.
- Parsed export: `1,011` entries: `2` migration-ledger entries and `1,009` non-ledger entries.
- Completeness gate: passed. The export is not a 100-row Dashboard truncation, contains all twelve packet-section markers, has no duplicate or malformed packet rows, and passed catalog-only, secret-like, and email-like content validation.
- Execution boundary: comparison was fully offline. No SQL was run, no Supabase CLI or cloud request was made, and no migration, repair, deployment, or production-data operation occurred.

## Wave 1 production execution addendum

The comparison above is the preserved historical fingerprint snapshot. A later,
separately approved Stage 1/Stage 2 execution recorded at
`571c852861b34153885cfa4fcdbf3d8f74ba2fb4` changed only three reviewed
function objects and passed their postflights:

- `can_access_public_circle(uuid)` is
  `PRODUCTION_APPLIED_POSTFLIGHT_VERIFIED` with body MD5
  `67b9d428d658222c17d640a50f0b3127`.
- `increment_post_view_count(uuid)` is
  `PRODUCTION_APPLIED_POSTFLIGHT_VERIFIED` with structural SHA-256
  `5e5d6c9682a32dbb9deb7003be854eaf06700577593c7b7ac108ddecd55fed5d`
  and body MD5 `26492d2c8a4e9d85533f6ef0d2184789`.
- `insert_forum_notification(uuid, uuid, text, uuid, uuid, uuid)` is
  `PRODUCTION_APPLIED_POSTFLIGHT_VERIFIED` with structural SHA-256
  `96b887a7f28df54154c36a0e45790e61bd1cf6f10b96546ceafda8ac2c148fa2`
  and body MD5 `b23bd786e278a0071ae7759b29365df6`.

The historic inventory has 168 actionable entries across 75 logical repair
objects. After preserving all 17 function-related comparison records as
execution history, the active inventory has 148 entries across 69 pending
logical repair objects and 133 security-sensitive findings. The positive
public-post smoke is `DEFERRED_NO_ELIGIBLE_PRODUCTION_CANDIDATE`: no fixture was
created because hashes and negative authorization behavior passed in production,
positive behavior passed in `LOCAL_DOCKER_ONLY`, and no naturally eligible post
existed. This residual note is not a Wave 1 rollback condition.

## Object comparison

| Classification | Count |
| --- | ---: |
| `MATCH` | 974 |
| `MISSING_IN_PRODUCTION` | 134 |
| `DIVERGENT_IN_PRODUCTION` | 25 |
| `EXTRA_IN_PRODUCTION` | 10 |
| `INSUFFICIENT_EVIDENCE` | 0 |

The comparator found `151` security-sensitive blockers: 120 missing objects, 22 divergent objects, and 9 unexpected broadening objects. This is a schema-evidence NO-GO, not an inference from migration history.

## Security-sensitive differences

### Missing legal-consent persistence surface

`public.legal_policy_acceptances` is absent as a complete protected surface: its RLS state, 14 columns, 12 constraints, three indexes, update trigger, own-row select policy, and 13 expected grants are missing. This includes the user/bundle uniqueness and version, age, source, and confirmation integrity checks.

### Missing authorization and provenance helpers

The following functions and all four captured ACL facts (`anon`, `authenticated`, `PUBLIC`, and `service_role`) are missing, with their expected grants absent as well:

- `can_access_comment_reaction_target(uuid)`
- `can_access_public_circle(uuid)` (historically missing in this exported
  snapshot; subsequently production-applied and postflight-verified)
- `can_access_public_comment_read_target(uuid)`
- `can_create_comment_target(uuid,uuid)`
- `can_create_user_report_target(text,uuid)`
- `can_bind_post_media_provenance(text,text,text,uuid,uuid)`
- `is_canonical_post_media_object_key(text,uuid,uuid,boolean)`
- `can_access_public_circle_cover_object(text)`
- `can_access_public_post_media_object(text)`
- `can_access_public_profile_media_object(text)`
- `record_current_legal_policy_acceptance(uuid,text,text,text,text,smallint,text)`

Also missing are the two `forum_upload_attempts` rate-limit indexes, `posts_view_count_idx`, the accessible comment-reaction SELECT and self UPDATE policies, and the `legal_policy_acceptances_select_own` policy.

### Divergent execution and access control

- `increment_post_view_count(uuid)` was divergent in the captured snapshot and
  is subsequently `PRODUCTION_APPLIED_POSTFLIGHT_VERIFIED`; its historical
  comparison evidence is retained.
- `insert_forum_notification(...)` had unexpected `authenticated` and `PUBLIC`
  execution in the captured snapshot and is subsequently
  `PRODUCTION_APPLIED_POSTFLIGHT_VERIFIED`; its historical comparison evidence
  is retained.
- The following policy families differ from the expected authorization contract: `circles_select_public`; `comment_reactions_insert_self` and `comment_reactions_delete_self`; `comments_insert_self` and `comments_select_public_or_staff`; all three `post_media` policies; all four `posts` policies; `reports_insert_self`; and the four public media/circle-cover storage SELECT policies.
- The `post-media` bucket configuration differs, and `circles_status_check` differs. These require object-by-object review even where their severity is availability-oriented.

### Unexpected broadening objects

The following unexpected objects are security blockers and must be reviewed individually:

- Historical `PUBLIC:EXECUTE` grants for `increment_post_view_count(uuid)` and
  `insert_forum_notification(...)`; both are now production-applied and
  postflight-verified with their reviewed ACL matrices.
- `anon:SELECT`, `authenticated:INSERT`, and `authenticated:DELETE` grants on `public.comment_reactions`.
- Extra policies `circles_delete_owner_or_staff`, `comment_reactions_select_public`, `forum_upload_attempts_insert_self`, and `forum_upload_attempts_select_self`.

The remaining extra `authenticated:SELECT` grant on `public.comment_reactions` is recorded as an extra object but is not independently classified as a security broadening by the comparator.

## Migration evidence

| Canonical migration | Object evidence | Ledger evidence |
| --- | --- | --- |
| `20260518_forum_phase1_schema.sql` | DIVERGENT | RECORDED_VERSION_ONLY |
| `20260519_forum_phase2_grants.sql` | EFFECTIVELY_PRESENT | UNRECORDED_VERSION |
| `20260524_forum_phase3_post_media.sql` | DIVERGENT | UNRECORDED_VERSION |
| `20260525_forum_phase4_video_media.sql` | DIVERGENT | UNRECORDED_VERSION |
| `20260525_forum_phase5_publish_posts_rls.sql` | DIVERGENT | UNRECORDED_VERSION |
| `20260525_forum_phase5_circle_creator_and_images.sql` | EFFECTIVELY_PRESENT | UNRECORDED_VERSION |
| `20260531_forum_phase6_upload_guardrails.sql` | EFFECTIVELY_PRESENT | UNRECORDED_VERSION |
| `20260603_forum_comments_interactions.sql` | DIVERGENT | UNRECORDED_VERSION |
| `20260603_forum_hot_sort_and_circle_name_guard.sql` | DIVERGENT | UNRECORDED_VERSION |
| `20260603_forum_circle_owner_management.sql` | DIVERGENT | UNRECORDED_VERSION |
| `20260604_forum_circle_soft_delete_and_management.sql` | DIVERGENT | UNRECORDED_VERSION |
| `20260604_circle_cover_storage_policy.sql` | DIVERGENT | UNRECORDED_VERSION |
| `20260605_circle_cover_public_select.sql` | DIVERGENT | UNRECORDED_VERSION |
| `20260605_forum_rate_limit_purposes.sql` | PARTIALLY_PRESENT | UNRECORDED_VERSION |
| `20260605_forum_posts_body_short_content.sql` | EFFECTIVELY_PRESENT | UNRECORDED_VERSION |
| `20260606_profile_banner_and_storage.sql` | DIVERGENT | UNRECORDED_VERSION |
| `20260606_forum_notifications_mvp.sql` | DIVERGENT | UNRECORDED_VERSION |
| `20260607_auth_resend_confirmation_limit.sql` | EFFECTIVELY_PRESENT | UNRECORDED_VERSION |
| `20260607_enable_forum_realtime.sql` | EFFECTIVELY_PRESENT | UNRECORDED_VERSION |
| `20260607_fix_notification_relike_update_guard.sql` | DIVERGENT | UNRECORDED_VERSION |
| `20260611_fix_forum_notification_realtime.sql` | DIVERGENT | UNRECORDED_VERSION |
| `20260611_stabilize_forum_notifications_realtime_permissions.sql` | DIVERGENT | UNRECORDED_VERSION |
| `20260611_forum_permission_lockdown.sql` | DIVERGENT | UNRECORDED_VERSION |
| `20260612_hot_news_mvp.sql` | EFFECTIVELY_PRESENT | UNRECORDED_VERSION |
| `20260612_news_view_count_and_pagination.sql` | EFFECTIVELY_PRESENT | UNRECORDED_VERSION |
| `20260612_news_media_storage_policy.sql` | DIVERGENT | UNRECORDED_VERSION |
| `20260616_community_moderation_mvp.sql` | DIVERGENT | UNRECORDED_VERSION |
| `20260620_lock_profile_role_updates.sql` | EFFECTIVELY_PRESENT | UNRECORDED_VERSION |
| `20260620_admin_qa_role_grant_path.sql` | EFFECTIVELY_PRESENT | UNRECORDED_VERSION |
| `20260626_user_safety_states_and_bans.sql` | EFFECTIVELY_PRESENT | UNRECORDED_VERSION |
| `20260627_reports_optimization_mvp.sql` | EFFECTIVELY_PRESENT | UNRECORDED_VERSION |
| `20260703_moderation_action_notifications.sql` | DIVERGENT | RECORDED_VERSION_ONLY |
| `20260712_legal_policy_acceptances.sql` | PARTIALLY_PRESENT | UNRECORDED_VERSION |
| `20260713_comment_creation_circle_authorization.sql` | DIVERGENT | UNRECORDED_VERSION |
| `20260713_comment_reaction_visibility_authorization.sql` | DIVERGENT | UNRECORDED_VERSION |
| `20260713_comment_read_circle_visibility_authorization.sql` | DIVERGENT | UNRECORDED_VERSION |
| `20260713_forum_posts_circle_authorization.sql` | DIVERGENT | UNRECORDED_VERSION |
| `20260713_forum_report_target_authorization.sql` | DIVERGENT | UNRECORDED_VERSION |
| `20260713_post_bound_media_provenance.sql` | DIVERGENT | UNRECORDED_VERSION |
| `20260714_circle_cover_public_visibility_authorization.sql` | DIVERGENT | UNRECORDED_VERSION |
| `20260715_post_media_delivery_visibility_authorization.sql` | DIVERGENT | UNRECORDED_VERSION |
| `20260716_profile_media_delivery_authorization.sql` | DIVERGENT | UNRECORDED_VERSION |
| `20260717_security_definer_execute_hardening.sql` | DIVERGENT | UNRECORDED_VERSION |

Summary: 12 migrations are `EFFECTIVELY_PRESENT`, two are `PARTIALLY_PRESENT`, and 29 are `DIVERGENT`. The production ledger records only `20260518 | forum_phase1_schema` and `20260703 | moderation_action_notifications`; both are divergent by object evidence. Forty-one unrecorded migrations are not thereby absent: object evidence proves twelve effectively present and two partially present.

## Wave 3A production record

Circles Visibility / Wave 3A is
`PRODUCTION_RECONCILED_POSTFLIGHT_VERIFIED`. After a matching fresh preflight,
the reviewed transaction committed once: `circles_status_check` now permits
exactly `active, deleted`; `circles_select_public` now uses the reviewed public
visibility helper plus owner/staff branches; and the direct hard-DELETE policy
is absent. Read-only smoke verified seven anonymous active reads, zero deleted
reads, and no circle-data mutation or unrelated catalog drift. The original
forensic evidence remains retained in the manifest.

## Decision and next action

Production remains **NO-GO**. Do not replay migrations, run `db push`, or repair
migration history. The next safe action is a separately reviewed, read-only
preflight for W6 operational guardrails. No further remediation is authorized
by this comparison.
