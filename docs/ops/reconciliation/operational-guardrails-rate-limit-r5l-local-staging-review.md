# W6 R5L Local Full-Stack Staging Review

Status: `R5_LOCAL_STAGING_BLOCKED_RUNTIME_ERROR_SANITIZATION`.

This review is a local-only checkpoint. It does not create a Cloudflare
Preview deployment, bind any hosted Supabase project, or change the separate
`R5_PREVIEW_BLOCKED_TARGET_IDENTITY` status.

## Local baseline

The pre-existing Docker stack is the source-backed
`NORMALIZED_LOCAL_MIGRATION_MIRROR`. It has the forum schema, local Auth,
PostgREST, Storage, `forum_upload_attempts`, both reviewed indexes, RLS, and a
local `service_role`. It is not asserted to be production-equivalent.

The exact reviewed R2 proposal was verified by SHA-256
`10a1848e33097a9bb79e5cb1f1107a86bac6c724b352a13948665b90559011bb`, applied
only to that local PostgreSQL instance, and checked with the R5 catalog
postflight. The local postflight found one expected overload with the reviewed
owner, security-definer, search-path, and execute-ACL contract. No cloud
connection, SQL, secret, credential, or production data was used.

## R5L hard stop

`src/pages/api/forum/external-video-upload.ts` fails R5L's public error
sanitization requirement before authenticated fixtures or action tests can be
classified as successful:

- `formatDbError` copies PostgREST `message`, `code`, `details`, and `hint` to
  the public response at `post.lookup`.
- the top-level catch returns the thrown message and internal `stage` in the
  public response.
- `scripts/test-external-video-authorization-ordering.mjs` deterministically
  injects a PostgREST-shaped lookup error and proves all four database fields
  reach the HTTP response while no later Turnstile, rate-limit, R2-signing, or
  direct mutation effect occurs.

This violates the approved R5L requirement that no raw database or Supabase
error reaches a public response. It also means the required local HTTP,
429/503, concurrency, secret-exposure, and residue suite cannot be reported as
verified. A runtime sanitization change and review are required before a new
R5L attempt.

## Containment and cleanup

One credential-free local Worker startup smoke was attempted with temporary
configuration and a protected route. It did not reach readiness within its
bounded startup window. Its listener check found no remaining listener and its
temporary directory was removed. No local Auth user, browser session, business
fixture, external request, or local configuration file was created or retained.

The local RPC is removed again during R5L teardown so the pre-existing
normalized mirror returns to its observed pre-R5L function-absent state. The
shared Docker stack itself is deliberately not stopped or removed because it
predated this staging task and is not an R5L-created resource.

## Required next action

Create a separately reviewed runtime change that maps database and unexpected
exceptions in `external-video-upload.ts` to stable public error codes without
returning database messages, codes, details, hints, or internal stage names.
Then rerun R5L from a clean local baseline. Remote Cloudflare network,
bindings, deployment, and environment behavior remain unverified.
