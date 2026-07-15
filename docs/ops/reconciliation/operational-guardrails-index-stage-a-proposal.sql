-- UNEXECUTED. PRODUCTION_REVIEW_PROPOSAL. STAGE A ONLY.
-- NOT A CANONICAL MIGRATION. NOT MIGRATION-HISTORY REPAIR.
-- REQUIRES A FRESH MATCHING W6 INDEX EXECUTION PREFLIGHT.
-- Run this single statement outside every explicit transaction. Do not add
-- IF NOT EXISTS: a stale preflight must fail rather than silently mask drift.
CREATE INDEX CONCURRENTLY forum_upload_attempts_purpose_ip_created_idx
  ON public.forum_upload_attempts (purpose, ip_hash, created_at DESC);
