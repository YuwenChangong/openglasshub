-- CATALOG_01: schemas
SELECT encode(convert_to(row_to_json(q)::text, 'UTF8'), 'hex') AS payload FROM (
SELECT n.nspname, pg_get_userbyid(n.nspowner) AS owner, n.nspacl::text AS acl,
        has_schema_privilege('anon', n.oid, 'USAGE') AS anon_usage,
        has_schema_privilege('anon', n.oid, 'CREATE') AS anon_create,
        has_schema_privilege('authenticated', n.oid, 'USAGE') AS authenticated_usage,
        has_schema_privilege('authenticated', n.oid, 'CREATE') AS authenticated_create,
        has_schema_privilege('service_role', n.oid, 'USAGE') AS service_usage,
        has_schema_privilege('service_role', n.oid, 'CREATE') AS service_create
      FROM pg_namespace n WHERE n.nspname IN ('private','public','storage') ORDER BY n.nspname
) AS q;

-- CATALOG_02: objects
SELECT encode(convert_to(row_to_json(q)::text, 'UTF8'), 'hex') AS payload FROM (
SELECT 'relation' AS kind, n.nspname AS schema, c.relname AS name,
        c.relkind::text AS detail, pg_get_userbyid(c.relowner) AS owner
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relname LIKE 'ogh_%' AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
      UNION ALL
      SELECT 'function', n.nspname, p.proname,
        pg_get_function_identity_arguments(p.oid), pg_get_userbyid(p.proowner)
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE p.proname LIKE 'ogh_%' AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
      UNION ALL
      SELECT 'type', n.nspname, t.typname, t.typtype::text, pg_get_userbyid(t.typowner)
      FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
      WHERE t.typname LIKE 'ogh_%' AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
      ORDER BY kind, schema, name, detail
) AS q;

-- CATALOG_03: tables
SELECT encode(convert_to(row_to_json(q)::text, 'UTF8'), 'hex') AS payload FROM (
SELECT c.relname, c.relkind, pg_get_userbyid(c.relowner) AS owner, c.relacl::text AS acl,
        jsonb_build_object(
          'anon_select',has_table_privilege('anon',c.oid,'SELECT'),
          'anon_insert',has_table_privilege('anon',c.oid,'INSERT'),
          'anon_update',has_table_privilege('anon',c.oid,'UPDATE'),
          'anon_delete',has_table_privilege('anon',c.oid,'DELETE'),
          'authenticated_select',has_table_privilege('authenticated',c.oid,'SELECT'),
          'authenticated_insert',has_table_privilege('authenticated',c.oid,'INSERT'),
          'authenticated_update',has_table_privilege('authenticated',c.oid,'UPDATE'),
          'authenticated_delete',has_table_privilege('authenticated',c.oid,'DELETE'),
          'service_select',has_table_privilege('service_role',c.oid,'SELECT'),
          'service_insert',has_table_privilege('service_role',c.oid,'INSERT'),
          'service_update',has_table_privilege('service_role',c.oid,'UPDATE'),
          'service_delete',has_table_privilege('service_role',c.oid,'DELETE')
        ) AS effective_acl
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='private' AND c.relname LIKE 'ogh_%' AND c.relkind <> 'i' ORDER BY c.relname
) AS q;

-- CATALOG_04: columns
SELECT encode(convert_to(row_to_json(q)::text, 'UTF8'), 'hex') AS payload FROM (
SELECT table_name, column_name, data_type, is_nullable, column_default
      FROM information_schema.columns WHERE table_schema='private' AND table_name LIKE 'ogh_%'
      ORDER BY table_name, ordinal_position
) AS q;

-- CATALOG_05: constraints
SELECT encode(convert_to(row_to_json(q)::text, 'UTF8'), 'hex') AS payload FROM (
SELECT c.relname, pg_get_constraintdef(k.oid) AS definition
      FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='private' AND c.relname LIKE 'ogh_%' ORDER BY c.relname, definition
) AS q;

-- CATALOG_06: indexes
SELECT encode(convert_to(row_to_json(q)::text, 'UTF8'), 'hex') AS payload FROM (
SELECT tablename, indexdef FROM pg_indexes WHERE schemaname='private' AND tablename LIKE 'ogh_%'
      ORDER BY tablename, indexname
) AS q;

-- CATALOG_07: functions
SELECT encode(convert_to(row_to_json(q)::text, 'UTF8'), 'hex') AS payload FROM (
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS arguments,
        pg_get_function_result(p.oid) AS result, pg_get_userbyid(p.proowner) AS owner,
        p.prosecdef, p.provolatile, p.proparallel, p.proisstrict, p.proleakproof,
        l.lanname AS language, p.proconfig, p.prosrc, p.proacl::text AS acl,
        has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
        has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
        has_function_privilege('service_role',p.oid,'EXECUTE') AS service_execute,
        pg_get_function_arguments(p.oid) AS arguments_with_defaults, p.proargdefaults::text AS defaults
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
      WHERE n.nspname='public' AND (p.proname LIKE 'ogh_%' OR p.proname='consume_verification_email_resend_limit')
      ORDER BY p.proname, arguments
) AS q;

-- CATALOG_08: policies
SELECT encode(convert_to(row_to_json(q)::text, 'UTF8'), 'hex') AS payload FROM (
SELECT schemaname, tablename, policyname, permissive, roles::text AS roles, cmd, qual, with_check
      FROM pg_policies WHERE schemaname IN ('public','storage') ORDER BY schemaname, tablename, policyname
) AS q;

-- CATALOG_09: rls
SELECT encode(convert_to(row_to_json(q)::text, 'UTF8'), 'hex') AS payload FROM (
SELECT n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('private','public','storage') AND c.relkind IN ('r','p')
      ORDER BY n.nspname,c.relname
) AS q;

-- CATALOG_10: readAcl
SELECT encode(convert_to(row_to_json(q)::text, 'UTF8'), 'hex') AS payload FROM (
SELECT c.relname,
        has_table_privilege('anon',c.oid,'SELECT') AS anon_select,
        has_table_privilege('authenticated',c.oid,'SELECT') AS authenticated_select
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname IN ('devices','posts','circles','comments','news_articles','post_media')
      ORDER BY c.relname
) AS q;

-- CATALOG_11: publication
SELECT encode(convert_to(row_to_json(q)::text, 'UTF8'), 'hex') AS payload FROM (
SELECT pubname, schemaname, tablename FROM pg_publication_tables
      WHERE schemaname='public' AND tablename='forum_notifications' ORDER BY pubname
) AS q;
