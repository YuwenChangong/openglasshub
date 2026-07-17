-- UNEXECUTED. PRODUCTION_REVIEW_PROPOSAL.
-- NOT A CANONICAL MIGRATION. NOT MIGRATION-HISTORY REPAIR.
-- REQUIRES FRESH PREFLIGHT. REQUIRES EXPLICIT HUMAN PRODUCTION APPROVAL.
-- SCOPE LIMITED TO THREE CIRCLES OBJECTS: circles_status_check,
-- circles_select_public, and circles_delete_owner_or_staff.
--
-- This reviewed forward fix must be run as written, once, only after the
-- companion execution preflight matches the evidence packet. It never restores
-- broad USING true access or direct hard DELETE as an emergency rollback.
BEGIN;

DO $assertions$
DECLARE
  status_constraint text;
  select_policy record;
  delete_policy record;
  hidden_or_invalid_count bigint;
BEGIN
  IF to_regclass('public.circles') IS NULL THEN RAISE EXCEPTION 'public.circles is missing'; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.circles'::regclass) THEN RAISE EXCEPTION 'public.circles RLS is not enabled'; END IF;
  SELECT pg_get_constraintdef(oid, true) INTO status_constraint FROM pg_constraint
    WHERE conrelid = 'public.circles'::regclass AND conname = 'circles_status_check';
  IF status_constraint <> 'CHECK (status = ANY (ARRAY[''active''::text, ''hidden''::text, ''deleted''::text]))' THEN
    RAISE EXCEPTION 'circles_status_check no longer matches the reviewed production drift';
  END IF;
  SELECT count(*) INTO hidden_or_invalid_count FROM public.circles
    WHERE status IS NULL OR status NOT IN ('active', 'deleted');
  IF hidden_or_invalid_count <> 0 THEN RAISE EXCEPTION 'circles status data no longer permits narrowing without a data decision'; END IF;
  SELECT polpermissive AS permissive, array_to_string(polroles::regrole[], ',') AS roles, coalesce(pg_get_expr(polqual, polrelid), '') AS using_expression, coalesce(pg_get_expr(polwithcheck, polrelid), '') AS with_check_expression
    INTO select_policy FROM pg_policy WHERE polrelid = 'public.circles'::regclass AND polname = 'circles_select_public' AND polcmd = 'r';
  IF NOT FOUND OR NOT select_policy.permissive OR select_policy.roles <> 'anon,authenticated' OR select_policy.using_expression <> 'true' OR select_policy.with_check_expression <> '' THEN
    RAISE EXCEPTION 'circles_select_public no longer matches the reviewed broad production policy';
  END IF;
  SELECT polpermissive AS permissive, array_to_string(polroles::regrole[], ',') AS roles, coalesce(pg_get_expr(polqual, polrelid), '') AS using_expression, coalesce(pg_get_expr(polwithcheck, polrelid), '') AS with_check_expression
    INTO delete_policy FROM pg_policy WHERE polrelid = 'public.circles'::regclass AND polname = 'circles_delete_owner_or_staff' AND polcmd = 'd';
  IF NOT FOUND OR NOT delete_policy.permissive OR delete_policy.roles <> 'authenticated' OR delete_policy.using_expression <> '((owner_id = auth.uid()) OR ( SELECT is_moderator_or_admin() AS is_moderator_or_admin))' OR delete_policy.with_check_expression <> '' THEN
    RAISE EXCEPTION 'circles_delete_owner_or_staff no longer matches the reviewed direct-delete policy';
  END IF;
  IF (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.circles'::regclass AND polcmd IN ('r', 'd')) <> 2 THEN RAISE EXCEPTION 'unexpected public.circles SELECT or DELETE policy exists'; END IF;
  IF (SELECT md5(regexp_replace(trim(prosrc), E'\\s+', ' ', 'g')) FROM pg_proc WHERE oid = 'public.can_access_public_circle(uuid)'::regprocedure) <> '67b9d428d658222c17d640a50f0b3127' THEN RAISE EXCEPTION 'can_access_public_circle body changed'; END IF;
  IF (SELECT md5(regexp_replace(trim(prosrc), E'\\s+', ' ', 'g')) FROM pg_proc WHERE oid = 'public.is_moderator_or_admin()'::regprocedure) <> '9c98ffcd37da87b15e7b728e323115d3' THEN RAISE EXCEPTION 'is_moderator_or_admin body changed'; END IF;
END
$assertions$;

-- PostgreSQL validates the new constraint before the old name is released.
-- All DDL is transactionally grouped, so other sessions never observe broad
-- SELECT access after this transaction commits.
ALTER TABLE public.circles ADD CONSTRAINT circles_status_check_narrowed
  CHECK (status = ANY (ARRAY['active'::text, 'deleted'::text])) NOT VALID;
ALTER TABLE public.circles VALIDATE CONSTRAINT circles_status_check_narrowed;
ALTER TABLE public.circles DROP CONSTRAINT circles_status_check;
ALTER TABLE public.circles RENAME CONSTRAINT circles_status_check_narrowed TO circles_status_check;

DROP POLICY "circles_select_public" ON public.circles;
CREATE POLICY "circles_select_public" ON public.circles
  AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (
    public.can_access_public_circle(id)
    OR owner_id = auth.uid()
    OR (SELECT public.is_moderator_or_admin())
  );

DROP POLICY "circles_delete_owner_or_staff" ON public.circles;

DO $postconditions$
BEGIN
  IF (SELECT pg_get_constraintdef(oid, true) FROM pg_constraint WHERE conrelid = 'public.circles'::regclass AND conname = 'circles_status_check') <> 'CHECK (status = ANY (ARRAY[''active''::text, ''deleted''::text]))' THEN RAISE EXCEPTION 'narrowed status constraint did not converge'; END IF;
  IF (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.circles'::regclass AND polcmd = 'r') <> 1 THEN RAISE EXCEPTION 'unexpected SELECT policy after reconciliation'; END IF;
  IF (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.circles'::regclass AND polcmd = 'd') <> 0 THEN RAISE EXCEPTION 'direct DELETE policy remains after reconciliation'; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.circles'::regclass) THEN RAISE EXCEPTION 'RLS was unexpectedly disabled'; END IF;
END
$postconditions$;

COMMIT;
