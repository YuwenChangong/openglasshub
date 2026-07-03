# Preview QA Safety

## Rules

- Preview uses production-equivalent runtime values.
- Disposable test data only.
- Never test destructive actions on real users or real content.
- No production migration from preview QA.
- Migration QA requires a confirmed non-production Supabase target.
- Never apply preview migration when the intended target ref matches the production ref.

## QA user cleanup

- Use dedicated disposable QA accounts only.
- Clean up preview QA accounts and content after test cycles.
- Treat posts, comments, circles, reports, and user safety writes as real shared-data risk.

## Safe cleanup notes

- Use the clear-warning cleanup route when warning-state cleanup is required.
- Do not use preview QA to rehearse destructive moderation or user-safety actions on real accounts.

## Preview Supabase requirement

- Preferred wiring: Cloudflare Pages Preview uses a dedicated preview or staging Supabase project.
- Production continues using the production Supabase project.
- If Pages Preview and production point at the same Supabase ref, preview browser QA must be treated as production-equivalent and schema migration QA must stop.
- A fresh Cloudflare deployment URL is more trustworthy than a stale branch alias when preview routing looks inconsistent.

## Required ref checks before migration

1. Identify the production Supabase ref from the production URL only.
2. Identify the intended preview or staging Supabase ref from preview-only env vars only.
3. Identify the locally linked Supabase CLI ref, if any.
4. Refuse migration if:
   - target ref equals production ref
   - linked CLI ref still equals production ref
   - the target environment cannot be proven non-production

## Guard command

Run this before any preview migration:

```powershell
node scripts/guard-preview-supabase-target.mjs ^
  --production-url "%PUBLIC_SUPABASE_URL%" ^
  --target-url "%QA_SUPABASE_URL%" ^
  --linked-ref "<linked-project-ref>"
```

The script prints refs only. It must fail closed when the target ref matches production.

## Operator checklist for safe preview DB setup

1. Create a separate Supabase project named `OpenGlass Hub Preview` or `OpenGlass Hub Staging`.
2. Record the new project ref and keep it distinct from production.
3. Link the Supabase CLI to the preview or staging project before running migrations.
4. Apply baseline migrations to the preview or staging project only.
5. Configure preview-only auth settings needed for disposable QA.
6. Configure preview-only Cloudflare Pages Preview vars and secrets by name:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `PUBLIC_SUPABASE_URL`
   - `PUBLIC_SUPABASE_ANON_KEY`
   - preview-only service-role secret if a QA script requires it
7. Leave Cloudflare production vars and secrets untouched.
8. Run the guard script again and confirm:
   - target ref != production ref
   - linked CLI ref != production ref
9. Use the fresh deployment URL for QA if the branch alias appears stale.
