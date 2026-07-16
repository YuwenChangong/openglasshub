# W6 Service-Role Binding Contract

Binding-contract classification: `EXISTING_BINDING_NAME_SOURCE_PROVEN`.

The active Astro/Cloudflare server runtime contract uses exactly
`SUPABASE_SERVICE_ROLE_KEY`. `src/lib/server/legal-consent-repository.server.ts`
constructs `createLegalConsentServiceClient`; `src/lib/server/moderation-notifications.server.ts`
constructs the internal `createModerationNotificationServiceClient`. Both read
the key only through `requireEnv(env, ...)`, where route handlers receive `env`
from Cloudflare runtime locals. The key is runtime-read, not build-time captured.

`QA_SUPABASE_SERVICE_ROLE_KEY` occurs in isolated QA account scripts only. It is
not imported by active Astro routes and is not an alternative runtime binding.

The current callers are intentionally finite. `createLegalConsentServiceClient`
is reached only by `src/pages/api/legal/consent.ts` through its fixed
`record_current_legal_policy_acceptance` writer. The notification factory is
reachable only through the six verified moderator action routes: ban,
clear-warning, suspend, unban, warn, and report action. Each route creates the
notification writer after verified moderator authentication and legal-consent
checks. Neither factory provides generic table, storage, or arbitrary RPC access.

The `.server.ts` locations and API-only imports keep the two existing factories
out of client bundles. Client modules use only `import.meta.env.PUBLIC_*`
values. There is no `PUBLIC_SUPABASE_SERVICE_ROLE_KEY`, browser import, HTML
serialization, client JavaScript reference, logging call, or exception message
that includes the service-role binding. The generic Cloudflare runtime-env type
can carry the name, but no checked-in local example, preview binding, or
production binding proves it is configured.

The sole source-backed local mechanism is the untracked `.env` workflow
represented by `.env.example`; it currently omits this secret. Preview and
Production use Cloudflare Pages runtime locals, with nonsecret variables in
`wrangler.toml`. The repository's deployment documentation names `wrangler
pages secret list` and `wrangler pages secret put` as future operator tools, but
the current design neither invokes them nor assumes a binding exists. The name
is identical in every intended environment; only configuration evidence differs.

Approved scope is encrypted server-only secret storage. The binding must never
use a `PUBLIC_` prefix, be put in a plain variable, serialized, logged, sent to
analytics, placed in a fixture, command line, shell history, repository file,
chat, or screenshot. A future rate-limit path may receive only a narrow
preconstructed RPC wrapper after route authentication and authorization; it may
not receive the raw secret or expose a generic privileged client.
