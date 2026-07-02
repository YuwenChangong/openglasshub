# Dependency Upgrade Window v1

## Scope

This window focused on low-risk dependency hardening only.

- No production deploy
- No production migration
- No production data writes
- No moderation, reports, user-safety, RLS, or privacy behavior changes intended

## Baseline Versions

- Branch: `hardening/dependency-upgrade-v1`
- Starting HEAD: `19b58ca75358780eef87f87168121796220301c8`
- Node: `v24.14.1`
- npm: `11.11.0`
- Wrangler before upgrade inventory: `4.59.2`

## Packages Upgraded

- `astro`: `5.18.1` -> `5.18.2`
- `@aws-sdk/client-s3`: `3.1057.0` -> `3.1078.0`
- `@aws-sdk/s3-request-presigner`: `3.1057.0` -> `3.1078.0`
- `@supabase/supabase-js`: `2.106.0` -> `2.110.0`
- `react`: `19.2.6` -> `19.2.7`
- `react-dom`: `19.2.6` -> `19.2.7`

## Targeted Overrides

- `vite`: `6.4.3`
- `wrangler`: `4.106.0`

## Packages Deferred

- `@astrojs/cloudflare` `12.6.13` -> `14.1.0`
  Deferred because current fixes require a major adapter jump and newer Astro peer line.
- `@astrojs/starlight` `0.33.2` -> `0.41.2`
  Deferred because it requires Astro 7 peer dependencies.
- `@astrojs/react` `4.4.2` -> `6.0.0`
  Deferred as a major integration upgrade outside this hardening window.
- `astro` `5.18.2` -> `7.0.5`
  Deferred because remaining Astro advisories require a major framework upgrade window.
- `sharp` `0.33.5` -> `0.35.3`
  Deferred because current build warning is known and non-blocking, and image/runtime behavior was intentionally left unchanged.
- `js-yaml`
  Deferred because the audit fix path is a major version move not justified for this narrow window.

## Audit Before / After

- Before: `12` total (`4 low`, `4 moderate`, `4 high`)
- After: `7` total (`5 low`, `1 moderate`, `1 high`)

## Outdated Before / After

Before:

- `@astrojs/cloudflare` `12.6.13` wanted `12.6.13`, latest `14.1.0`
- `@astrojs/react` `4.4.2` wanted `4.4.2`, latest `6.0.0`
- `@astrojs/starlight` `0.33.2` wanted `0.33.2`, latest `0.41.2`
- `@aws-sdk/client-s3` `3.1057.0` wanted `3.1078.0`
- `@aws-sdk/s3-request-presigner` `3.1057.0` wanted `3.1078.0`
- `@supabase/supabase-js` `2.106.0` wanted `2.110.0`
- `astro` `5.18.1` wanted `5.18.2`, latest `7.0.5`
- `react` `19.2.6` wanted `19.2.7`
- `react-dom` `19.2.6` wanted `19.2.7`
- `sharp` `0.33.5` wanted `0.33.5`, latest `0.35.3`

After:

- `@astrojs/cloudflare` `12.6.13` wanted `12.6.13`, latest `14.1.0`
- `@astrojs/react` `4.4.2` wanted `4.4.2`, latest `6.0.0`
- `@astrojs/starlight` `0.33.2` wanted `0.33.2`, latest `0.41.2`
- `astro` `5.18.2` wanted `5.18.2`, latest `7.0.5`
- `sharp` `0.33.5` wanted `0.33.5`, latest `0.35.3`

## Build Warnings Before / After

Warnings remained materially the same before and after the upgrade set:

- Cloudflare sharp runtime warning
- Vite Node built-in externalization warnings for `node:path`, `node:url`, and `node:fs/promises`
- Pagefind `DEP0190` warning
- Pagefind missing outer `<html>` notices for `/devices/` and `/google1930fde39281e043.html`

Additional non-risk note after upgrade:

- Astro reported `Astro version changed` and cleared the content store during build, which is expected after the patch update.

## Breaking Changes Checked

- Astro stayed on major `5`
- React stayed on major `19`
- Supabase stayed on major `2`
- AWS SDK packages stayed on major `3`
- Vite override stayed on major `6`
- Wrangler override stayed on major `4`
- No runtime secret, binding, or migration configuration changed
- Sensitive lexicon runtime loader remained R2-first with local/emergency fallback only

## Validation Commands And Results

- `npm run build`: PASS
- `npm test`: PASS
- `npm run smoke:production`: PASS
- `npm run test:reports`: PASS
- `npm run test:reports-audit`: PASS
- `npm run test:user-safety`: PASS
- `npm run test:user-safety-audit`: PASS
- `npm run test:sensitive-lexicon`: PASS
- `npm run test:openai-moderation`: PASS
- `npm run test:moderation-audit`: PASS
- `npm run test:profile-role-security`: PASS
- `git diff --check`: PASS
- `npm audit`: reduced from `12` to `7`
- `npm outdated`: improved to deferred major-only items plus `sharp`

## Preview Deploy QA

- Initial preview deployment URL: `https://a8161802.openglasshub.pages.dev`
- Initial preview alias URL: `https://dependency-upgrade-v1.openglasshub.pages.dev`

Initial preview result:

- Deploy command succeeded
- Required smoke checks failed
- `/`, `/feed/`, `/circles/`, `/api/forum/reports`, `/api/admin/reports`, and `/api/admin/moderation/lexicon-health` all returned `404`

Follow-up diagnosis:

- Local build output was verified as healthy:
  - `dist/_worker.js` was generated with the SSR and API routes bundled
  - `dist/_routes.json` included `/`, `/feed`, `/circles/*`, and `/api/*`
- Manual redeploy with local `wrangler@4.106.0` succeeded:
  - Deployment URL: `https://77f76222.openglasshub.pages.dev`
  - Alias URL: `https://dependency-upgrade-v1.openglasshub.pages.dev`
- One-off redeploy with `npx wrangler@4.59.2` also succeeded:
  - Deployment URL: `https://0bb64207.openglasshub.pages.dev`
  - Alias URL: `https://dependency-upgrade-v1-wrangl.openglasshub.pages.dev`
- Both fresh deploys passed the same route checks that had previously failed:
  - `/` -> `200`
  - `/feed/` -> `200`
  - `/circles/` -> `200`
  - `/api/forum/reports` -> `405`
  - `/api/admin/reports` -> `401`
  - `/api/admin/moderation/lexicon-health` -> `401`

Interpretation:

- The dependency upgrade output was not the root cause of the blanket `404` behavior.
- The most likely cause was a stale or bad preview deployment state on the earlier manual Pages deploy.
- Because both the current and prior Wrangler lines produced healthy preview deploys after redeploy, this did not reproduce as a durable `wrangler` version regression.

## Production Impact

- Production impact: none
- Production deploy performed: no
- Production migration run: no
- Production data touched: no
- Secrets exposed: no

## Future Upgrade Windows

### Astro Cloudflare Upgrade Window v1

- Upgrade `astro`
- Upgrade `@astrojs/cloudflare`
- Upgrade `@astrojs/starlight`
- Revalidate Cloudflare Pages runtime and preview deploy path together

### Wrangler Upgrade Window v1

- Keep `wrangler pages deploy dist --branch ...` as the manual preview path for the current Astro + Pages runtime output
- If blanket preview `404`s recur, treat stale/bad Pages preview state as the first recovery hypothesis and redeploy before widening scope

### Supabase Client Upgrade Window v1

- Revisit future `@supabase/supabase-js` minor releases after this branch lands
- Keep scope limited to client/runtime compatibility and auth/session regression testing
