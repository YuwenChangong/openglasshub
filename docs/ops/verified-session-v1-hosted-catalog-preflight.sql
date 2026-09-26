-- NON-EXECUTED review artifact. Catalog metadata only; no user rows or mutations.
-- A later operator must bind this exact file hash and target to separate approval.

select n.nspname as schema_name, c.relname as table_name, c.relrowsecurity as rls_enabled,
       pg_get_userbyid(c.relowner) as owner,
       has_table_privilege('anon', c.oid, 'SELECT') as anon_select,
       has_table_privilege('anon', c.oid, 'INSERT') as anon_insert,
       has_table_privilege('anon', c.oid, 'UPDATE') as anon_update,
       has_table_privilege('anon', c.oid, 'DELETE') as anon_delete,
       has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_select,
       has_table_privilege('authenticated', c.oid, 'INSERT') as authenticated_insert,
       has_table_privilege('authenticated', c.oid, 'UPDATE') as authenticated_update,
       has_table_privilege('authenticated', c.oid, 'DELETE') as authenticated_delete,
       has_table_privilege('service_role', c.oid, 'SELECT') as service_select,
       has_table_privilege('service_role', c.oid, 'INSERT') as service_insert,
       has_table_privilege('service_role', c.oid, 'UPDATE') as service_update,
       has_table_privilege('service_role', c.oid, 'DELETE') as service_delete
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'private' and c.relkind in ('r','p') and left(c.relname, 4) = 'ogh_'
order by c.relname;

select n.oid is not null as private_schema_present,
       pg_get_userbyid(n.nspowner) as owner,
       case when n.oid is not null then has_schema_privilege('anon', n.oid, 'USAGE') end as anon_usage,
       case when n.oid is not null then has_schema_privilege('authenticated', n.oid, 'USAGE') end as authenticated_usage,
       case when n.oid is not null then has_schema_privilege('service_role', n.oid, 'USAGE') end as service_usage
from (select to_regnamespace('private') as oid) lookup
left join pg_namespace n on n.oid = lookup.oid;

select c.relname as table_name, a.attname as column_name, a.attnum as column_position,
       format_type(a.atttypid, a.atttypmod) as data_type, a.attnotnull as not_null,
       pg_get_expr(d.adbin, d.adrelid) as default_expression
from pg_class c join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a on a.attrelid = c.oid
left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
where n.nspname = 'private' and c.relname in
  ('ogh_verified_sessions','ogh_login_challenges','ogh_email_send_budget','ogh_policy_acceptances')
  and a.attnum > 0 and not a.attisdropped
order by c.relname, a.attnum;

select c.relname as table_name, con.conname as constraint_name,
       pg_get_constraintdef(con.oid) as constraint_definition
from pg_constraint con join pg_class c on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'private' and c.relname like 'ogh_%'
order by c.relname, con.conname;

select t.relname as table_name, i.relname as index_name, pg_get_indexdef(i.oid) as index_definition
from pg_index x join pg_class t on t.oid = x.indrelid
join pg_class i on i.oid = x.indexrelid
join pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'private' and t.relname like 'ogh_%'
order by t.relname, i.relname;

select p.oid::regprocedure::text as signature, pg_get_userbyid(p.proowner) as owner,
       p.prosecdef as security_definer, p.provolatile as volatility,
       p.prorettype::regtype::text as return_type, p.proconfig as function_config,
       md5(pg_get_functiondef(p.oid)) as body_digest,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_execute,
       case when p.proname = 'ogh_is_verified_session'
         then pg_get_functiondef(p.oid) ~ 'join auth.sessions' end as live_session_dependency
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and left(p.proname, 4) = 'ogh_'
order by p.proname, p.oid::regprocedure::text;

select p.oid::regprocedure::text as signature, pg_get_userbyid(p.proowner) as owner,
       p.prosecdef as security_definer, p.provolatile as volatility,
       p.prorettype::regtype::text as return_type, p.proconfig as function_config,
       md5(pg_get_functiondef(p.oid)) as body_digest,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_execute,
       pg_get_functiondef(p.oid) ~ 'v_count >= 5' as fixed_five,
       pg_get_functiondef(p.oid) ~ 'interval ''24 hours''' as fixed_24_hours
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'consume_verification_email_resend_limit';

select n.nspname as schema_name, c.relname as table_name, p.polname as policy_name,
       p.polcmd as command, p.polpermissive as permissive, p.polroles::text as roles,
       pg_get_expr(p.polqual, p.polrelid) as using_expression,
       pg_get_expr(p.polwithcheck, p.polrelid) as check_expression
from pg_policy p join pg_class c on c.oid = p.polrelid
join pg_namespace n on n.oid = c.relnamespace
where (n.nspname = 'public' and p.polname like 'ogh_verified_%')
   or (n.nspname = 'storage' and c.relname = 'objects' and p.polname like 'ogh_verified_%')
order by n.nspname, c.relname, p.polname;

select schemaname, tablename, pubname
from pg_publication_tables
where pubname = 'supabase_realtime' and schemaname = 'public'
  and tablename in ('forum_notifications','comments','post_votes','comment_reactions')
order by tablename;

select c.relname as table_name, a.attname as column_name,
       format_type(a.atttypid, a.atttypmod) as data_type
from pg_class c join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a on a.attrelid = c.oid
where n.nspname = 'auth' and c.relname = 'sessions'
  and a.attname in ('id','user_id') and a.attnum > 0 and not a.attisdropped
order by a.attname;

select n.nspname as schema_name, c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'storage' and c.relname = 'objects';
