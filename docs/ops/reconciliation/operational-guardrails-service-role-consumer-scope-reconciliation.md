# R6 Service-Role Consumer Scope Reconciliation

Status: `R6_BLOCKED_GENERIC_PRIVILEGED_CLIENT`.

This repository-only review corrects one fact and preserves one blocking
boundary. The prior R6 audit expectation that only the rate-limit wrapper
could name `SUPABASE_SERVICE_ROLE_KEY` was over-restrictive: three active
Astro server modules intentionally name the binding. That expectation cannot
be replaced with an approved three-file allowlist yet, because two raw
privileged-client factories remain exported in the repository.

## Exact Inventory

| Source path | Status | Exported symbol | Purpose | Importers / reachability | Boundary result |
| --- | --- | --- | --- | --- | --- |
| `src/lib/server/legal-consent-repository.server.ts` | Active Astro server source | `createLegalConsentServiceClient` | Builds the client used only to call `record_current_legal_policy_acceptance` through an actor-bound write repository. Authenticated RLS is insufficient because browser writes are revoked and the fixed service-role RPC is the reviewed writer. | `src/pages/api/legal/consent.ts`; POST authenticates, validates payload, reads current status, then lazily constructs the writer with `auth.userId`. | Blocked: exported function returns raw `SupabaseClient`, so a future server importer could use arbitrary privileged operations. The key is not returned, logged, serialized, or put in a public error. |
| `src/lib/server/moderation-notifications.server.ts` | Active Astro server source | `createModerationNotificationWriter` | Sends one validated moderation notification through fixed `insert_forum_notification` RPC parameters bound to the verified moderator. | Six moderator-authorized routes: report action; user ban, clear-warning, suspend, unban, and warn. Each constructs the writer after moderator authentication and legal-consent gating. | Narrow at present: internal client factory, `Pick<SupabaseClient, "rpc">`, one fixed RPC, invalid/self commands stop before client construction, and errors return `false`. |
| `src/lib/server/consume-forum-rate-limit.server.ts` | Active Astro server source | `consumeForumRateLimit` | Makes one fixed `consume_forum_rate_limit` RPC call for server-derived actor, IP hash, purpose, and bytes. | `src/lib/server/rate-limit.ts`, then the five guarded forum mutation routes. | Narrow at present: internal `Pick<SupabaseClient, "rpc">` factory, no direct table API, no client export, no retry, timeout abort, exact response parsing, and sanitized fail-closed errors. |
| `functions/_lib/supabase.ts` | Deprecated, non-runtime under the current Astro `_worker.js` Pages output | `createServiceClient` | Historical generic service-role client helper. | No current caller imports `createServiceClient`; `functions/api/forum/posts.ts` imports only anon/user helpers. The `functions/README.md` and deployment records mark this directory non-runtime. | Blocked: exported generic `SupabaseClient` factory remains checked in. It is not in the active browser or worker graph, but it must not be retained as an approved privileged boundary. |

The complete direct source inventory is deterministic in
`scripts/test-operational-guardrails-service-role-consumer-scope.mjs`. Generated
artifacts are intentionally excluded from source counts and must be audited
separately after every build.

## Import And Exposure Review

The active import graph is server-only: the legal route is an Astro API route;
the moderation callers are Astro admin API routes; and the rate-limit wrapper
is imported only by the server-only rate-limit adapter. Browser components do
not import any of the three modules. `src/lib/supabase-browser.ts`,
`src/lib/supabase-server.ts`, and `wrangler.toml` contain no public service-role
binding. The previous production metadata review also found zero matching
browser assets and zero matching rendered HTML values. This review did not read
or mutate any Cloudflare value.

The active legal-consent and moderation modules use `requireEnv` only at client
construction. They do not return the binding value, log it, serialize it, or
place it in public errors. The rate-limit wrapper maps configuration, timeout,
transport, permission, and malformed-response failures to fixed internal error
codes; route callers map them to the fixed public `503` envelope.

## Gate Decision

Classification: `R6_GENERIC_PRIVILEGED_CLIENT_EXPOSURE_FOUND`.

There is no browser exposure, unauthorized fourth active consumer, or current
client-side import path. However, the following facts violate the R6 consumer
policy that every approved consumer must keep both the secret and raw
privileged client inside a narrow operation boundary:

1. `createLegalConsentServiceClient` is exported and returns `SupabaseClient`.
2. `functions/_lib/supabase.ts#createServiceClient` is an exported generic
   service-role factory, even though the current Astro Pages worker does not
   include the deprecated `functions/` directory.

The provisional exact paths are not an approval: legal-consent repository,
moderation notifications, and forum rate limit. The deterministic fixture
rejects a fourth path, a moved path, wildcard paths, and directory-wide
allowances. It will become the approved allowlist only after the two raw-client
findings are remediated and independently re-reviewed.

## Smallest Future Repository-Only Remediation

1. Replace the exported legal-consent raw-client factory with an internal
   client constructor and a single exported operation that accepts only the
   verified actor plus the validated legal-consent payload required by the
   fixed RPC. Keep the constructor and client type private.
2. Remove the deprecated `createServiceClient` export from
   `functions/_lib/supabase.ts`, or remove/quarantine that deprecated helper
   under a separately reviewed non-runtime cleanup. Do not reactivate the
   `functions/` directory.
3. Convert the provisional exact path list into the R6 approved allowlist only
   after static source, import-graph, browser-asset, rendered-HTML, legal
   consent, moderation, and rate-limit audits all pass.

No production SQL, binding mutation, deployment, merge, canary, grant, policy,
index, migration, or production-data operation is authorized by this record.
The existing production binding metadata remains
`PRODUCTION_BINDING_METADATA_READY`; R6 cannot continue to RPC execution while
this generic-client blocker remains.
