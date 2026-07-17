# W6 Rate-Limit Trusted Server Identity Evidence

Status: `R6_STAGE1_BINDING_READY`. The exact binding name
is `EXISTING_BINDING_NAME_SOURCE_PROVEN`. Operator-held metadata-only Preview
proofs at source commit `b4f55642407420f56f0b677d4de37a4022fbfbff` establish
the transition from `BINDING_ABSENT` to `SECRET_BINDING_PRESENT` for the exact
Preview binding, with no plaintext, `PUBLIC_`, browser-exposed, or duplicate
metadata conflict. Preview is therefore
`PREVIEW_SERVICE_ROLE_BINDING_READY`. The proof files remain outside Git and
contain no value, hash, token, or credential.

Production binding metadata classification: `PRODUCTION_BINDING_METADATA_READY`.

## Client inventory

| Factory or route | Credential model | Current rate-limit use |
| --- | --- | --- |
| `src/lib/supabase-server.ts#createSSRClient` | Server anon key, no bearer | None; public SSR only. |
| `src/lib/server/admin-auth.ts#createUserClient` | Server anon key plus verified request bearer | Used indirectly by forum/admin routes, not a privileged rate writer. |
| Forum post, comment, circle, media-guard, and external-video routes | `SUPABASE_ANON_KEY` plus request `Authorization: Bearer ...` | All five current direct rate-limit paths. |
| `src/lib/server/legal-consent-repository.server.ts#createLegalConsentWriteRepository` | `SUPABASE_SERVICE_ROLE_KEY`, server-only | Actor-bound legal-consent RPC only; the client constructor is private. |
| `src/lib/server/moderation-notifications.server.ts#createModerationNotificationServiceClient` | `SUPABASE_SERVICE_ROLE_KEY`, server-only and lazy | Moderation notification RPC only. |
| `src/lib/server/consume-forum-rate-limit.server.ts#consumeForumRateLimit` | `SUPABASE_SERVICE_ROLE_KEY`, server-only and lazy | Fixed rate-limit RPC only. |
| `src/lib/supabase-browser.ts` | Public anon configuration | No `forum_upload_attempts` reference. |

The active Astro routes are under `src/pages/**`; the legacy `functions/`
directory is documented as inactive. No browser source directly calls
`forum_upload_attempts`.

## Binding evidence

`RuntimeEnv` is a generic string map, so it can represent an additional
server-only binding. The source already names `SUPABASE_SERVICE_ROLE_KEY` in
the two narrow factories above. That is only static evidence:

- `.env.example` does not document `SUPABASE_SERVICE_ROLE_KEY`.
- `wrangler.toml` declares preview and production public/anon Supabase values,
  but no service-role binding.
- `docs/ops/environment-and-secrets-checklist.md` does not list the key in its
  required preview or production secret lists.
- `docs/ops/legal-consent-predeployment-readiness.md` records only “Name
  found”, explicitly distinguishing static declaration from an operator-set
  value.
- Cloudflare Pages has runtime environment bindings in this project, but no
  checked-in evidence proves that this particular server-only secret is bound
  in preview or production.

The Preview and Production binding records can support the existing narrow
service-role operations, but metadata does not prove the secret value is
correct, belongs to the intended Supabase project, or is currently valid. Local
configuration remains unproven. The repository source boundary is
`R6_STAGE1_BINDING_READY`: legal-consent, moderation, and rate-limit consumers
are fixed-purpose server-only boundaries with no raw client export. Production
SQL and runtime deployment remain separately approval-gated.

## Consequence

The future function may grant execution only to the R1-proven trusted server
role. `service_role` is a candidate because three audited server operations
already use its key, but it is not approved for R6 execution without the next
separate Production SQL approval.
`PUBLIC`, `anon`, and `authenticated` remain ineligible.

The R1 binding contract, metadata-only proof specification, rotation plan, and
environment checklist are in the sibling
`operational-guardrails-service-role-binding-*.md` records. Their static test
proves that metadata proof does not authorize RPC SQL or unblock Stage C. The
next safe approval is `APPROVE_R6_CONTINUE_PRODUCTION_RPC_SQL_EXECUTION`; no
production secret change is required.
