-- Synthetic local test data, not authoritative catalog data or seed content.
-- Preserve the relevant existing legacy device timestamp behavior in this
-- minimal bootstrap (the full legacy schema is outside this focused test).
alter table public.devices add column updated_at timestamptz not null default '2000-01-01 UTC';
create function public.set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create trigger trg_devices_set_updated_at before update on public.devices
for each row execute function public.set_updated_at();

insert into public.devices (id, schema_type) values
  ('00000000-0000-0000-0000-000000000001', 'display_ar'),
  ('00000000-0000-0000-0000-000000000002', 'ai_hud'),
  ('00000000-0000-0000-0000-000000000003', null);
insert into public.device_spec_definitions
  (id,key,group_key,label,value_type,canonical_unit,measurement_context,applicable_schema_types) values
  ('00000000-0000-0000-0000-000000000101','synthetic.mass','synthetic','Mass','number','g','mass',array['display_ar']::public.device_schema_type[]),
  ('00000000-0000-0000-0000-000000000102','synthetic.boolean','synthetic','Boolean','boolean',null,null,array['display_ar']::public.device_schema_type[]),
  ('00000000-0000-0000-0000-000000000103','synthetic.text','synthetic','Text','text',null,null,array['display_ar']::public.device_schema_type[]),
  ('00000000-0000-0000-0000-000000000104','synthetic.json','synthetic','JSON','json',null,null,array['display_ar']::public.device_schema_type[]);
insert into public.device_sources (id,publisher,url,source_type,accessed_at) values
  ('00000000-0000-0000-0000-000000000301','Synthetic','https://example.invalid/1','official_manual','2026-09-09'),
  ('00000000-0000-0000-0000-000000000302','Synthetic','https://example.invalid/2','official_manual','2026-09-09'),
  ('00000000-0000-0000-0000-000000000303','Synthetic','https://example.invalid/3','official_manual','2026-09-09');
