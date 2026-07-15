-- READ ONLY PRODUCTION PREFLIGHT. Export the one final result set as CSV.
-- Scope: public.circles status constraint, public SELECT/DELETE policies, and
-- the two source-backed visibility/role helper functions only.
BEGIN TRANSACTION READ ONLY;

WITH packet AS (
  SELECT 'circles-visibility-preflight-v1'::text AS packet_version
),
relation_ref AS (
  SELECT c.oid, c.relowner, c.relrowsecurity, c.relforcerowsecurity, c.relacl
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'circles' AND c.relkind = 'r'
),
expected_columns(column_name) AS (
  VALUES ('id'::text), ('owner_id'::text), ('status'::text), ('slug'::text), ('name'::text)
),
target_policies(policy_name) AS (
  VALUES ('circles_select_public'::text), ('circles_delete_owner_or_staff'::text)
),
policy_ref AS (
  SELECT p.polname, p.polcmd, p.polpermissive, p.polroles,
    pg_get_expr(p.polqual, p.polrelid) AS using_expression,
    pg_get_expr(p.polwithcheck, p.polrelid) AS with_check_expression
  FROM pg_policy p
  WHERE p.polrelid = 'public.circles'::regclass
    AND p.polname IN (SELECT policy_name FROM target_policies)
),
helper_targets(signature) AS (
  VALUES ('public.can_access_public_circle(uuid)'::text), ('public.is_moderator_or_admin()'::text)
),
helper_ref AS (
  SELECT target.signature, p.oid, p.proname, p.prosecdef, p.proconfig, p.proacl,
    pg_get_userbyid(p.proowner) AS owner, pg_get_function_result(p.oid) AS return_type,
    pg_get_functiondef(p.oid) AS definition
  FROM helper_targets target
  JOIN pg_proc p ON p.oid = to_regprocedure(target.signature)
),
aggregate_counts AS (
  SELECT
    count(*)::text AS total_circle_count,
    count(*) FILTER (WHERE status = 'active')::text AS active_circle_count,
    count(*) FILTER (WHERE status = 'hidden')::text AS hidden_circle_count,
    count(*) FILTER (WHERE status = 'deleted')::text AS deleted_circle_count,
    count(*) FILTER (WHERE status IS NULL)::text AS null_status_count,
    count(*) FILTER (WHERE status IS NOT NULL AND status NOT IN ('active', 'hidden', 'deleted'))::text AS unknown_status_count,
    count(*) FILTER (WHERE status NOT IN ('active', 'deleted') OR status IS NULL)::text AS expected_constraint_violation_count,
    count(*)::text AS current_anonymous_public_visible_count,
    count(*) FILTER (
      WHERE status = 'active'
        AND lower(coalesce(slug, '')) NOT IN ('rls-test-circle', 'rls-test', 'test-circle')
        AND lower(coalesce(name, '')) NOT LIKE '%rls test%'
    )::text AS expected_anonymous_public_visible_count,
    count(*) FILTER (
      WHERE NOT (
        status = 'active'
        AND lower(coalesce(slug, '')) NOT IN ('rls-test-circle', 'rls-test', 'test-circle')
        AND lower(coalesce(name, '')) NOT LIKE '%rls test%'
      )
    )::text AS current_vs_expected_anonymous_visibility_delta,
    count(*)::text AS potential_delete_policy_impact_count
  FROM public.circles
),
packet_rows AS (
  SELECT packet_version, 1 AS section_order, 'packet_manifest'::text AS section, 'packet'::text AS row_key,
    'public'::text AS object_schema, 'circles'::text AS object_name, attribute, value, 'PRESENT'::text AS evidence_status,
    'NON_SECURITY_DRIFT'::text AS security_classification
  FROM packet
  CROSS JOIN LATERAL (VALUES
    ('packet_identifier'::text, 'circles-visibility-production-preflight'),
    ('packet_version', packet_version),
    ('expected_section_count', '10'),
    ('target_relation', 'public.circles'),
    ('query_scope', 'PostgreSQL catalogs plus aggregate-only public.circles safety counts'),
    ('read_only_classification', 'CATALOG_AND_AGGREGATE_READ_ONLY')
  ) manifest(attribute, value)

  UNION ALL
  SELECT packet.packet_version, 2, 'circles_relation_rls_acl', 'public.circles', 'public', 'circles', attribute, value, 'PRESENT', 'SECURITY_BROADENING'
  FROM packet CROSS JOIN relation_ref relation_ref
  CROSS JOIN LATERAL (VALUES
    ('present'::text, 'true'::text), ('relation_kind', 'r'), ('owner', pg_get_userbyid(relation_ref.relowner)),
    ('rls_enabled', relation_ref.relrowsecurity::text), ('rls_forced', relation_ref.relforcerowsecurity::text),
    ('relation_acl', coalesce(relation_ref.relacl::text, ''))
  ) relation(attribute, value)
  UNION ALL
  SELECT packet_version, 2, 'circles_relation_rls_acl', 'public.circles', 'public', 'circles', 'present', 'false', 'MISSING', 'INSUFFICIENT_EVIDENCE'
  FROM packet WHERE NOT EXISTS (SELECT 1 FROM relation_ref)

  UNION ALL
  SELECT packet.packet_version, 3, 'circles_columns', expected_columns.column_name, 'public', 'circles', expected_columns.column_name,
    json_build_object('data_type', columns.data_type, 'not_null', columns.is_nullable = 'NO', 'default_expression', columns.column_default)::text,
    'PRESENT', 'NON_SECURITY_DRIFT'
  FROM packet CROSS JOIN expected_columns
  JOIN information_schema.columns columns ON columns.table_schema = 'public' AND columns.table_name = 'circles' AND columns.column_name = expected_columns.column_name
  UNION ALL
  SELECT packet.packet_version, 3, 'circles_columns', expected_columns.column_name, 'public', 'circles', expected_columns.column_name,
    NULL, 'MISSING', 'INSUFFICIENT_EVIDENCE'
  FROM packet CROSS JOIN expected_columns
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns columns
    WHERE columns.table_schema = 'public' AND columns.table_name = 'circles' AND columns.column_name = expected_columns.column_name
  )

  UNION ALL
  SELECT packet.packet_version, 4, 'circles_status_constraint', 'circles_status_check', 'public', 'circles', 'definition',
    pg_get_constraintdef(con.oid, true), 'PRESENT', 'PRODUCT_SEMANTIC_DIFFERENCE'
  FROM packet JOIN pg_constraint con ON con.conrelid = 'public.circles'::regclass AND con.conname = 'circles_status_check'
  UNION ALL
  SELECT packet_version, 4, 'circles_status_constraint', 'circles_status_check', 'public', 'circles', 'definition', NULL, 'MISSING', 'INSUFFICIENT_EVIDENCE'
  FROM packet WHERE NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.circles'::regclass AND conname = 'circles_status_check')

  UNION ALL
  SELECT packet.packet_version, 5, 'circles_status_aggregate_counts', attribute, 'public', 'circles', attribute, value, 'PRESENT', classification
  FROM packet CROSS JOIN aggregate_counts
  CROSS JOIN LATERAL (VALUES
    ('total_circle_count'::text, total_circle_count, 'NON_SECURITY_DRIFT'::text),
    ('active_circle_count', active_circle_count, 'NON_SECURITY_DRIFT'),
    ('hidden_circle_count', hidden_circle_count, 'PRODUCT_SEMANTIC_DIFFERENCE'),
    ('deleted_circle_count', deleted_circle_count, 'NON_SECURITY_DRIFT'),
    ('null_status_count', null_status_count, 'INSUFFICIENT_EVIDENCE'),
    ('unknown_status_count', unknown_status_count, 'INSUFFICIENT_EVIDENCE'),
    ('expected_constraint_violation_count', expected_constraint_violation_count, 'PRODUCT_SEMANTIC_DIFFERENCE'),
    ('current_anonymous_public_visible_count', current_anonymous_public_visible_count, 'SECURITY_BROADENING'),
    ('expected_anonymous_public_visible_count', expected_anonymous_public_visible_count, 'AVAILABILITY_NARROWING'),
    ('current_vs_expected_anonymous_visibility_delta', current_vs_expected_anonymous_visibility_delta, 'SECURITY_BROADENING'),
    ('potential_delete_policy_impact_count', potential_delete_policy_impact_count, 'PRODUCT_SEMANTIC_DIFFERENCE')
  ) aggregates(attribute, value, classification)

  UNION ALL
  SELECT packet.packet_version, 6, 'circles_select_policy', policy_ref.polname, 'public', 'circles', attribute, value, 'PRESENT', classification
  FROM packet JOIN policy_ref ON policy_ref.polname = 'circles_select_public'
  CROSS JOIN LATERAL (VALUES
    ('command'::text, policy_ref.polcmd::text, 'NON_SECURITY_DRIFT'::text),
    ('permissive', policy_ref.polpermissive::text, 'NON_SECURITY_DRIFT'),
    ('roles', coalesce(array_to_string(ARRAY(SELECT rolname FROM pg_roles WHERE oid = ANY(policy_ref.polroles) ORDER BY rolname), ','), 'PUBLIC'), 'SECURITY_BROADENING'),
    ('using_expression', coalesce(policy_ref.using_expression, ''), CASE WHEN policy_ref.using_expression = 'true' THEN 'SECURITY_BROADENING' ELSE 'NON_SECURITY_DRIFT' END),
    ('with_check_expression', coalesce(policy_ref.with_check_expression, ''), 'NON_SECURITY_DRIFT')
  ) policy(attribute, value, classification)
  UNION ALL
  SELECT packet_version, 6, 'circles_select_policy', 'circles_select_public', 'public', 'circles', 'definition', NULL, 'MISSING', 'INSUFFICIENT_EVIDENCE'
  FROM packet WHERE NOT EXISTS (SELECT 1 FROM policy_ref WHERE polname = 'circles_select_public')

  UNION ALL
  SELECT packet.packet_version, 7, 'circles_delete_policy', policy_ref.polname, 'public', 'circles', attribute, value, 'PRESENT', 'PRODUCT_SEMANTIC_DIFFERENCE'
  FROM packet JOIN policy_ref ON policy_ref.polname = 'circles_delete_owner_or_staff'
  CROSS JOIN LATERAL (VALUES
    ('command'::text, policy_ref.polcmd::text), ('permissive', policy_ref.polpermissive::text),
    ('roles', coalesce(array_to_string(ARRAY(SELECT rolname FROM pg_roles WHERE oid = ANY(policy_ref.polroles) ORDER BY rolname), ','), 'PUBLIC')),
    ('using_expression', coalesce(policy_ref.using_expression, '')), ('with_check_expression', coalesce(policy_ref.with_check_expression, ''))
  ) policy(attribute, value)
  UNION ALL
  SELECT packet_version, 7, 'circles_delete_policy', 'circles_delete_owner_or_staff', 'public', 'circles', 'definition', NULL, 'MISSING', 'INSUFFICIENT_EVIDENCE'
  FROM packet WHERE NOT EXISTS (SELECT 1 FROM policy_ref WHERE polname = 'circles_delete_owner_or_staff')

  UNION ALL
  SELECT packet_version, 8, 'policy_roles_and_dependencies', row_key, 'public', object_name, attribute, value, 'PRESENT', classification
  FROM packet CROSS JOIN (VALUES
    ('circles_select_public'::text, 'circles_select_public'::text, 'expected_roles', 'anon,authenticated', 'SECURITY_BROADENING'::text),
    ('circles_select_public', 'can_access_public_circle', 'expected_helper', 'public.can_access_public_circle(uuid)', 'SECURITY_BROADENING'),
    ('circles_select_public', 'is_moderator_or_admin', 'expected_helper', 'public.is_moderator_or_admin()', 'SECURITY_BROADENING'),
    ('circles_delete_owner_or_staff', 'circles_delete_owner_or_staff', 'expected_runtime_delete_model', 'soft_delete_status_update_only; hard_delete_runtime_not_observed', 'PRODUCT_SEMANTIC_DIFFERENCE'),
    ('circles_delete_owner_or_staff', 'is_moderator_or_admin', 'observed_helper_dependency', 'public.is_moderator_or_admin()', 'PRODUCT_SEMANTIC_DIFFERENCE')
  ) dependencies(row_key, object_name, attribute, value, classification)

  UNION ALL
  SELECT packet.packet_version, 9, 'visibility_helper_functions', helper_ref.signature, 'public', helper_ref.proname, attribute, value, 'PRESENT', 'SECURITY_BROADENING'
  FROM packet JOIN helper_ref ON true
  CROSS JOIN LATERAL (VALUES
    ('present'::text, 'true'::text), ('return_type', helper_ref.return_type), ('owner', helper_ref.owner),
    ('security_definer', helper_ref.prosecdef::text), ('search_path', coalesce(array_to_string(helper_ref.proconfig, ','), '')),
    ('acl', coalesce(helper_ref.proacl::text, '')), ('definition', helper_ref.definition)
  ) helper(attribute, value)
  UNION ALL
  SELECT packet.packet_version, 9, 'visibility_helper_functions', target.signature, 'public', split_part(split_part(target.signature, '.', 2), '(', 1), 'present', NULL, 'MISSING', 'INSUFFICIENT_EVIDENCE'
  FROM packet CROSS JOIN helper_targets target
  WHERE NOT EXISTS (SELECT 1 FROM helper_ref WHERE helper_ref.signature = target.signature)

  UNION ALL
  SELECT packet.packet_version, 10, 'dependent_catalog_objects', row_key, 'public', object_name, attribute, value, 'PRESENT', classification
  FROM packet CROSS JOIN (VALUES
    ('relation'::text, 'circles', 'rls_dependency', 'public.circles RLS state captured in circles_relation_rls_acl', 'SECURITY_BROADENING'::text),
    ('select_policy', 'circles_select_public', 'expected_predicate_dependency', 'public.can_access_public_circle(uuid) plus owner/staff branches', 'SECURITY_BROADENING'),
    ('delete_policy', 'circles_delete_owner_or_staff', 'authorization_dependency', 'owner_id = auth.uid() or public.is_moderator_or_admin()', 'PRODUCT_SEMANTIC_DIFFERENCE')
  ) dependencies(row_key, object_name, attribute, value, classification)
)
SELECT packet_version, section_order, section, row_key, object_schema, object_name, attribute, value, evidence_status, security_classification
FROM packet_rows
ORDER BY section_order, row_key, attribute;

ROLLBACK;
