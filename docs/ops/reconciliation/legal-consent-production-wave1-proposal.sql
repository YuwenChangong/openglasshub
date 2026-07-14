-- UNEXECUTED
-- NON_PRODUCTION_REVIEW_PROPOSAL
-- NOT FOR DIRECT PRODUCTION EXECUTION
-- REQUIRES FRESH PREFLIGHT OUTPUT AND HUMAN APPROVAL
--
-- Scope: metadata and ACL convergence only for the exact body-matched
-- public.insert_forum_notification(uuid, uuid, text, uuid, uuid, uuid) signature.
-- Preconditions are documentary: verified non-production target, attached fresh
-- preflight, matching normalized body hash, reviewed owner/overload/dependencies,
-- and confirmed backup/restore readiness are mandatory before any execution.

BEGIN;

ALTER FUNCTION public.insert_forum_notification(uuid, uuid, text, uuid, uuid, uuid) OWNER TO postgres;
ALTER FUNCTION public.insert_forum_notification(uuid, uuid, text, uuid, uuid, uuid) SECURITY DEFINER;
ALTER FUNCTION public.insert_forum_notification(uuid, uuid, text, uuid, uuid, uuid) SET search_path TO public, pg_temp;
REVOKE ALL ON FUNCTION public.insert_forum_notification(uuid, uuid, text, uuid, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.insert_forum_notification(uuid, uuid, text, uuid, uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_forum_notification(uuid, uuid, text, uuid, uuid, uuid) TO service_role;

COMMIT;
