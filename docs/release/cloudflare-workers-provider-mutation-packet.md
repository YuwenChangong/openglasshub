# Cloudflare Workers provider mutation packet

## Status and boundary

This is a value-blind, operator-facing sequencing packet. It records the
provider operations that may be considered only after a separately approved
execution authorization. It performs no operation and is not authorization for
a Cloudflare, Supabase, Git, DNS, Pages, Worker, Workers Builds, binding,
secret, database, deployment, or migration change.

`NO_MUTATION_AUTHORIZATION=true`

The repository's current default site origin remains the retained Pages origin.
No Worker endpoint is canonical, configured, or assumed available in this
packet.

`WORKERS_DEV_ENDPOINT_AVAILABILITY=UNKNOWN_REQUIRES_REVIEW`

## Verified facts and intentionally unasserted facts

| Field | Current disposition |
| --- | --- |
| CURRENT_WORKERS_DEV_SUBDOMAIN | `liujinyi081`, observed through the prior read-only account receipt; it is a shared account fact, not a desired brand target. |
| EXISTING_WORKER_SCRIPT_NAME | `heph-control-plane`, observed in the same read-only receipt. |
| EXISTING_PAGES_PROJECT_NAME | `openglasshub`, retained through W7. |
| PRODUCTION_BRANCH | `main`. |
| REVIEWED_BUILD_COMMAND | `npm run build`. |
| REVIEWED_DEPLOYMENT_COMMAND | `npx wrangler deploy`, only when provider-managed Workers Builds configuration supports the reviewed deployment contract. |
| GENERATED_CONFIGURATION_POINTER | `.wrangler/deploy/config.json`; it must resolve the generated Worker entrypoint and static-assets contract at execution time. |
| WORKER_NAME | Required W2 provider decision; no name is asserted by this packet. |
| WORKERS_DEV_ENDPOINT | Required provider-returned W2 result; no endpoint is asserted by this packet. |
| WORKERS_DEV_ENDPOINT_AVAILABILITY | `UNKNOWN_REQUIRES_REVIEW`; a script-list absence is not a reservation. |
| ACCOUNT_SUBDOMAIN_CHANGE_SAFE | `false` until an explicit impact review covers every existing Worker URL; this packet never changes the account subdomain. |
| REQUIRED_NODE_NPM_RUNTIME | Provider-verifiable reviewed runtime selection; no provider value is asserted by this packet. |

## Source identity stop gate

Each source value below must be captured as one lower-case, full 40-character
Git object ID immediately before W4 and again before W6. The local pure guard
`buildWorkersReleaseGuard` must return `PASS`; any missing, abbreviated, or
different value is a hard stop.

| Required identity field | Required equality |
| --- | --- |
| REMOTE_MAIN_SHA | Equal to CANDIDATE_SHA. |
| CANDIDATE_SHA | Equal to PROVIDER_SOURCE_SHA and ACTIVE_SOURCE_SHA. |
| PROVIDER_SOURCE_SHA | Equal to the provider's Workers Builds source-commit metadata. |
| ACTIVE_SOURCE_SHA | Equal to the active Worker version source metadata. |

No source identity is asserted in this packet because candidate identity is
defined only by the final reviewed branch state. A source mismatch blocks W4,
W5, W6, W7, and W8 progression. It never triggers a deployment retry or a
remote-main write.

## Required binding-name comparison

W2 compares provider configuration value-blind against the repository
inventory. Runtime-required rows must be `PRESENT_MATCHING_NAME` before W4.
The initial persistent binding names are `MODERATION_ASSETS` for R2 and
`SESSION` for KV. Existing runtime environment and secret names are compared
by name only using the W1 inventory; this packet neither reproduces nor
requests their values. No D1, Durable Object, service, analytics, or other
persistent binding may be invented.

## Controlled stages

| Stage | Separately authorized provider operation | Required evidence before advance | Required recorded fields | Stop and recovery boundary |
| --- | --- | --- | --- | --- |
| W2 | Create or configure the selected Worker and Workers Builds project; attach only the reviewed binding names. | Fresh account-subdomain and script impact review, complete value-blind binding diff, reviewed candidate source identity. | WORKER_NAME, provider-returned WORKERS_DEV_ENDPOINT, repository identity, PRODUCTION_BRANCH, REVIEWED_BUILD_COMMAND, REVIEWED_DEPLOYMENT_COMMAND, GENERATED_CONFIGURATION_POINTER, generated entrypoint, runtime selection, binding-name classifications. | No URL, Auth, Pages, DNS, or canonical-origin change. If safe naming cannot be decided, stop for operator direction. |
| W3 | Add the verified Worker endpoint to Supabase Auth redirect and equivalent allow lists. | W2 endpoint receipt, provider/Auth owner confirmation, Pages URL retained. | WORKERS_DEV_ENDPOINT, legacy Pages retention proof, Auth setting owner, additive change receipt. | Additive entries only. Do not change primary Site URL, credentials, schema, or database state. |
| W4 | Run the first Workers Builds deployment for the reviewed source. | All source identity fields equal, all runtime-required binding rows `PRESENT_MATCHING_NAME`, W3 receipt. | REMOTE_MAIN_SHA, CANDIDATE_SHA, PROVIDER_SOURCE_SHA, active version identifier, ACTIVE_SOURCE_SHA, deployment timestamp, sanitized build result. | Pages remains primary. Correct a rejected Worker candidate without retrying unreviewed source. |
| W5 | Run non-destructive acceptance and observability checks against the exact Worker endpoint. | W4 source identity and deployment receipt. | Request class, source/version identity, status class, runtime exception count, binding-exception count, sanitized acceptance receipt. | Do not change canonical origin. Preserve Pages fallback; no database, R2 bulk-copy, or schema action. |
| W6 | Promote the Worker endpoint as primary Site URL, application base, and canonical/SEO origin. | Complete W5 receipt, all four source identities equal, explicit promotion authorization. | Promotion authorization reference, prior Pages primary state, new provider setting receipt, canonical/SEO verification result. | Restore the prior provider URL configuration only through a separately reviewed rollback; never roll back database, R2, or migration history. |
| W7 | Retain Pages compatibility while observing the Worker as primary. | W6 receipt and a defined observation window. | Error, Auth, callback, redirect, SEO, and runtime observation evidence; continued Pages availability. | Keep additive compatibility entries. A Worker problem requires explicit W6 rollback authorization. |
| W8 | Optionally retire Pages URL/settings/project dependencies. | Zero-dependency inventory and a new explicit operator authorization distinct from cutover. | Dependency inventory, authorization reference, retirement receipt. | Stop if any redirect, email, OAuth, CORS, webhook, or callback remains dependent on Pages. |

## Non-negotiable exclusions

- No account-wide workers.dev subdomain rename.
- No direct deployment, remote-main push, Pages deployment retry, DNS change, or
  legacy Pages deletion within this packet.
- No Supabase schema/data migration, database connection, SQL, P10
  reconciliation replay, or P11 history-registration retry.
- No credential value, token, environment value, or secret material is recorded
  here. Verified non-secret resource identifiers may be recorded only when
  needed for scope or impact review; they are not credentials, deployment
  targets, or authorization to mutate a provider resource.
- W8 is not implied by W2 through W7 and requires a separate authorization.

## Operator completion receipt

An authorized future execution may append a separate value-blind receipt only
after each controlled stage. That receipt must include the required identity
fields, stage-specific proof, zero unapproved-mutation count, and the decision
to stop or advance. It must not change this packet into a deployment command or
copy any credential material.
