-- UNEXECUTED R7 ONLY. Requires completed R6 and separate R7 approval.
-- Fresh preflight must prove no browser or runtime direct table SELECT/INSERT,
-- service_role RPC-only use, exact current policy fingerprints, no new grants,
-- and no conflicting policy. On ambiguity: stop; do not retry.
BEGIN;
DROP POLICY forum_upload_attempts_insert_self ON public.forum_upload_attempts;
DROP POLICY forum_upload_attempts_select_self ON public.forum_upload_attempts;
COMMIT;
-- Rollback requires separately reviewed CREATE POLICY definitions copied only
-- from the fresh preflight fingerprints; never reconstruct them from memory.
