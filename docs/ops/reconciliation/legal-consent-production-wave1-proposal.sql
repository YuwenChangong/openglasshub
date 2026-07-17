-- UNEXECUTED
-- PRODUCTION_REVIEW_PROPOSAL
-- DO NOT RUN WITHOUT FRESH PREFLIGHT
-- REQUIRES DATABASE/SECURITY REVIEW
-- REQUIRES EXPLICIT HUMAN PRODUCTION APPROVAL
-- NOT A CANONICAL MIGRATION
-- NOT MIGRATION-HISTORY REPAIR
--
-- Exact Wave 1 scope only:
--   public.increment_post_view_count(uuid)
--   public.insert_forum_notification(uuid, uuid, text, uuid, uuid, uuid)
--
-- Preconditions are mandatory and documentary: human-confirmed production
-- target, fresh attached preflight, reviewed hashes/metadata/ACLs, no overload
-- drift, backup/restore readiness, a named incident owner, and compatible
-- application deployment state. Any mismatch means STOP with no execution.

BEGIN;

-- First converge the public view-count RPC body and trusted metadata. The
-- expected anonymous/authenticated access is granted only after PUBLIC and
-- service_role execution have been removed.
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
REVOKE ALL ON FUNCTION public.increment_post_view_count(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.increment_post_view_count(uuid) TO anon, authenticated;

-- The notification body already matches the reviewed source. Converge only
-- its owner, trusted metadata, and service-role-only direct execution.
ALTER FUNCTION public.insert_forum_notification(uuid, uuid, text, uuid, uuid, uuid) OWNER TO postgres;
ALTER FUNCTION public.insert_forum_notification(uuid, uuid, text, uuid, uuid, uuid) SECURITY DEFINER;
ALTER FUNCTION public.insert_forum_notification(uuid, uuid, text, uuid, uuid, uuid) SET search_path TO public, pg_temp;
REVOKE ALL ON FUNCTION public.insert_forum_notification(uuid, uuid, text, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.insert_forum_notification(uuid, uuid, text, uuid, uuid, uuid) TO service_role;

-- In-transaction catalog assertions. Any exception aborts the full transaction
-- and leaves both bodies/ACLs unchanged. Unknown direct grantees are a STOP
-- condition rather than a permission to remove unreviewed access.
DO $assertions$
DECLARE
  view_oid oid := 'public.increment_post_view_count(uuid)'::regprocedure;
  notification_oid oid := 'public.insert_forum_notification(uuid, uuid, text, uuid, uuid, uuid)'::regprocedure;
BEGIN
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'increment_post_view_count') <> 1
    OR (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'insert_forum_notification') <> 1 THEN
    RAISE EXCEPTION 'Wave 1 assertion failed: unexpected overload count';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid = view_oid
      AND pg_get_function_result(p.oid) = 'void'
      AND pg_get_userbyid(p.proowner) = 'postgres'
      AND p.prosecdef
      AND coalesce(array_to_string(p.proconfig, ', '), '') = 'search_path=public'
      AND position('moderation_status = ''published''' IN p.prosrc) > 0
      AND position('public.can_access_public_circle(post_ref.circle_id)' IN p.prosrc) > 0
  ) THEN
    RAISE EXCEPTION 'Wave 1 assertion failed: view-count body or metadata mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid = notification_oid
      AND pg_get_function_result(p.oid) = 'void'
      AND pg_get_userbyid(p.proowner) = 'postgres'
      AND p.prosecdef
      AND coalesce(array_to_string(p.proconfig, ', '), '') = 'search_path=public, pg_temp'
  ) THEN
    RAISE EXCEPTION 'Wave 1 assertion failed: notification metadata mismatch';
  END IF;

  IF EXISTS (
      SELECT 1 FROM pg_proc p
      CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
      WHERE p.oid = view_oid AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
    )
    OR NOT has_function_privilege('anon', view_oid, 'EXECUTE')
    OR NOT has_function_privilege('authenticated', view_oid, 'EXECUTE')
    OR has_function_privilege('service_role', view_oid, 'EXECUTE')
    OR EXISTS (
      SELECT 1 FROM pg_proc p
      CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
      WHERE p.oid = notification_oid AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
    )
    OR has_function_privilege('anon', notification_oid, 'EXECUTE')
    OR has_function_privilege('authenticated', notification_oid, 'EXECUTE')
    OR NOT has_function_privilege('service_role', notification_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Wave 1 assertion failed: expected execution matrix mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
    WHERE p.oid IN (view_oid, notification_oid)
      AND acl.privilege_type = 'EXECUTE'
      AND coalesce(grantee.rolname, 'PUBLIC') NOT IN ('PUBLIC', 'anon', 'authenticated', 'service_role')
      AND grantee.oid IS DISTINCT FROM p.proowner
  ) THEN
    RAISE EXCEPTION 'Wave 1 assertion failed: unexpected direct function grantee';
  END IF;
END;
$assertions$;

COMMIT;
