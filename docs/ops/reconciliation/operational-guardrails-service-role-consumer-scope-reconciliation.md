# R6 Service-Role Consumer Scope Reconciliation

Status: `R6_STAGE1_BINDING_READY`.

This repository-only remediation closed a real privileged-capability boundary:
the legal-consent module exported a raw `SupabaseClient` factory and the deprecated
Functions compatibility module retained an exported generic service-role factory.
The prior issue was not merely an audit-expectation defect. Both generic surfaces
are removed; encrypted Production binding metadata remains
`PRODUCTION_BINDING_METADATA_READY` and no Production SQL has executed.

## Exact Inventory And Allowlist

| Source path | Runtime status | Public operation surface | Boundary result |
| --- | --- | --- | --- |
| `src/lib/server/legal-consent-repository.server.ts` | Active Astro server source | `createLegalConsentWriteRepository(env, verifiedUserId)` returns only `LegalConsentWriteRepository`; its private `Pick<SupabaseClient, "rpc">` constructor calls fixed `record_current_legal_policy_acceptance`. Its only writer importer is `src/pages/api/legal/consent.ts`, after authentication, payload validation, and current-state read. | Approved narrow boundary; no exported raw client, callback, arbitrary table/RPC name, auth-admin, storage, or error escape. |
| `src/lib/server/moderation-notifications.server.ts` | Active Astro server source | `createModerationNotificationWriter` exposes validated commands through fixed `insert_forum_notification`; six moderator-authorized routes construct it after authorization and consent gating. | Approved narrow boundary; internal RPC-only client and sanitized `false` errors. |
| `src/lib/server/consume-forum-rate-limit.server.ts` | Active Astro server source | `consumeForumRateLimit` calls only fixed `consume_forum_rate_limit`; it reaches the five guarded forum mutations through `src/lib/server/rate-limit.ts`. | Approved narrow boundary; no direct table API, retry, client export, or unsanitized error path. |
| `functions/_lib/supabase.ts` | Deprecated, non-runtime under current Astro `_worker.js` output | Deprecated anon/user compatibility helpers only; `functions/api/forum/posts.ts` imports only those helpers. No active Astro or generated-worker importer exists. | `DEPRECATED_GENERIC_FACTORY_UNUSED_SAFE_TO_REMOVE`: removed the unused service-role field and `createServiceClient` export. |

The approved allowlist is exactly the three active paths above: no wildcard,
directory, pattern, generic-helper exception, or fourth consumer. A new direct
`SUPABASE_SERVICE_ROLE_KEY` reader fails deterministic validation until separately
reviewed.

## Exposure And Regression Evidence

All allowlisted modules remain server-only. TypeScript AST checks reject exported
raw privileged client returns/values, generic factories, raw-client callbacks,
arbitrary table/RPC wrappers, privileged re-exports, auth-admin/storage surfaces,
and exported service-role environment values. Negative fixtures cover each case,
including restoration of the deprecated generic factory. Browser-component,
client-asset, rendered-HTML, and public-environment audits find no service-role
material.

Legal-consent reads, version validation, stale-consent enforcement, and the
actor-bound acceptance RPC retain their ordering and sanitized error handling.
Moderation notification and rate-limit behavior are unchanged.

Classification: `R6_STAGE1_BINDING_READY`.

This repository result does not prove runtime secret value correctness, execute
Production RPC SQL, deploy, merge, canary, alter grants/RLS/indexes, or read
Production data. The next separately approved continuation is:

`APPROVE_R6_CONTINUE_PRODUCTION_RPC_SQL_EXECUTION`
