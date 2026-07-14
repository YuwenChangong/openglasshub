-- UNEXECUTED
-- NON_PRODUCTION_REVIEW_PROPOSAL
-- NOT FOR DIRECT PRODUCTION EXECUTION
-- REQUIRES FRESH PREFLIGHT OUTPUT AND HUMAN APPROVAL
--
-- Scope: restore only public.increment_post_view_count(uuid) to the exact
-- verified source body, owner, SECURITY DEFINER/search_path, and ACL contract.
-- Preconditions are documentary: verified non-production target, attached fresh
-- preflight, matching signature/owner/dependencies, reviewed caller behavior,
-- and confirmed backup/restore readiness are mandatory before any execution.

BEGIN;

CREATE OR REPLACE FUNCTION public.increment_post_view_count(p_post_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  update public.posts as post_ref
  set view_count = coalesce(post_ref.view_count, 0) + 1
  where post_ref.id = p_post_id
    and post_ref.status = 'published'
    and post_ref.moderation_status = 'published'
    and public.can_access_public_circle(post_ref.circle_id);
$function$;

ALTER FUNCTION public.increment_post_view_count(uuid) OWNER TO postgres;
ALTER FUNCTION public.increment_post_view_count(uuid) SECURITY DEFINER;
ALTER FUNCTION public.increment_post_view_count(uuid) SET search_path TO public;
REVOKE ALL ON FUNCTION public.increment_post_view_count(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_post_view_count(uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.increment_post_view_count(uuid) TO anon, authenticated;

COMMIT;
