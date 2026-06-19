# Deprecated `functions/` Risk Note

- Current Astro Cloudflare Pages deployment uses the generated worker output from `src/pages/api/**`.
- The legacy `functions/` directory is kept only as historical reference and is not the active production runtime path when the Astro worker build is deployed.
- `functions/_lib/supabase.ts` still contains a service-role helper; this is deprecated and must not be copied into active frontend or user-facing server routes.
- Before any future deploy workflow change, re-confirm that `functions/` is not attached as a live Pages Functions runtime.
- If the project ever migrates back to Pages Functions, delete or fully re-audit the deprecated service-role helper before deployment.
