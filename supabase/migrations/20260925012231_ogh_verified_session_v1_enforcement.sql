do $$
declare
  signature text;
  function_oid oid;
  expected_role text;
  expected_body_md5 text;
  expected_volatility text;
  expected_result text;
  table_name text;
  expected_table_md5 text;
  actual_table_md5 text;
begin
  if to_regclass('private.ogh_verified_sessions') is null
    or to_regclass('private.ogh_login_challenges') is null
    or to_regclass('private.ogh_email_send_budget') is null
    or to_regclass('private.ogh_policy_acceptances') is null
    or exists (
      select 1 from pg_policies
      where schemaname in ('public', 'storage') and policyname like 'ogh_verified_%'
    ) then
    raise exception 'OGH_FOUNDATION_REQUIRED';
  end if;
  if (
    select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='private' and c.relname like 'ogh_%' and c.relkind='r'
      and pg_get_userbyid(c.relowner)='postgres'
      and not has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
      and not has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
      and not has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
  ) <> 4 or (
    select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'ogh_%'
  ) <> 8 then
    raise exception 'OGH_FOUNDATION_REQUIRED';
  end if;

  for table_name, expected_table_md5 in
    select * from (values
      ('ogh_email_send_budget', '210b1b24cf4a4c4ae0fa91b0d50e2ae5'),
      ('ogh_login_challenges', '9063dff5d1349c4ad15c8a0286d5000f'),
      ('ogh_policy_acceptances', 'a8be04fb3bb401a10646b88f10671f9a'),
      ('ogh_verified_sessions', '6c0373984f67e952334c912ed6a404da')
    ) as required(table_name, expected_table_md5)
  loop
    select md5(
      coalesce((select string_agg(a.attname || '|' || a.atttypid::regtype::text || '|' || a.attnotnull::text || '|' || coalesce(pg_get_expr(d.adbin,d.adrelid),''), ';' order by a.attnum)
        from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
        where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),'') || '#' ||
      coalesce((select string_agg(pg_get_constraintdef(k.oid), ';' order by pg_get_constraintdef(k.oid))
        from pg_constraint k where k.conrelid=c.oid),'') || '#' ||
      coalesce((select string_agg(pg_get_indexdef(i.indexrelid), ';' order by pg_get_indexdef(i.indexrelid))
        from pg_index i where i.indrelid=c.oid),'')
    ) into actual_table_md5
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='private' and c.relname=table_name and c.relkind='r';
    if actual_table_md5 is distinct from expected_table_md5 then
      raise exception 'OGH_FOUNDATION_REQUIRED';
    end if;
  end loop;

  for signature, expected_role, expected_body_md5, expected_volatility, expected_result in
    select * from (values
      ('public.ogh_is_verified_session()', 'authenticated', 'fcb3e8be9f28a9a8bf900d6002f53544', 's', 'boolean'),
      ('public.ogh_reserve_login_challenge(uuid,uuid,uuid,bytea,text,boolean)', 'service_role', '4cf133083a0f86550e533afdf9096794', 'v', 'text'),
      ('public.ogh_finalize_login_delivery(uuid,uuid,uuid,boolean)', 'service_role', '5f8d51b6700079d2728da8d4fab5fa64', 'v', 'boolean'),
      ('public.ogh_consume_login_challenge(uuid,uuid,uuid,bytea)', 'service_role', '41aeb146fd7e4a596901f3be2cb6ba9b', 'v', 'text'),
      ('public.ogh_activate_signup_session(uuid,uuid)', 'service_role', 'ed5910e027db318e416ad54a978c06c7', 'v', 'boolean'),
      ('public.ogh_revoke_verified_session(uuid,uuid)', 'service_role', '0439cd9e639d5b3cbccc20645351e347', 'v', 'boolean'),
      ('public.ogh_record_policy_acceptance(uuid,text,text,text,text,text)', 'service_role', '5ae895b3232b4c69893a946a77789e4e', 'v', 'void'),
      ('public.ogh_has_current_policy_acceptance(text,text,text,text)', 'authenticated', 'c1f50385fbb531140d34e9151bd38db7', 's', 'boolean')
    ) as required(signature, expected_role, expected_body_md5, expected_volatility, expected_result)
  loop
    function_oid := to_regprocedure(signature);
    if function_oid is null or not exists (
      select 1 from pg_proc p
      where p.oid = function_oid
        and pg_get_userbyid(p.proowner) = 'postgres'
        and p.prosecdef
        and md5(p.prosrc) = expected_body_md5
        and p.provolatile::text = expected_volatility
        and pg_get_function_result(p.oid) = expected_result
        and p.prolang = (select oid from pg_language where lanname='plpgsql')
        and not p.proisstrict and not p.proleakproof and p.proparallel = 'u'
        and 'search_path=""' = any (p.proconfig)
        and not exists (
          select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where a.grantee = 0 and a.privilege_type = 'EXECUTE'
        )
        and not has_function_privilege('anon', p.oid, 'EXECUTE')
        and has_function_privilege(expected_role, p.oid, 'EXECUTE')
        and has_function_privilege('authenticated', p.oid, 'EXECUTE') = (expected_role = 'authenticated')
        and has_function_privilege('service_role', p.oid, 'EXECUTE') = (expected_role = 'service_role')
    ) then
      raise exception 'OGH_FOUNDATION_REQUIRED';
    end if;
  end loop;

  function_oid := to_regprocedure('public.consume_verification_email_resend_limit(text,integer,integer)');
  if function_oid is null or not exists (
    select 1 from pg_proc p
    where p.oid = function_oid
      and pg_get_userbyid(p.proowner) = 'postgres'
      and p.prosecdef
      and md5(p.prosrc) = 'fab6c7a2d75465f644f66667631ef593'
      and p.provolatile = 'v'
      and p.prolang = (select oid from pg_language where lanname='plpgsql')
      and not p.proisstrict and not p.proleakproof and p.proparallel = 'u'
      and 'search_path=""' = any (p.proconfig)
      and position('pg_advisory_xact_lock' in p.prosrc) > 0
      and position('v_count >= 5' in p.prosrc) > 0
      and position('24 hours' in p.prosrc) > 0
      and not exists (
        select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where a.grantee = 0 and a.privilege_type = 'EXECUTE'
      )
      and has_function_privilege('anon', p.oid, 'EXECUTE')
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and has_function_privilege('service_role', p.oid, 'EXECUTE')
  ) then
    raise exception 'OGH_FOUNDATION_REQUIRED';
  end if;
end;
$$;

-- Keep existing permissive owner/staff policies; add verified-session gates.
do $$
declare
  target text;
begin
  foreach target in array array[
    'profiles', 'circles', 'posts', 'comments', 'reports', 'report_events',
    'moderation_actions', 'post_votes', 'bookmarks', 'comment_reactions',
    'post_media', 'forum_upload_attempts', 'forum_notifications',
    'user_safety_states', 'user_safety_events', 'legal_policy_acceptances',
    'news_articles', 'devices', 'device_spec_definitions', 'device_specs',
    'device_sources', 'device_source_links', 'device_spec_evidence',
    'catalog_audit_events'
  ] loop
    execute format('create policy ogh_verified_insert on public.%I as restrictive for insert to authenticated with check ((select public.ogh_is_verified_session()))', target);
    execute format('create policy ogh_verified_update on public.%I as restrictive for update to authenticated using ((select public.ogh_is_verified_session())) with check ((select public.ogh_is_verified_session()))', target);
    execute format('create policy ogh_verified_delete on public.%I as restrictive for delete to authenticated using ((select public.ogh_is_verified_session()))', target);
  end loop;
end;
$$;

-- Only the public branch of a mixed SELECT remains available to pending users.
-- The original permissive policy still supplies owner/staff and row visibility.
create policy ogh_verified_select on public.circles as restrictive for select to authenticated
  using (public.can_access_public_circle(id) or (select public.ogh_is_verified_session()));
create policy ogh_verified_select on public.posts as restrictive for select to authenticated
  using ((status = 'published' and moderation_status = 'published' and public.can_access_public_circle(circle_id))
    or (select public.ogh_is_verified_session()));
create policy ogh_verified_select on public.comments as restrictive for select to authenticated
  using (public.can_access_public_comment_read_target(id) or (select public.ogh_is_verified_session()));
create policy ogh_verified_select on public.post_media as restrictive for select to authenticated
  using (public.can_access_public_post_media_object(storage_path) or (select public.ogh_is_verified_session()));
create policy ogh_verified_select on public.news_articles as restrictive for select to authenticated
  using (status = 'published' or (select public.ogh_is_verified_session()));
create policy ogh_verified_select on public.devices as restrictive for select to authenticated
  using (publication_status = 'published' or (select public.ogh_is_verified_session()));

do $$
declare
  target text;
begin
  foreach target in array array[
    'reports', 'report_events', 'moderation_actions', 'bookmarks',
    'forum_upload_attempts', 'forum_notifications', 'user_safety_states',
    'user_safety_events', 'device_spec_definitions', 'device_specs',
    'device_sources', 'device_source_links', 'device_spec_evidence',
    'catalog_audit_events'
  ] loop
    execute format('create policy ogh_verified_select on public.%I as restrictive for select to authenticated using ((select public.ogh_is_verified_session()))', target);
  end loop;
end;
$$;

-- Historical consent rows remain an explicit pending-session bootstrap read.
create policy ogh_verified_storage_insert on storage.objects as restrictive for insert to authenticated
  with check (bucket_id <> 'post-media' or (select public.ogh_is_verified_session()));
create policy ogh_verified_storage_update on storage.objects as restrictive for update to authenticated
  using (bucket_id <> 'post-media' or (select public.ogh_is_verified_session()))
  with check (bucket_id <> 'post-media' or (select public.ogh_is_verified_session()));
create policy ogh_verified_storage_delete on storage.objects as restrictive for delete to authenticated
  using (bucket_id <> 'post-media' or (select public.ogh_is_verified_session()));
create policy ogh_verified_storage_select on storage.objects as restrictive for select to authenticated
  using (
    bucket_id <> 'post-media'
    or (select public.ogh_is_verified_session())
    or public.can_access_public_post_media_object(name)
    or public.can_access_public_profile_media_object(name)
    or public.can_access_public_circle_cover_object(name)
    or (storage.foldername(name))[1] in ('news-covers', 'news-content')
  );

revoke all on function public.consume_verification_email_resend_limit(text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.consume_verification_email_resend_limit(text, integer, integer)
  to service_role;
