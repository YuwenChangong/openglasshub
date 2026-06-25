-- Profile role lockdown smoke validation (SQL Editor friendly).
-- Run in a non-production environment first.

begin;

do $$
declare
  user_count integer;
begin
  select count(*) into user_count from auth.users;
  if user_count < 2 then
    raise exception 'Profile role lockdown test requires at least 2 users in auth.users; found %', user_count;
  end if;
end $$;

select set_config(
  'app.profile_role_test_user_id',
  (
    select id::text
    from auth.users
    order by created_at, id
    limit 1
  ),
  true
);

select set_config(
  'app.profile_role_test_other_id',
  (
    select id::text
    from auth.users
    order by created_at, id
    offset 1
    limit 1
  ),
  true
);

insert into public.profiles (id, username, display_name, bio, role)
values
  (
    current_setting('app.profile_role_test_user_id')::uuid,
    'profile_role_lockdown_user',
    'Role Lockdown User',
    'Temporary role lockdown profile.',
    'user'
  ),
  (
    current_setting('app.profile_role_test_other_id')::uuid,
    'profile_role_lockdown_other',
    'Role Lockdown Other',
    'Temporary second profile.',
    'user'
  )
on conflict (id) do nothing;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', current_setting('app.profile_role_test_user_id'), true);

update public.profiles
set
  display_name = 'Role Lockdown User Updated',
  bio = 'Updated during role lockdown validation.'
where id = current_setting('app.profile_role_test_user_id')::uuid;

do $$
begin
  update public.profiles
  set role = 'admin'
  where id = current_setting('app.profile_role_test_user_id')::uuid;

  raise exception 'Expected self role escalation to fail';
exception
  when insufficient_privilege then
    null;
  when check_violation then
    null;
  when others then
    if position('PROFILE_ROLE_UPDATE_FORBIDDEN' in sqlerrm) = 0 then
      raise;
    end if;
end $$;

do $$
begin
  update public.profiles
  set display_name = 'Should not update another profile'
  where id = current_setting('app.profile_role_test_other_id')::uuid;

  raise exception 'Expected cross-profile update to fail';
exception
  when insufficient_privilege then
    null;
  when others then
    raise;
end $$;

do $$
begin
  perform public.qa_grant_admin_role(current_setting('app.profile_role_test_other_id')::uuid);

  raise exception 'Expected authenticated qa_grant_admin_role to fail';
exception
  when insufficient_privilege then
    null;
  when others then
    if position('QA_ADMIN_ROLE_RPC_PERMISSION_DENIED' in sqlerrm) = 0 then
      raise;
    end if;
end $$;

do $$
begin
  perform public.qa_revoke_admin_role(current_setting('app.profile_role_test_other_id')::uuid);

  raise exception 'Expected authenticated qa_revoke_admin_role to fail';
exception
  when insufficient_privilege then
    null;
  when others then
    if position('QA_ADMIN_ROLE_RPC_PERMISSION_DENIED' in sqlerrm) = 0 then
      raise;
    end if;
end $$;

reset role;
set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claim.sub', '', true);

do $$
begin
  update public.profiles
  set display_name = 'Anon should fail'
  where id = current_setting('app.profile_role_test_user_id')::uuid;

  raise exception 'Expected anon profile update to fail';
exception
  when insufficient_privilege then
    null;
  when others then
    raise;
end $$;

-- SQL Editor sessions usually run as postgres, so we can smoke-test the controlled
-- definer path here even though this does not impersonate PostgREST service_role.
reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claim.sub', '', true);

select public.qa_grant_admin_role(current_setting('app.profile_role_test_other_id')::uuid);

do $$
declare
  v_role public.user_role;
begin
  select role into v_role
  from public.profiles
  where id = current_setting('app.profile_role_test_other_id')::uuid;

  if v_role <> 'admin' then
    raise exception 'Expected QA grant rpc to set admin role, got %', v_role;
  end if;
end $$;

select public.qa_revoke_admin_role(current_setting('app.profile_role_test_other_id')::uuid);

do $$
declare
  v_role public.user_role;
begin
  select role into v_role
  from public.profiles
  where id = current_setting('app.profile_role_test_other_id')::uuid;

  if v_role <> 'user' then
    raise exception 'Expected QA revoke rpc to reset user role, got %', v_role;
  end if;
end $$;

rollback;
