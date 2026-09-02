# P8 repository remediation closeout

This closeout is based only on local repository, local Docker Supabase, and local browser evidence. No production connection, mutation, deploy, or migration-history query was performed.

- Dependency audit after the Astro 7 upgrade: 0 production vulnerabilities.
- Build target: Astro 7.2.10 with `@astrojs/cloudflare` 14.2.6; generated headers are verified at `dist/client/_headers`.
- Astro runtime migration: all former `locals.runtime.env` consumers use the supported `cloudflare:workers` `env` binding.
- Local P6B full evidence: run `03219ec3`, API 16/16 and UI 16/16 PASS, local cleanup PASS.
- Local P6C evidence: run `75c16a2d`, public lifecycle 16/16 PASS, local cleanup PASS.

## Migration-history boundary

The canonical directory has 35 SQL files, 19 unique versions, and 10 duplicate-version groups. `scripts/qa/p8-migration-history-report.mjs` records the deterministic local replay order (numeric version then filename), every member filename and SHA-256, and the three order-dependent groups. This is a local replay mechanism, not evidence of a hosted migration ledger.

`docs/ops/p8-production-history-read-only.sql` is the pre-authorized read-only collection packet for a future, explicitly authorized production review. It first discovers the migration-history schema rather than assuming columns, then gathers relevant public-object and policy/function definitions. A future authorized operator should also run `supabase migration list --linked --output json` and preserve the result with the packet output.

Current migration result: `PASS_REQUIRES_PRODUCTION_HISTORY`.
