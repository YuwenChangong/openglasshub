# W6 R5L Local Full-Stack Staging Review

Status: `R5L_LOCAL_HTTP_CORE_VERIFIED_FULL_MATRIX_PENDING`.

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

## 2026-07-16 multi-module harness correction

The readiness blocker was classified as `HARNESS_INVOCATION_DEFECT`. Astro
emits an advanced-mode ES-module Worker at `dist/_worker.js/index.js`, with a
490-module generated graph. `wrangler pages dev` re-bundles that graph and
fails while resolving `fs`; its `--no-bundle` mode rejects the Worker because
the entrypoint imports generated sibling modules. Neither behavior proves an
application `node:fs` runtime dependency.

The local-only replacement is `scripts/lib/r5l-pages-multimodule-harness.mjs`.
It loads every generated `.js` and `.mjs` module explicitly through Miniflare,
uses the checked-in compatibility date without adding `nodejs_compat`, permits
only loopback Supabase bindings, and starts an actual Worker listener on an
explicit loopback port. The artifact does contain the guarded local lexicon
fallback import from `src/lib/moderation/sensitive-lexicon-loader.server.ts`;
the local runner sets `SENSITIVE_LEXICON_DISABLE_NODE_LOCAL=true`, so that
fallback is not executed in the Worker request path. Browser assets are
checked for service-role material before startup.

A fresh normalized local stack and temporary local JWTs were used only to
prove actual Worker readiness: `/api/forum/search?q=open` returned `200`
through the built graph. The Worker and all ten normalized local Supabase
containers were then stopped, with no listener residue. No user, business,
RPC, migration, Preview, or Production operation occurred.

This is not the complete R5L HTTP staging matrix. The authenticated fixture,
rate-limit proposal/replay, route, failure-mode, and concurrency runner still
must be executed from a new clean local environment before claiming
`R5_LOCAL_STAGING_VERIFIED`.

## 2026-07-16 deterministic HTTP runner correction

The stopped probe was classified as `HTTP_RUNNER_TEMPLATE_SYNTAX_DEFECT`. A
large one-line ES module was generated inside a PowerShell here-string; the
parser stopped at its final response-sanitization expression with `SyntaxError:
missing ) after argument list`. The process failed before it started Miniflare
or sent an HTTP request, so it was not an authentication or route defect.

`scripts/run-operational-guardrails-r5l-http-suite.mjs` replaces that generated
source with a checked-in local-only module. Its static companion,
`scripts/test-operational-guardrails-r5l-http-runner.mjs`, runs `node --check`,
imports the module without starting services, rejects the historical malformed
template shape, and verifies local loopback binding construction. Ephemeral
credentials remain configuration inputs in ignored local files or process
memory and are never emitted by the runner.

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

Extend the checked-in local runner with the remaining real Worker-bound route,
fault-injection, and concurrency matrices, then rerun it from a fresh
normalized baseline. Remote Cloudflare network, bindings, deployment, and
environment behavior remain unverified.

## 2026-07-16 fresh normalized local core run

The checked-in R5L runner completed a fresh local run after the harness and
fixture corrections. It used only the stopped, ten-container
`NORMALIZED_LOCAL_MIGRATION_MIRROR`; it started the mirror, installed the
reviewed R2 proposal, created disposable local GoTrue users and application
fixtures, built the application, and served the emitted 490-module Worker on a
loopback listener.

The R2 proposal SHA-256 was exactly
`10a1848e33097a9bb79e5cb1f1107a86bac6c724b352a13948665b90559011bb`.
The local catalog check found the expected one function with `postgres` owner,
`SECURITY DEFINER`, volatile, parallel-unsafe, non-leakproof metadata. The
authenticated Worker route created one readiness post, accepted ten additional
post creations for a separate local user, and returned `429` for the eleventh.
The media guard accepted the one-byte boundary and rejected 157286401 bytes
before a reservation. Built Worker assets passed the service-role exposure
check. Fixture rows, the temporary R2 function, the Worker, and all running
mirror containers were removed or stopped; the final residue check passed.

This is deliberately not `R5_LOCAL_STAGING_VERIFIED`: the runner still needs
the complete application-boundary comment, circle, external-video, fault
injection, and concurrent HTTP matrices required by the R5L closure approval.
The existing R3 database-level concurrency simulation passed independently,
but it is not a substitute for those Worker-bound requests. Remote Preview
remains `R5_PREVIEW_BLOCKED_TARGET_IDENTITY`.

## 2026-07-16 expanded Worker-bound run

The same checked-in local runner was extended and run again from a clean,
stopped normalized mirror. The actual Worker accepted 60 comments and returned
`429` for the sixty-first without adding another comment; accepted five circle
creations and returned `429` for the sixth without adding another circle; and
accepted ten local external-video quota reservations, returned `429` for the
eleventh, and rejected the 157286401-byte request before quota continuation.
The Worker also returned a sanitized `503` with no ledger continuation when
the local R2 function was removed, then restored the exact reviewed R2 SQL
before continuing. Five simultaneous post requests with one quota slot left
returned exactly one `201` and four `429` responses.

The suite remains `R5L_BLOCKED_FAULT_INJECTION`: only the missing-function
fault is exercised through the Worker. The required execute-revocation,
malformed-result, timeout, transport, missing-binding, and trusted-client
faults, plus the remaining route-bound concurrency cases, must still execute
before R5L can be closed. This is a local-only verification gap, not evidence
of a production defect.
