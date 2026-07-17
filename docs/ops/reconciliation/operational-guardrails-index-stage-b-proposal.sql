-- UNEXECUTED. PRODUCTION_REVIEW_PROPOSAL. STAGE B ONLY.
-- NOT A CANONICAL MIGRATION. NOT MIGRATION-HISTORY REPAIR.
-- REQUIRES A FRESH MATCHING W6 INDEX EXECUTION PREFLIGHT and verified Stage A.
-- Run this single statement outside every explicit transaction. Do not add
-- IF NOT EXISTS: a stale preflight must fail rather than silently mask drift.
CREATE INDEX CONCURRENTLY forum_upload_attempts_purpose_user_created_idx
  ON public.forum_upload_attempts (purpose, user_id, created_at DESC);
