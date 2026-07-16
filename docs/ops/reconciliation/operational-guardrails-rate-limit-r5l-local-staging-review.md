# W6 R5L Local Full-Stack Staging Review

Status: `R5L_BLOCKED_RUNTIME_READINESS`.

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

## Resolved public-error exposure

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

The approved route repair replaces those paths with the stable public
`EXTERNAL_VIDEO_UPLOAD_FAILED` response, logs only route-local redacted
metadata, and preserves the existing rate-limit `429` and `503` contracts. The
same deterministic test now injects message, code, details, hint, stack,
nested error, URL, UUID, IP-hash, signing, and service-role markers and fails
if any marker reaches a public response or log fixture. The source static guard
also rejects raw-error JSON, raw PostgREST fields, internal-stage JSON, direct
attempt-table access, generic privileged-client imports, and raw-error logging.

## R5L hard stop

The supported local Pages runtime cannot reach readiness with the generated
Astro Cloudflare Worker:

- `wrangler pages dev` re-bundles the emitted Worker and fails resolving Node
  `fs` from `detect-libc` in the generated dependency graph.
- the supported `--no-bundle` retry then refuses the generated Worker because
  it imports its emitted companion modules.

Both failures occur before a listener, HTTP request, Auth fixture, database
operation, or external request. Therefore the required actual local HTTP,
429/503, concurrency, secret-exposure, and residue suite cannot be reported as
verified. A separately reviewed local runtime packaging/harness fix is
required before another R5L attempt.

## Containment and cleanup

The local runtime attempts used only temporary configuration and a protected
route readiness probe. Their listener checks found no remaining listener and
their temporary directories were removed. No local Auth user, browser session,
business fixture, external request, or local configuration file was created or
retained.

The local RPC is removed again during R5L teardown so the pre-existing
normalized mirror returns to its observed pre-R5L function-absent state. The
shared Docker stack itself is deliberately not stopped or removed because it
predated this staging task and is not an R5L-created resource.

## Required next action

Create a separately reviewed local Cloudflare Pages harness or packaging fix
that can execute Astro's emitted multi-module Worker without introducing Node
runtime modules. Then rerun R5L from a clean local baseline. Remote Cloudflare
network, bindings, deployment, and environment behavior remain unverified.
