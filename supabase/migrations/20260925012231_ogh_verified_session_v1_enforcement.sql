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
