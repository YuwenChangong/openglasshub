-- Public SSR is anonymous. Authenticated catalog-admin policies and grants
-- remain unchanged; adding public policies to that shared role would expose
-- its existing internal-column SELECT privileges to ordinary signed-in users.
grant select (id, key, group_key, label, help_text, value_type, canonical_unit,
  measurement_context, applicable_schema_types, is_active, admin_order)
on public.device_spec_definitions to anon;
grant select (id, device_id, spec_definition_id, state, value_number,
  value_boolean, value_text, value_json, canonical_unit, measurement_context,
  region, variant, confidence, verified_at)
on public.device_specs to anon;
grant select (id, publisher, title, url, source_type, published_at, accessed_at, region)
on public.device_sources to anon;
grant select (id, device_id, source_id, is_primary)
on public.device_source_links to anon;
grant select (id, device_spec_id, source_id, claimed_value, is_primary, is_conflicting)
on public.device_spec_evidence to anon;

create policy device_detail_active_definitions on public.device_spec_definitions
for select to anon using (is_active);
create policy device_detail_public_specs on public.device_specs
for select to anon using (
  state in ('KNOWN', 'NOT_DISCLOSED', 'NOT_APPLICABLE', 'CONFLICT')
  and exists (select 1 from public.devices d
    where d.id = device_id and d.publication_status = 'published')
  and exists (select 1 from public.device_spec_definitions definition
    where definition.id = spec_definition_id and definition.is_active)
);
create policy device_detail_public_links on public.device_source_links
for select to anon using (exists (select 1 from public.devices d
  where d.id = device_id and d.publication_status = 'published'));
create policy device_detail_public_evidence on public.device_spec_evidence
for select to anon using (exists (select 1 from public.device_specs spec
  where spec.id = device_spec_id));
create policy device_detail_reachable_sources on public.device_sources
for select to anon using (
  exists (select 1 from public.device_source_links link where link.source_id = device_sources.id)
  or exists (select 1 from public.device_spec_evidence evidence where evidence.source_id = device_sources.id)
);

create view public.public_device_detail_specs
with (security_invoker = true, security_barrier = true) as
select d.slug as device_slug, spec.id, definition.key, definition.group_key,
  definition.label, definition.value_type, definition.admin_order,
  spec.state, spec.value_number, spec.value_boolean, spec.value_text,
  spec.value_json, spec.canonical_unit, spec.measurement_context,
  spec.region, spec.variant, spec.confidence, spec.verified_at
from public.device_specs spec
join public.device_spec_definitions definition on definition.id = spec.spec_definition_id
join public.devices d on d.id = spec.device_id
where d.publication_status = 'published' and definition.is_active
  and spec.state in ('KNOWN', 'NOT_DISCLOSED', 'NOT_APPLICABLE', 'CONFLICT');

create view public.public_device_detail_sources
with (security_invoker = true, security_barrier = true) as
select d.slug as device_slug, source.id, source.publisher, source.title,
  source.url, source.source_type, source.published_at, source.accessed_at, source.region
from public.device_source_links link
join public.device_sources source on source.id = link.source_id
join public.devices d on d.id = link.device_id
where d.publication_status = 'published'
union
select d.slug as device_slug, source.id, source.publisher, source.title,
  source.url, source.source_type, source.published_at, source.accessed_at, source.region
from public.device_spec_evidence evidence
join public.device_sources source on source.id = evidence.source_id
join public.device_specs spec on spec.id = evidence.device_spec_id
join public.device_spec_definitions definition on definition.id = spec.spec_definition_id
join public.devices d on d.id = spec.device_id
where d.publication_status = 'published' and definition.is_active
  and spec.state in ('KNOWN', 'NOT_DISCLOSED', 'NOT_APPLICABLE', 'CONFLICT');

create view public.public_device_detail_evidence
with (security_invoker = true, security_barrier = true) as
select d.slug as device_slug, spec.id as spec_id, definition.key,
  spec.region, spec.variant, evidence.source_id, evidence.claimed_value,
  evidence.is_primary, evidence.is_conflicting
from public.device_spec_evidence evidence
join public.device_specs spec on spec.id = evidence.device_spec_id
join public.device_spec_definitions definition on definition.id = spec.spec_definition_id
join public.devices d on d.id = spec.device_id
where d.publication_status = 'published' and definition.is_active
  and spec.state in ('KNOWN', 'NOT_DISCLOSED', 'NOT_APPLICABLE', 'CONFLICT');

revoke all on public.public_device_detail_specs, public.public_device_detail_sources,
  public.public_device_detail_evidence from public, anon, authenticated;
grant select on public.public_device_detail_specs, public.public_device_detail_sources,
  public.public_device_detail_evidence to anon;
