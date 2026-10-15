# Disposable Local User E2E

Use this only from `C:/Temp/ogh-product-beta-development-20261013` with Windows
Docker Desktop, the pinned repository Supabase CLI, installed Chrome and OpenSSL.
No remote project link, Production environment, account, or key is required.

```powershell
node scripts/qa/run-local-user-e2e.mjs --prepare
node scripts/qa/run-local-user-e2e.mjs --run
```

Preparation creates a fresh owned project outside the repository, using ports
56320-56329 and a unique project ID. Supabase refuses port conflicts; it must
not reset or reuse another project. The 50-file historical mirror is unchanged;
three newer committed migrations are copied separately, giving 53 migrations.
All SQL executes through the exact fresh database container's Unix socket.
Reported API/database/Storage targets are required to be local. API clients use
only that newly-created target; inherited provider/database credentials are not
passed to child commands. Current Windows Docker context must use a named pipe.

Three random local actors are created through the owned instance's Auth admin
API. ADMIN uses the existing trusted `qa_grant_admin_role` function, not client
metadata. Credentials and local API keys are encrypted with the existing
CurrentUser DPAPI helper in `.local-e2e/<run-id>/state.dpapi`, with owner/SYSTEM
DACL. This directory is git-ignored. Never print it or export browser storage.

The fixture uses repository-public catalog data, not Production downloads.
Only xreal-air is published. The existing canonical catalog import helper's
local activation and hardening SQL reproduce the exact original read plan.
Legal acknowledgement rows are seeded; this is not legal-consent UI acceptance.

The canonical migrations omit `consume_forum_rate_limit`. The local fixture
therefore uses the existing R3-tested proposal SQL with fixed SHA256
`10a1848e33097a9bb79e5cb1f1107a86bac6c724b352a13948665b90559011bb`.
This is explicitly a LOCAL TEST DEPENDENCY, not a canonical migration, evidence
of Production parity, or permission to execute a proposal remotely. Its actual
quota implementation and service-only grants are retained, not replaced by an
always-allow mock. A random rate-limit salt and the freshly-generated local
service key are supplied only to the local server's in-memory bindings.

Astro uses its existing guarded `build-workers.mjs --local-config` entrypoint.
Wrangler runs the built application locally with watch/live reload disabled,
an owned temporary TLS certificate and no remote mode. Its outbound transport
reuses the existing hop-by-hop header/body adapter and rejects nonlocal targets.
Playwright runs headless, using three isolated contexts and loopback-only HTTP
routing. This is not a full-browser security-containment claim.

CAPTCHA is off only in this disposable configuration; no Production CAPTCHA
claim is possible. Moderation uses the application's existing `local_only_safe`
fallback, with no paid provider. External AI moderation is not accepted by this
test. RLS assertions use real anon/authenticated credentials, never service-role
HTTP queries. The frozen original 16-read validator is imported unchanged.

`--run` writes scoped safe results under `output/playwright/local-supabase-e2e`.
Tests can PASS, FAIL, BLOCKED or NOT_RUN. A missing local dependency does not
authorize changing Production, granting database access, or faking success.
Screenshots contain blank anonymous forms or synthetic local fixtures, not
real user credentials. Browser/context storage, HAR and raw auth traces are not
exported. Secret-value checks precede the final report write.

Cleanup stops only the exact owned project with `--no-backup`, verifies no owned
containers/volumes remain, and deletes encrypted identities and temporary TLS
keys. Source scripts and nonsecret generated config/migration mirror remain
reusable. After an interrupted process, clean the owned instance explicitly:

```powershell
node scripts/qa/run-local-user-e2e.mjs --cleanup
```

Development-only `OGH_E2E_REUSE_RUN=<same-task-run-id>` and `OGH_E2E_ONLY=<ids>`
support bounded followups. Every reused result retains its actual evidence run;
reuse is appropriate only when application source, relevant schema and fixture
semantics are unchanged. Never use those switches to imply a fresh full run.
No old Native QA authorization, Claim, control window or GO is used.

CLI lifecycle reference: [Supabase local development](https://supabase.com/docs/guides/local-development/cli/getting-started).
