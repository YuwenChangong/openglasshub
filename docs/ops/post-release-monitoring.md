# Post-release Monitoring

## First 24-48 hours

- Watch Cloudflare Pages deployment health and Pages Functions 500s.
- Watch Supabase auth and database errors.
- Watch `reports` and `report_events` creation volume and error spikes.
- Watch R2 lexicon health for `bindingPresent`, `source`, and `fallbackUsed`.
- Watch moderation queue volume for unexpected pending-review growth.
- Watch provider outage or fail-closed behavior for review spikes.
- Watch media upload failures and temp object accumulation.
- Watch user safety action audit trails for warning, suspend, ban, unban, and clear-warning actions.

## Specific checks

- Pages Functions 500 monitoring
- Supabase `reports` / `report_events` checks
- R2 lexicon health
- moderation queue volume
- provider outage / fail-closed behavior
- media upload errors
- user safety action audit checks

## Escalation

- If moderation provider failures spike, expect more content to fall into review rather than publish.
- If lexicon health falls back from R2 to emergency mode, treat it as an operations issue immediately.
