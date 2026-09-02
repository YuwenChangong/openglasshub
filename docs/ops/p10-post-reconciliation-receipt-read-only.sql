-- P10 receipt group 1: devices table contract only.
SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'devices' ORDER BY ordinal_position;
-- P10 receipt group 2: devices constraints only.
SELECT conname, contype, pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c WHERE conrelid = 'public.devices'::regclass ORDER BY conname;
-- P10 receipt group 3: required indexes only.
SELECT indexrelid::regclass::text AS index_name, indisunique, pg_get_indexdef(indexrelid) AS definition FROM pg_index WHERE indrelid = 'public.devices'::regclass AND indexrelid::regclass::text IN ('devices_publication_status_idx','devices_brand_key_idx','devices_category_idx') ORDER BY index_name;
-- P10 receipt group 4: RLS catalog state.
SELECT relrowsecurity FROM pg_class WHERE oid = 'public.devices'::regclass;
-- P10 receipt group 5: required grants only.
SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'devices' AND ((grantee = 'anon' AND privilege_type = 'SELECT') OR (grantee = 'authenticated' AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE'))) ORDER BY grantee, privilege_type;
-- P10 receipt group 6: required policies only.
SELECT policyname, roles, cmd, permissive, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = 'devices' AND policyname IN ('devices_select_published_public','devices_select_staff_all','devices_insert_staff','devices_update_staff','devices_delete_staff') ORDER BY policyname;
-- P10 receipt group 7: slug lock function and two triggers only.
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS signature, l.lanname, p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '') AS search_path, pg_get_functiondef(p.oid) AS function_definition, (SELECT jsonb_agg(jsonb_build_object('name', t.tgname, 'definition', pg_get_triggerdef(t.oid), 'enabled', t.tgenabled) ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid = 'public.devices'::regclass AND t.tgname IN ('trg_devices_set_updated_at','trg_devices_enforce_slug_lock') AND NOT t.tgisinternal) AS triggers FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang WHERE n.nspname = 'public' AND p.proname = 'enforce_device_slug_lock';
-- P10 receipt group 8: one migration history row metadata only, no bodies.
SELECT version, name, created_by, idempotency_key, array_length(statements, 1) AS statement_count, array_length(rollback, 1) AS rollback_statement_count FROM supabase_migrations.schema_migrations WHERE version = '20260902042807' ORDER BY version, name;
