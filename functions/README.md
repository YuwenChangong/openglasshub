# Deprecated Pages Functions

This directory is deprecated and non-runtime for the current Cloudflare Pages deployment.

- Active runtime routes live under `src/pages/**` and the deployed Astro/Cloudflare adapter output in `dist/`.
- Do not add new production functions here.
- `functions/_lib/supabase.ts` retains only deprecated anon/user compatibility helpers; it contains no service-role client factory.
- See `docs/ops/deployment-playbook.md` for the active deployment path.
- Before enabling Cloudflare Pages Functions again, re-audit or remove this folder.
