-- Reuse Schema v1 identities, typed facts, RLS and audit storage.
alter table public.devices add column catalog_normalized boolean not null default false;
alter table public.device_specs add column presentation jsonb not null default '{}'::jsonb;

create function public.catalog_presentation_valid(p jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select p is not null and jsonb_typeof(p) = 'object' and octet_length(p::text) <= 12000
    and not exists (select 1 from jsonb_object_keys(p) k where k not in
      ('labelZh','labelEn','valueZh','valueEn','groupKey','groupZh','groupEn',
       'groupOrder','order','keySpec','keySpecOrder','publicDisplay','format','displayUnit','precision'))
    and not exists (select 1 from jsonb_each(p) e where
      (e.key in ('labelZh','labelEn','groupZh','groupEn') and (jsonb_typeof(e.value) <> 'string' or length(e.value #>> '{}') not between 1 and 240))
      or (e.key in ('valueZh','valueEn') and (jsonb_typeof(e.value) <> 'string' or length(e.value #>> '{}') > 4000))
      or (e.key in ('groupOrder','order','keySpecOrder') and (jsonb_typeof(e.value) <> 'number' or (e.value #>> '{}') !~ '^\d{1,6}$'))
      or (e.key in ('keySpec','publicDisplay') and jsonb_typeof(e.value) <> 'boolean')
      or (e.key = 'precision' and (jsonb_typeof(e.value) <> 'number' or (e.value #>> '{}') !~ '^[0-6]$'))
      or (e.key = 'groupKey' and (jsonb_typeof(e.value) <> 'string' or (e.value #>> '{}') !~ '^[a-z][a-z0-9_-]{0,63}$'))
      or (e.key = 'format' and (jsonb_typeof(e.value) <> 'string' or (e.value #>> '{}') not in ('text','number','boolean','dimensions','range','date')))
      or (e.key = 'displayUnit' and (jsonb_typeof(e.value) <> 'string' or (e.value #>> '{}') not in ('','g','kg','mm','cm','Hz','kHz','°','mAh','h','min','W','Wh','MP','GB','%','nits'))));
$$;
revoke all on function public.catalog_presentation_valid(jsonb) from public;
grant execute on function public.catalog_presentation_valid(jsonb) to authenticated;
alter table public.device_specs add constraint catalog_presentation_contract check (public.catalog_presentation_valid(presentation));
grant select (presentation) on public.device_specs to anon;
grant select (catalog_normalized) on public.devices to anon;

drop policy device_detail_public_specs on public.device_specs;
create policy device_detail_public_specs on public.device_specs for select to anon using (
  state in ('KNOWN','NOT_DISCLOSED','NOT_APPLICABLE','CONFLICT')
  and coalesce((presentation->>'publicDisplay')::boolean, true)
  and exists (select 1 from public.devices d where d.id=device_id and d.publication_status='published')
  and exists (select 1 from public.device_spec_definitions f where f.id=spec_definition_id and f.is_active));

create or replace view public.public_device_detail_specs
with (security_invoker=true, security_barrier=true) as
select d.slug as device_slug, s.id, f.key, f.group_key, f.label, f.value_type, f.admin_order,
  s.state,s.value_number,s.value_boolean,s.value_text,s.value_json,s.canonical_unit,
  s.measurement_context,s.region,s.variant,s.confidence,s.verified_at,s.presentation
from public.device_specs s join public.device_spec_definitions f on f.id=s.spec_definition_id
join public.devices d on d.id=s.device_id
where d.publication_status='published' and f.is_active
  and s.state in ('KNOWN','NOT_DISCLOSED','NOT_APPLICABLE','CONFLICT')
  and coalesce((s.presentation->>'publicDisplay')::boolean,true);

create function public.save_catalog_spec(p_device_id uuid, p_spec_id uuid, p_input jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare current_spec public.device_specs%rowtype; definition_id uuid; result_id uuid;
  base_unit text; display_unit text; definition_key text;
  existing_type public.device_spec_value_type;
begin
  if not public.is_catalog_admin() then raise exception using errcode='42501',message='CATALOG_ADMIN_REQUIRED'; end if;
  if p_input is null or jsonb_typeof(p_input) <> 'object' or octet_length(p_input::text) > 24000
    or exists (select 1 from jsonb_object_keys(p_input) k where k not in
      ('key','valueType','state','valueNumber','valueBoolean','valueText','valueJson','presentation','region','variant'))
    or (p_input ? 'presentation' and not public.catalog_presentation_valid(p_input->'presentation')) then
    raise exception using errcode='23514',message='CATALOG_SPEC_INPUT_INVALID';
  end if;
  perform 1 from public.devices where id=p_device_id for update;
  if not found then raise exception using errcode='23514',message='CATALOG_DEVICE_NOT_FOUND'; end if;
  if p_spec_id is null then
    if coalesce(p_input->>'key','') !~ '^custom\.[a-z][a-z0-9_]{0,63}$'
      or coalesce(p_input->>'valueType','') not in ('number','boolean','text','json') then
      raise exception using errcode='23514',message='CATALOG_NEW_DEFINITION_INVALID';
    end if;
    insert into public.device_spec_definitions(key,group_key,label,value_type,applicable_schema_types,canonical_unit)
      values(p_input->>'key','custom',coalesce(p_input->'presentation'->>'labelEn',p_input->'presentation'->>'labelZh','Specification'),
        (p_input->>'valueType')::public.device_spec_value_type,array['display_ar','ai_hud']::public.device_schema_type[],nullif(p_input->'presentation'->>'displayUnit',''))
      on conflict (key) do nothing returning id into definition_id;
    if definition_id is null then
      select id,value_type,canonical_unit into definition_id,existing_type,base_unit
        from public.device_spec_definitions where key=p_input->>'key' and is_active for share;
      if definition_id is null or existing_type::text<>p_input->>'valueType'
        or base_unit is distinct from nullif(p_input->'presentation'->>'displayUnit','') then
        raise exception using errcode='23514',message='CATALOG_DEFINITION_INCOMPATIBLE';
      end if;
    end if;
    insert into public.device_specs(device_id,spec_definition_id,state,value_number,value_boolean,value_text,value_json,
      region,variant,confidence,presentation,updated_by,canonical_unit)
      values(p_device_id,definition_id,coalesce(p_input->>'state','KNOWN')::public.device_spec_state,
        (p_input->>'valueNumber')::numeric,(p_input->>'valueBoolean')::boolean,p_input->>'valueText',
        nullif(p_input->'valueJson','null'::jsonb),coalesce(p_input->>'region','Global'),coalesce(p_input->>'variant',''),
        'LOW',coalesce(p_input->'presentation','{}'::jsonb),auth.uid(),nullif(p_input->'presentation'->>'displayUnit','')) returning id into result_id;
  else
    select * into current_spec from public.device_specs where id=p_spec_id and device_id=p_device_id for update;
    if not found then raise exception using errcode='23514',message='CATALOG_SPEC_NOT_FOUND'; end if;
    if p_input ? 'key' or p_input ? 'valueType' or p_input ? 'region' or p_input ? 'variant' then
      raise exception using errcode='23514',message='CATALOG_SPEC_IDENTITY_LOCKED';
    end if;
    select key into definition_key from public.device_spec_definitions where id=current_spec.spec_definition_id;
    base_unit=coalesce(current_spec.canonical_unit,case definition_key
      when 'basic.weight_g' then 'g' when 'basic.dimensions_mm' then 'mm'
      when 'display.refresh_rate_hz' then 'Hz' when 'display.fov_deg' then '°'
      when 'camera.camera_fov_deg' then '°' when 'display.ipd_mm' then 'mm'
      when 'display.eye_box_mm' then 'mm' when 'battery.battery_capacity_mah' then 'mAh' end);
    display_unit=nullif(p_input->'presentation'->>'displayUnit','');
    if display_unit is not null and (base_unit is null or not (
      display_unit=base_unit or base_unit in ('g','kg') and display_unit in ('g','kg')
      or base_unit in ('mm','cm') and display_unit in ('mm','cm')
      or base_unit in ('Hz','kHz') and display_unit in ('Hz','kHz')
      or base_unit in ('h','min') and display_unit in ('h','min'))) then
      raise exception using errcode='23514',message='CATALOG_UNIT_INCOMPATIBLE';
    end if;
    update public.device_specs set
      state=case when p_input ? 'state' then (p_input->>'state')::public.device_spec_state else state end,
      value_number=case when p_input ? 'valueNumber' then (p_input->>'valueNumber')::numeric else value_number end,
      value_boolean=case when p_input ? 'valueBoolean' then (p_input->>'valueBoolean')::boolean else value_boolean end,
      value_text=case when p_input ? 'valueText' then p_input->>'valueText' else value_text end,
      value_json=case when p_input ? 'valueJson' then nullif(p_input->'valueJson','null'::jsonb) else value_json end,
      presentation=case when p_input ? 'presentation' then p_input->'presentation' else presentation end,
      updated_by=auth.uid(),updated_at=now()
    where id=p_spec_id and device_id=p_device_id returning id into result_id;
  end if;
  insert into public.catalog_audit_events(actor_id,entity_type,entity_id,action,changed_fields)
    values(auth.uid(),'device_spec',result_id,'admin_save',jsonb_build_object('fields',
      (select jsonb_agg(k order by k) from jsonb_object_keys(p_input) k)));
  return result_id;
end;
$$;
revoke all on function public.save_catalog_spec(uuid,uuid,jsonb) from public,anon;
grant execute on function public.save_catalog_spec(uuid,uuid,jsonb) to authenticated;

create function public.save_catalog_group(p_device_id uuid,p_group_key text,p_presentation jsonb)
returns integer language plpgsql security invoker set search_path = '' as $$
declare changed integer;
begin
  if not public.is_catalog_admin() then raise exception using errcode='42501',message='CATALOG_ADMIN_REQUIRED'; end if;
  if p_group_key is null or p_group_key !~ '^[a-z][a-z0-9_-]{0,63}$'
    or not public.catalog_presentation_valid(p_presentation) or exists
    (select 1 from jsonb_object_keys(p_presentation) k where k not in ('groupKey','groupZh','groupEn','groupOrder')) then
    raise exception using errcode='23514',message='CATALOG_GROUP_INPUT_INVALID'; end if;
  perform 1 from public.devices where id=p_device_id for update;
  if not found then raise exception using errcode='23514',message='CATALOG_DEVICE_NOT_FOUND'; end if;
  update public.device_specs s set presentation=s.presentation||p_presentation,updated_by=auth.uid(),updated_at=now()
    from public.device_spec_definitions f where s.spec_definition_id=f.id and s.device_id=p_device_id
      and coalesce(s.presentation->>'groupKey',f.group_key)=p_group_key;
  get diagnostics changed=row_count;
  insert into public.catalog_audit_events(actor_id,entity_type,entity_id,action,changed_fields)
    values(auth.uid(),'device',p_device_id,'admin_group_save',jsonb_build_object('group',p_group_key,'count',changed));
  return changed;
end;
$$;
revoke all on function public.save_catalog_group(uuid,text,jsonb) from public,anon;
grant execute on function public.save_catalog_group(uuid,text,jsonb) to authenticated;

create function public.lock_published_catalog_brand()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.slug_locked and new.brand_key is distinct from old.brand_key then
    raise exception using errcode='23514',message='CATALOG_BRAND_LOCKED';
  end if;
  return new;
end;
$$;
revoke all on function public.lock_published_catalog_brand() from public;
create trigger lock_published_catalog_brand before update on public.devices
for each row execute function public.lock_published_catalog_brand();

create function public.audit_catalog_device_change()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare before_row jsonb; after_row jsonb; fields jsonb;
begin
  if auth.uid() is null then return null; end if;
  if not public.is_catalog_admin() then raise exception using errcode='42501',message='CATALOG_ADMIN_REQUIRED'; end if;
  before_row=case when tg_op='INSERT' then '{}'::jsonb else to_jsonb(old) end;
  after_row=case when tg_op='DELETE' then '{}'::jsonb else to_jsonb(new) end;
  select jsonb_agg(k order by k) into fields from
    (select jsonb_object_keys(before_row||after_row) k) keys
    where k not in ('created_at','updated_at') and before_row->k is distinct from after_row->k;
  if fields is not null then
    insert into public.catalog_audit_events(actor_id,entity_type,entity_id,action,changed_fields)
      values(auth.uid(),'device',coalesce(new.id,old.id),lower(tg_op),jsonb_build_object('fields',fields));
  end if;
  return null;
end;
$$;
revoke all on function public.audit_catalog_device_change() from public;
create trigger audit_catalog_device_change after insert or update or delete on public.devices
for each row execute function public.audit_catalog_device_change();
