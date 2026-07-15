-- UNEXECUTED. PRODUCTION_REVIEW_PROPOSAL. WAVE 1 PREREQUISITE.
-- NOT A CANONICAL MIGRATION. NOT MIGRATION-HISTORY REPAIR.
-- DOES NOT RECONCILE CIRCLES POLICIES OR CONSTRAINTS.
-- DO NOT RUN WITHOUT FRESH PREFLIGHT, DATABASE/SECURITY REVIEW, AND
-- EXPLICIT HUMAN PRODUCTION APPROVAL.
--
-- Exact scope: public.can_access_public_circle(uuid) only.
BEGIN;

CREATE FUNCTION public.can_access_public_circle(target_circle_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  select exists (
    select 1
    from public.circles as circle_ref
    where circle_ref.id = target_circle_id
      and circle_ref.status = 'active'
      and lower(coalesce(circle_ref.slug, '')) not in ('rls-test-circle', 'rls-test', 'test-circle')
      and lower(coalesce(circle_ref.name, '')) not like '%rls test%'
  );
$function$;

ALTER FUNCTION public.can_access_public_circle(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.can_access_public_circle(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_public_circle(uuid) TO anon, authenticated;

COMMIT;
