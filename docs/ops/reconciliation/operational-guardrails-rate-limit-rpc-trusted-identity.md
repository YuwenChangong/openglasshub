# W6 Rate-Limit Trusted Server Identity Evidence

Status: `SERVICE_ROLE_CONFIGURATION_REQUIRED`. This is an offline source review,
not proof of a deployed secret and not authority to configure one.

## Client inventory

| Factory or route | Credential model | Current rate-limit use |
| --- | --- | --- |
| `src/lib/supabase-server.ts#createSSRClient` | Server anon key, no bearer | None; public SSR only. |
| `src/lib/server/admin-auth.ts#createUserClient` | Server anon key plus verified request bearer | Used indirectly by forum/admin routes, not a privileged rate writer. |
| Forum post, comment, circle, media-guard, and external-video routes | `SUPABASE_ANON_KEY` plus request `Authorization: Bearer ...` | All five current direct rate-limit paths. |
| `src/lib/server/legal-consent-repository.server.ts#createLegalConsentServiceClient` | `SUPABASE_SERVICE_ROLE_KEY`, server-only | Legal-consent RPC only. |
| `src/lib/server/moderation-notifications.server.ts#createModerationNotificationServiceClient` | `SUPABASE_SERVICE_ROLE_KEY`, server-only and lazy | Moderation notification RPC only. |
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

Therefore the approved server-only design cannot yet name a deployable trusted
execution identity. It must not reuse the anonymous bearer client, and it must
not assume that a service-role key is already installed. R1 requires a separate
operator/security approval for a server-only binding, with its name, scope,
rotation owner, preview policy, and production presence verified without
printing its value.

## Consequence

The future function may grant execution only to the R1-proven trusted server
role. `service_role` is a candidate because the two audited server factories
already use its key, but it is not approved for rate limits by this record.
`PUBLIC`, `anon`, and `authenticated` remain ineligible.
