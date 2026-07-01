# Deprecated Pages Functions

This directory is deprecated and non-runtime for the current Cloudflare Pages deployment.

- Active runtime routes live under `src/pages/**` and the deployed Astro/Cloudflare adapter output in `dist/`.
- Do not add new production functions here.
- Do **not** treat `functions/_lib/supabase.ts` service-role helpers as approved runtime code.
- See `docs/ops/deployment-playbook.md` for the active deployment path.
- Before enabling Cloudflare Pages Functions again, re-audit or remove this folder.
