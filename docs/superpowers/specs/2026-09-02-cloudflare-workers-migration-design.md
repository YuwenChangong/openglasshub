# OpenGlass Hub Cloudflare Pages to Workers Migration Design

## 1. Context and root cause

OpenGlass Hub is an Astro 7 SSR application whose production Pages deployment is blocked. The prior Pages build generated `.wrangler/deploy/config.json`, which redirected Wrangler to `dist/server/wrangler.json`. That generated configuration combines the root Pages field `pages_build_output_dir` with Astro's Workers SSR fields including `main`, `rules`, and the reserved `ASSETS` binding. Cloudflare Pages rejects that mixed contract.

The complete forensic result is `PAGES_CONFIG_SOLUTION_MODE=MIGRATION_TO_WORKERS_REQUIRED`. Current Astro documentation states that the `@astrojs/cloudflare` adapter no longer supports Cloudflare Pages; it targets Workers. This migration preserves the current Astro 7 runtime instead of downgrading Astro or attempting to rewrite the application into Pages Functions.

The authoritative pre-migration source is remote `main` commit `e2f45dac135edfc10d866fc83df05c0590c1adb9`. The existing Pages project `openglasshub` and `https://openglasshub.pages.dev` remain untouched until a separately authorized retirement.

## 2. Current architecture and constraints

Current production delivery is `main -> Cloudflare Pages Git integration -> Pages production`. The application relies on Astro SSR, `cloudflare:workers`, on-demand pages, roughly fifty `src/pages/api` routes, R2/media behavior, Supabase Auth/data access, forum, notifications, news, administration, Device Library, and Gaze Launcher surfaces.

The repository contains a small `functions/` directory, but it is not a replacement deployment artifact: it covers only a subset of forum endpoints. The canonical build emits `dist/server/entry.mjs` plus server chunks and a Worker-oriented generated Wrangler configuration; it does not emit a complete Pages advanced-mode `_worker.js` artifact or a complete Pages Functions equivalent. A Pages-only metadata workaround would therefore lose SSR/API coverage.

Global constraints for every migration stage:

- No Supabase schema/data migration, no `supabase db push`, no migration repair, and no P10/P11 replay.
- `P10_RECONCILIATION_REPLAY_ALLOWED=false` and `P11_HISTORY_REGISTRATION_RETRY_ALLOWED=false` remain immutable.
- No secret values are committed, printed, or copied into documentation.
- Initial cutover is parallel and reversible: Pages remains available until later explicit retirement authorization.
- Provider writes are staged and separately authorized; no single operation combines Worker provisioning, URL changes, and traffic promotion.

## 3. Target Workers architecture

The intended delivery contract is:

```text
Git main
  -> Cloudflare Workers Builds / repository integration
  -> npm run build (Astro 7)
  -> generated Astro Worker SSR artifact and generated deploy redirection
  -> Workers-native Wrangler deployment
  -> Worker workers.dev URL
  -> optional custom domain later
```

The Worker owns all existing Astro server routes. The build must retain the generated Worker deployment configuration rather than applying the prior Pages finalizer. Workers-native configuration accepts the Worker `main`, asset directory/binding, module rules, runtime bindings, and generated redirection that Pages rejected.

The future canonical configuration is Workers-native and must not contain `pages_build_output_dir`. The implementation must choose one configuration format only (prefer `wrangler.jsonc` for a new Workers source-of-truth configuration) and must validate it with the installed Wrangler schema and `wrangler check`. The source configuration supplies the project name, compatibility settings, persistent bindings, and environment declarations; Astro/Vite produces the deployable output configuration and `.wrangler/deploy/config.json` resolves the exact generated artifact for deployment.

Before W2, the implementation must prove from the installed Astro 7 adapter and a fresh build:

1. the generated Worker entrypoint referenced by the selected configuration;
2. the generated static-assets directory and `ASSETS` binding;
3. that `npm run build` no longer runs the Pages-only config mutation;
4. that `npx wrangler check` follows the generated redirection and validates the Worker contract; and
5. that `wrangler deploy --dry-run` performs no remote deployment and reports the same selected artifact.

## 4. Free URL strategy and account-subdomain safety

The preferred future URL is `https://app.openglasshub.workers.dev`, formed by Worker name `app` plus account subdomain `openglasshub`. Its availability is **not proven** and this design does not authorize changing the account-wide subdomain.

The read-only design inventory found an existing unrelated Worker on the account. A workers.dev account subdomain is shared by every Worker URL, so changing it can affect that existing Worker. W2 must repeat and record the following read-only inventory immediately before any account-subdomain proposal:

| Read-only check | Evidence required | Decision rule |
| --- | --- | --- |
| `GET /accounts/{account_id}/workers/subdomain` | current subdomain only | Never change it without an explicit impact review for every existing Worker. |
| `GET /accounts/{account_id}/workers/scripts` | script names and each script's workers.dev enablement | Determine every URL that an account-subdomain change would alter. |
| `GET /accounts/{account_id}/workers/scripts/{script_name}/subdomain` for each script | enabled/previews-enabled state | Include active and preview URLs in the impact review. |
| Worker-name collision check | presence or absence of the candidate script name | A name is available only when provisioning accepts it; absence from a list is not a reservation. |

The safe free fallback does **not** change the account subdomain. It uses a brand-oriented Worker name such as `openglasshub-app`, yielding `https://openglasshub-app.<existing-account-subdomain>.workers.dev` only after W2 confirms that name and endpoint. The existing account subdomain is not a desired brand target and is intentionally not committed as one. If neither preferred nor fallback can be safely provisioned, W2 stops for operator naming direction; it must not rename unrelated Workers or change the shared subdomain.

## 5. Git and Workers Builds deployment model

The desired production branch remains `main`. W2 configures a new Worker/Workers Builds project; it does not modify the Pages project's branch integration. The provider configuration must record:

- repository and production branch: `main`;
- build command: the repository's reviewed canonical `npm run build` after W1 removes the Pages-only finalizer;
- deployment command: Workers-native `npx wrangler deploy`, provider-managed when Workers Builds supports it;
- Worker name selected under the W2 URL decision;
- generated configuration selection path and resolved Worker entrypoint;
- required Node/npm runtime version; and
- an auditable source-commit field or deployment metadata.

Every release receipt must prove `remote main SHA = Workers Builds source SHA = active Worker version source SHA`. A mismatch blocks URL promotion. No main push, direct deploy, or Pages deployment retry is part of this design stage.

## 6. Binding and environment inventory strategy

W1 creates a value-blind inventory from `wrangler.toml`, generated Worker configuration, source imports, and the pre-existing provider configuration. Each row uses this mapping:

| Current Pages binding or environment name | Required Worker name | Type | Required stage | Migration action |
| --- | --- | --- | --- | --- |
| `MODERATION_ASSETS` | `MODERATION_ASSETS` | R2 binding | runtime | Bind the existing R2 resource; do not copy objects. |
| `SESSION` | `SESSION` | KV binding | runtime | Bind the existing namespace in every required Worker environment. |
| `SUPABASE_URL`, `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY` | unchanged names | runtime environment variables | build and runtime according to use | Copy names and values only through approved provider secret/environment workflow; never commit values. |
| `SUPABASE_ANON_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | unchanged names where provider configuration already supplies them | secret/runtime environment variables | runtime | Inventory provider presence value-blind; preserve privilege separation. |
| `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_PUBLIC_BASE_URL` | unchanged names | runtime environment variables | runtime | Preserve existing media endpoint behavior. |
| `PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `UPLOAD_TURNSTILE_MODE`, `DEV_TURNSTILE_BYPASS` | unchanged names | public variable, secret, and runtime flags | build and runtime | Preserve current production/preview distinction. |
| `OPENAI_*`, `MODERATION_*`, `VIDEO_POST_*` | unchanged names | moderation runtime configuration and secret references | runtime | Carry all current names with existing failure-mode semantics. |
| `PUBLIC_LEGAL_OPERATOR_NAME`, `PUBLIC_SUPPORT_EMAIL`, `PUBLIC_ABUSE_EMAIL`, `PUBLIC_PRIVACY_EMAIL`, `PUBLIC_IP_EMAIL` | unchanged names | production public variables | build and runtime | Preserve public legal/contact rendering. |

The literal names above are an initial repository inventory, not evidence that every provider value is currently set. W2 must compare the value-blind worker inventory with the Pages production and preview inventories, classify each row as `PRESENT_MATCHING_NAME`, `MISSING`, `EXTRA`, or `UNKNOWN_REQUIRES_REVIEW`, and block W4 when a runtime-required row is not `PRESENT_MATCHING_NAME`.

No D1, Durable Object, service binding, analytics binding, or additional persistent resource may be invented. W1 inventories their actual use and records `ABSENT` only when both repository configuration and source use are absent. Compatibility date and flags are copied as reviewed runtime settings, then verified against the current Astro and Cloudflare documentation before W2.

## 7. URL and origin migration inventory

W1 runs a value-blind repository search plus W2/W3 provider read-only inventory for every dependency on `https://openglasshub.pages.dev`. Each hit is classified exactly once:

| Location class | Known repository examples | Required classification/action |
| --- | --- | --- |
| Runtime canonical URL | `astro.config.mjs` site setting; sitemap generation | `SWITCH_AFTER_WORKER_PASS`; introduce one reviewed site-URL source instead of scattered literals. |
| Crawl/indexing policy | `public/robots.txt`, canonical/Open Graph generation, sitemap, search tooling | `SWITCH_AFTER_WORKER_PASS`; verify the new Worker URL first. |
| Production smoke defaults | `scripts/smoke-production.mjs`, `scripts/post-launch-check.mjs`, package scripts | `ADD_NEW_URL_FIRST`; accept an explicit target URL while Pages remains default until W6. |
| Docs, audits, and historical receipts | release/readiness/SEO documentation and fixtures | `KEEP_UNCHANGED` if historical; `REMOVE_OLD_LATER` only in a separately reviewed current-operations document. |
| External auth/provider settings | Supabase Site URL, redirect URLs, OAuth/email templates, CORS, webhook callbacks | `EXTERNAL_PROVIDER_WRITE_REQUIRED`; inspect and change only in W3/W6. |
| Unclassified occurrence | any new literal, environment name, or provider setting | `UNKNOWN_REQUIRES_REVIEW`; it blocks the phase that would make the URL canonical. |

The inventory explicitly includes Auth Site URL and redirect URLs, email confirmation/password-reset redirects, OAuth callbacks, `SITE_URL`/`APP_URL`/`PUBLIC_SITE_URL` style names, CORS/CSP/connect policies, webhook callbacks, admin/notification links, Gaze Launcher links, search/indexing URLs, Open Graph/canonical URLs, tests, fixtures, and docs. Tests and historical documents are not production configuration merely because they contain the old URL.

## 8. Supabase Auth dual-URL transition

No Supabase database or Auth data migration is needed. The sequence is additive:

1. W3 reads existing Auth Site URL and redirect URLs, value-blind where required, and records their owner.
2. W3 adds the verified Worker URL to allowed Redirect URLs while retaining the Pages URL. It does not change Site URL.
3. W4/W5 verify signup, login, callback, confirmation, password reset, logout, protected routes, and safe continuation handling on the Worker URL.
4. Only after W5 passes, W6 changes primary Site URL/application base/canonical URL to the Worker URL.
5. The Pages URL remains allowed for the W7 observation window. Removal is a separately authorized W8 action after evidence that no active redirect, email, OAuth, CORS, or callback still needs it.

The application must preserve existing session validation and redirect-safety behavior. An Auth failure before W6 leaves the Pages URL primary and prohibits a database change or automatic credential reset.

## 9. SSR, API, R2, and media preservation

Workers deploy the generated Astro SSR entrypoint and all imported server chunks. W1 creates provider-shaped tests that verify the selected generated Worker configuration references a real entrypoint and static-assets directory, contains Worker `main`/assets/rules as appropriate, and has no `pages_build_output_dir`.

Acceptance must cover all Astro on-demand routes, not only the legacy `functions/` subset. The Worker runtime must preserve `cloudflare:workers` imports, Supabase runtime variables, `MODERATION_ASSETS`, `SESSION`, Device Library database-backed pages, forum and admin APIs, and media endpoints.

R2 data stays in place. W2 binds the existing resource by name/identifier after a value-blind equivalence check. W5 exercises non-destructive reads and authorized test fixtures only: post media, avatar/banner media, signed-media delivery, object authorization, and upload/delete behavior in approved disposable paths. It never bulk-copies or replays R2 data.

## 10. Controlled provider-write stages

| Stage | Authorized change | Required proof before advancing | Failure response |
| --- | --- | --- | --- |
| W1 Repository preparation | Workers-native config, build/finalizer changes, value-blind inventory, tests, local commit | local build, Worker config validation, full existing test gates | no provider change; fix branch only |
| W2 Provider Worker preparation | create/configure Worker and Workers Builds; bind exact reviewed names | account-subdomain impact review, binding diff is complete, reviewed source SHA | no URL/Auth cutover; Pages stays unchanged |
| W3 Auth/URL additive preparation | add Worker URL to redirect/allow lists and equivalent additive policies | exact Worker URL is known; Pages URL retained | revert only additive URL entry if necessary; no DB action |
| W4 Workers preview/initial deploy | deploy exact reviewed source through Workers Builds | source SHA identity and all bindings confirmed | Pages remains primary; correct Worker candidate |
| W5 Workers acceptance | non-destructive production smoke/observability checks | complete acceptance matrix passes | do not change canonical URL |
| W6 Primary URL cutover | switch canonical Site URL/app base/SEO primary URL | W5 receipt plus explicit promotion authorization | restore prior URL/provider configuration; no schema rollback |
| W7 Legacy observation | retain Pages URL and compatibility allowlists | error/auth/SEO observation evidence | Worker remains primary unless W6 rollback is authorized |
| W8 Optional legacy retirement | remove old Pages URL/settings or project only with new authorization | zero-dependency inventory and operator approval | stop; retain legacy state |

## 11. Production acceptance matrix

W5 uses exact Worker URL, read-only or existing approved test identities, and no database/schema mutation. Each check records request URL, source/version identity, status, sanitized result class, and runtime exception count.

| Area | Non-destructive acceptance |
| --- | --- |
| Home/SSR | `/` returns a rendered response; no Worker exception. |
| Auth | login page, callback architecture, authenticated session, logout, reset redirect architecture, protected-route behavior. |
| Forum | public forum, feed, post detail, comments, search, and authorization-denied paths. |
| Device Library/Product | `/devices`, selected device detail, `/products`, dynamic published product data, compatibility surfaces. |
| Media | public/signed post media, avatar/banner delivery, authorization rejection, approved disposable upload/delete flow where authorized. |
| News/User | news list/detail API, profile, summary, notification privacy and ownership behavior. |
| Search/SEO | forum/device search, sitemap, robots, canonical and Open Graph origin. |
| Gaze/Admin | Gaze Launcher visibility/access; admin page and safe authorization-denied/authorized visibility checks without mutation. |
| Runtime | no missing `cloudflare:workers` binding, no R2/KV binding exception, no unhandled Worker exception. |

## 12. Security invariants and database freeze

The transport/runtime migration must preserve all P7 outcomes: RLS, session validation, admin/moderator authorization, notification and profile ownership, media authorization, staff/public news separation, legal-consent guards, and existing Auth redirect safety. A successful HTTP response is insufficient when it bypasses one of these controls.

This migration has no database component. It must not run `supabase db push`, `supabase migration up`, `supabase migration repair`, P10, P11, historical migration repair, DDL, DML, or Production PostgreSQL commands. Existing production schema/history reconciliation remains authoritative.

## 13. Failure and rollback model

- **Worker build failure before W6:** retain Pages unchanged; correct only the Worker branch and repeat local/Worker validation.
- **Worker smoke failure before W6:** Worker is not canonical; investigate the specific route/binding/auth issue while Pages remains primary.
- **Failure after W6:** use a separately reviewed provider rollback runbook to restore the preceding Site URL, application base URL, canonical/SEO origin, and any additive allowlist ordering necessary for the old Pages URL. Do not rollback database state, R2 objects, or migration history.
- **Account-subdomain risk discovered:** do not rename the account subdomain; use the W2 fallback naming decision or stop for operator direction.

## 14. Legacy Pages retention policy

The `openglasshub` Pages project and `https://openglasshub.pages.dev` remain available as a legacy/fallback reference during W1-W7. It receives no new reconciliation, deployment retry, or database work as part of this migration. W8 is the only stage that may remove legacy compatibility references, and it requires explicit authorization distinct from Worker cutover.

## 15. Exact success criteria

The migration is eligible for implementation planning only when this design is committed and all statements below remain true:

- The target runtime is Cloudflare Workers and target delivery is Workers Builds.
- The preferred `https://app.openglasshub.workers.dev` is an unproven preference, not an assumed available URL.
- Account-subdomain inventory is mandatory before any account-wide change; current evidence requires it because another Worker exists.
- A Worker-native build produces a valid SSR entrypoint and assets contract with no Pages-only deployment field.
- Every runtime binding/environment name has a value-blind migration row and no required name silently disappears.
- Supabase uses a dual-URL, additive-first Auth transition; no database migration is required.
- Pages remains retained until explicit W8 retirement authorization.
- Source SHA identity is provable from `main` through Workers Builds to the active Worker version.
- W5 passes the full acceptance matrix without security regression or runtime binding exception.

## 16. Repository implementation surfaces to verify in W1

W1 begins with the following repository map. It must inspect each path before modifying it and leave unrelated release evidence untouched.

| Path | Current responsibility | W1 decision |
| --- | --- | --- |
| `wrangler.toml` | Pages source configuration, Pages output field, production/preview binding declarations | Replace or migrate deliberately to one Workers-native source-of-truth configuration; remove `pages_build_output_dir`; preserve the value-blind binding-name inventory. |
| `astro.config.mjs` | Astro 7 Cloudflare adapter, current site origin, SSR/static behavior | Preserve the adapter and SSR configuration; change the canonical site origin only after W5/W6 authorization. |
| `package.json` | canonical build and release/test scripts | Remove the Pages-only post-build finalizer from `build`; add Workers-native config/artifact tests only after their RED proof. |
| `scripts/finalize-pages-wrangler-config.mjs` | old narrow Pages `ASSETS` metadata mutation | Delete or retire only as part of W1 after its replacement Worker artifact test passes; it must not mutate a Workers deploy config. |
| `scripts/test-cloudflare-pages-wrangler-config.mjs` and any successor generated-config test | Pages contract regression | Replace with a complete Workers artifact/config selection regression, including source config, generated redirect, `main`, asset binding/directory, and prohibition of `pages_build_output_dir`. |
| `functions/` | legacy partial Pages Functions source | Keep unchanged unless an independently scoped cleanup is authorized; do not mistake it for the Astro Worker output. |
| `public/robots.txt`, sitemap/canonical helpers, `scripts/smoke-production.mjs`, `scripts/post-launch-check.mjs` | current Pages URL and operational checks | Parameterize and classify URL use; switch their defaults only in W6 after Worker acceptance. |
| `src/pages/**`, `src/lib/**` | SSR/API routes and runtime binding consumers | No route rewrite in W1; use these paths to generate binding and acceptance inventories. |
| `docs/release/**`, `docs/production-readiness-gate.md`, `docs/seo-checklist.md` | historical/current release and URL documentation | Preserve historical evidence; update only current operational guidance at the phase authorized for cutover. |

## 17. Explicit non-goals

- Implementing the migration in this design change.
- Creating, deploying, or configuring a Cloudflare Worker or Workers Builds project.
- Pushing `main`, retrying Pages deployment, or changing DNS/custom domains.
- Changing account-wide workers.dev subdomain, Supabase Auth settings, secrets, bindings, database state, R2 data, or Cloudflare Pages settings.
- Downgrading Astro, converting the application into Pages Functions, or deleting the legacy Pages project.
