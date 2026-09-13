# Device Schema v1 Release A migration-history forensic

This artifact records the five observed Supabase Production migration-history rows needed by the Release A deployment compatibility overlay. It is repository evidence only.

It is not a desired future ledger, not a replacement canonical migration set, and not authorization to repair Production migration history or replay historical migrations.

## Capture scope

- Target class: `SUPABASE_PRODUCTION_PROJECT_OPENGLASS_HUB`
- Project ref: `xcbnxzjlsvtgzixurcof`
- Capture mode: read-only migration-history metadata
- Remote row count: 5
- Production schema writes: 0
- Production data writes: 0
- Production history writes: 0
- Release A apply attempts: 0

## Remote rows and canonical mapping

| Remote version | Remote name | Classification | Canonical local migration |
| --- | --- | --- | --- |
| `20260518` | `forum_phase1_schema` | `SHARED_EXACT_VERSION` | `supabase/migrations/20260518_forum_phase1_schema.sql` |
| `20260703` | `moderation_action_notifications` | `SHARED_EXACT_VERSION` | `supabase/migrations/20260703_moderation_action_notifications.sql` |
| `20260815010632` | `admin_circle_lifecycle_and_safe_purge` | `REMOTE_ALIAS_OF_LOCAL_CANONICAL_MIGRATION` | `supabase/migrations/20260814_admin_circle_lifecycle_and_safe_purge.sql` |
| `20260902042807` | `forward_reconcile_devices` | `SHARED_EXACT_VERSION` | `supabase/migrations/20260902042807_forward_reconcile_devices.sql` |
| `20260904101403` | `forward_reconcile_security_privileges` | `DUPLICATE_PROVIDER_RECORDED_VERSION_OF_EXISTING_CHANGE` | `supabase/migrations/20260904054013_forward_reconcile_security_privileges.sql` |

## Alias evidence

`20260815010632` maps to `20260814_admin_circle_lifecycle_and_safe_purge.sql` because the Production row and canonical file have the same whitespace-normalized SQL MD5 fingerprint, and read-only schema-effect checks observed the circle lifecycle/safe-purge objects, constraints, trigger, and expected RPC grants.

`20260904101403` maps to `20260904054013_forward_reconcile_security_privileges.sql` because the Production row and canonical file have the same whitespace-normalized SQL MD5 fingerprint, and the existing security audit packet covers 202 privilege postconditions for that migration.

## Overlay use

The machine-readable authority is `docs/ops/device-schema-v1-release-a-migration-history-forensic.json`. The overlay builder must consume that JSON rather than prompt text and must keep generated compatibility migrations outside `supabase/migrations/`.
