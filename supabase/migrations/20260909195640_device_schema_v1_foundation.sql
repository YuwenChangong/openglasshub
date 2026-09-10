-- Database Schema v1 Release A: additive, data-free foundation.
-- Catalog-admin policies are added by the next task.
-- RLS starts closed on every new table; existing devices policies stay intact.

create type public.device_schema_type as enum ('display_ar', 'ai_hud');
create type public.device_presentation_profile as enum ('display', 'ai_camera', 'hud', 'developer');
create type public.device_spec_value_type as enum ('number', 'boolean', 'text', 'json');
create type public.device_spec_state as enum (
  'KNOWN', 'NOT_DISCLOSED', 'NOT_APPLICABLE', 'CONFLICT', 'UNKNOWN_UNVERIFIED'
);
create type public.device_spec_confidence as enum ('HIGH', 'MEDIUM_HIGH', 'MEDIUM', 'LOW');
create type public.device_spec_comparison_mode as enum ('higher', 'lower', 'equal_only', 'none');
create type public.device_source_type as enum (
  'current_official_product_page', 'official_manual', 'official_spec_sheet',
  'official_developer_docs', 'official_faq', 'regulatory_document',
  'archived_official', 'reputable_secondary'
);

alter table public.devices add column if not exists generation text;
alter table public.devices add column if not exists schema_type public.device_schema_type;
alter table public.devices add column if not exists device_type text;
alter table public.devices add column if not exists presentation_profile public.device_presentation_profile;
alter table public.devices add column if not exists status text;
alter table public.devices add column if not exists release_date date;
alter table public.devices add column if not exists last_verified_at date;

create table if not exists public.device_spec_definitions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  group_key text not null,
  label text not null,
  help_text text,
  value_type public.device_spec_value_type not null,
  canonical_unit text,
  measurement_context text,
  comparison_mode public.device_spec_comparison_mode not null default 'none',
  require_same_context boolean not null default true,
  applicable_schema_types public.device_schema_type[] not null,
  is_core boolean not null default false,
  admin_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint device_spec_definitions_key_nonblank check (length(btrim(key)) > 0)
);

create table if not exists public.device_specs (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete restrict,
  spec_definition_id uuid not null references public.device_spec_definitions(id) on delete restrict,
  state public.device_spec_state not null,
  value_number numeric,
  value_boolean boolean,
  value_text text,
  value_json jsonb,
  canonical_unit text,
  measurement_context text,
  raw_value text,
  region text default 'Global',
  variant text default '',
  region_key text generated always as (coalesce(region, 'Global')) stored,
  variant_key text generated always as (coalesce(variant, '')) stored,
  confidence public.device_spec_confidence not null,
  verified_at date,
  note text,
  updated_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint device_specs_identity_context_key unique (device_id, spec_definition_id, region_key, variant_key),
  constraint "DEVICE_SPEC_STATE_VALUE_MISMATCH" check (
    (state = 'KNOWN' and num_nonnulls(value_number, value_boolean, value_text, value_json) = 1)
    or (state in ('NOT_DISCLOSED', 'NOT_APPLICABLE', 'UNKNOWN_UNVERIFIED')
      and num_nonnulls(value_number, value_boolean, value_text, value_json) = 0)
    or (state = 'CONFLICT' and raw_value is not null and raw_value ~ '[^[:space:]]'
      and num_nonnulls(value_number, value_boolean, value_text, value_json) <= 1)
  )
);

create table if not exists public.device_sources (
  id uuid primary key default gen_random_uuid(),
  publisher text not null,
  title text,
  url text not null unique,
  source_type public.device_source_type not null,
  published_at date,
  accessed_at date not null,
  region text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.device_source_links (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete restrict,
  source_id uuid not null references public.device_sources(id) on delete restrict,
  is_primary boolean not null default false,
  note text,
  created_at timestamptz not null default now(),
  constraint device_source_links_device_source_key unique (device_id, source_id)
);

create table if not exists public.device_spec_evidence (
  id uuid primary key default gen_random_uuid(),
  device_spec_id uuid not null references public.device_specs(id) on delete restrict,
  source_id uuid not null references public.device_sources(id) on delete restrict,
  claimed_value text not null,
  is_primary boolean not null default false,
  is_conflicting boolean not null default false,
  note text,
  created_at timestamptz not null default now(),
  constraint device_spec_evidence_claim_key unique (device_spec_id, source_id, claimed_value),
  constraint device_spec_evidence_primary_not_conflicting check (not (is_primary and is_conflicting))
);

-- Foundation only: no Release C writer or public read surface is introduced.
create table if not exists public.catalog_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete restrict,
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  changed_fields jsonb not null,
  created_at timestamptz not null default now()
);

-- Unique keys already index their leading foreign-key columns. These indexes
-- cover reverse reference checks and the remaining lookup paths.
create index if not exists device_specs_definition_idx on public.device_specs (spec_definition_id);
create index if not exists device_specs_updated_by_idx on public.device_specs (updated_by);
create index if not exists device_source_links_source_idx on public.device_source_links (source_id);
create unique index if not exists device_source_links_one_primary_idx
  on public.device_source_links (device_id) where is_primary = true;
create index if not exists device_spec_evidence_source_idx on public.device_spec_evidence (source_id);
create unique index if not exists device_spec_evidence_one_primary_idx
  on public.device_spec_evidence (device_spec_id) where is_primary = true;
create index if not exists catalog_audit_events_actor_idx on public.catalog_audit_events (actor_id);
create index if not exists catalog_audit_events_entity_idx
  on public.catalog_audit_events (entity_type, entity_id, created_at);

alter table public.device_spec_definitions enable row level security;
alter table public.device_specs enable row level security;
alter table public.device_sources enable row level security;
alter table public.device_source_links enable row level security;
alter table public.device_spec_evidence enable row level security;
alter table public.catalog_audit_events enable row level security;

-- Invoker triggers retain the caller's table permissions and RLS. All object
-- references are qualified; no function exposes a privileged lookup endpoint.
create or replace function public.enforce_device_spec_definition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  definition public.device_spec_definitions%rowtype;
  schema_type public.device_schema_type;
  typed_count integer := num_nonnulls(new.value_number, new.value_boolean, new.value_text, new.value_json);
begin
  -- Give stable diagnostics before ordinary CHECK/FK errors, including when
  -- several incompatible typed columns were supplied in the same request.
  if (new.state = 'KNOWN' and typed_count <> 1)
    or (new.state in ('NOT_DISCLOSED', 'NOT_APPLICABLE', 'UNKNOWN_UNVERIFIED') and typed_count <> 0)
    or (new.state = 'CONFLICT' and (typed_count > 1 or new.raw_value is null or new.raw_value !~ '[^[:space:]]')) then
    raise exception using errcode = '23514', message = 'DEVICE_SPEC_STATE_VALUE_MISMATCH';
  end if;

  -- A first/new reference writes a tuple version without changing metadata.
  -- A lock alone lets an older REPEATABLE READ definition editor miss the new
  -- reference. The write forces that editor to retry with a fresh snapshot.
  if tg_op = 'INSERT' or new.spec_definition_id is distinct from old.spec_definition_id then
    update public.device_spec_definitions set updated_at = updated_at
      where id = new.spec_definition_id returning * into definition;
  else
    select * into definition from public.device_spec_definitions
      where id = new.spec_definition_id for share;
  end if;
  if not found then
    raise exception using errcode = '23514', message = 'DEVICE_SPEC_UNKNOWN_DEFINITION';
  end if;
  if tg_op = 'INSERT' or new.device_id is distinct from old.device_id then
    update public.devices d set schema_type = d.schema_type
      where d.id = new.device_id returning d.schema_type into schema_type;
  else
    select d.schema_type into schema_type from public.devices d
      where d.id = new.device_id for share;
  end if;
  if (schema_type = any(definition.applicable_schema_types)) is not true then
    raise exception using errcode = '23514', message = 'DEVICE_SPEC_SCHEMA_TYPE_DISALLOWED';
  end if;
  if (new.value_number is not null and definition.value_type <> 'number')
    or (new.value_boolean is not null and definition.value_type <> 'boolean')
    or (new.value_text is not null and definition.value_type <> 'text')
    or (new.value_json is not null and definition.value_type <> 'json') then
    raise exception using errcode = '23514', message = 'DEVICE_SPEC_VALUE_TYPE_MISMATCH';
  end if;
  if new.canonical_unit is distinct from definition.canonical_unit then
    raise exception using errcode = '23514', message = 'DEVICE_SPEC_UNIT_MISMATCH';
  end if;
  if new.measurement_context is distinct from definition.measurement_context then
    raise exception using errcode = '23514', message = 'DEVICE_SPEC_CONTEXT_MISMATCH';
  end if;
  return new;
end;
$$;

create trigger enforce_device_spec_definition
before insert or update on public.device_specs
for each row execute function public.enforce_device_spec_definition();

-- Applicability must also survive edits to the parent device. First references
-- above write its tuple so an older schema editor cannot miss a newly added spec.
create or replace function public.prevent_incompatible_device_schema_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.schema_type is distinct from old.schema_type and exists (
    select 1 from public.device_specs s
    join public.device_spec_definitions d on d.id = s.spec_definition_id
    where s.device_id = old.id
      and (new.schema_type = any(d.applicable_schema_types)) is not true
  ) then
    raise exception using errcode = '23514', message = 'DEVICE_SPEC_SCHEMA_TYPE_DISALLOWED';
  end if;
  return new;
end;
$$;

create trigger prevent_incompatible_device_schema_change
before update of schema_type on public.devices
for each row execute function public.prevent_incompatible_device_schema_change();

create or replace function public.prevent_device_spec_definition_semantic_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.device_specs where spec_definition_id = old.id) then
    if tg_op = 'DELETE' then
      raise exception using errcode = '23514', message = 'DEVICE_SPEC_DEFINITION_REFERENCED';
    end if;
    if row(new.key, new.value_type, new.canonical_unit, new.measurement_context,
           new.comparison_mode, new.require_same_context, new.applicable_schema_types)
      is distinct from
       row(old.key, old.value_type, old.canonical_unit, old.measurement_context,
           old.comparison_mode, old.require_same_context, old.applicable_schema_types) then
      raise exception using errcode = '23514', message = 'DEVICE_SPEC_DEFINITION_SEMANTIC_CHANGE';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger prevent_device_spec_definition_semantic_change
before update or delete on public.device_spec_definitions
for each row execute function public.prevent_device_spec_definition_semantic_change();

create or replace function public.serialize_device_spec_evidence_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  affected_ids uuid[] := '{}';
  affected_id uuid;
begin
  if tg_op <> 'INSERT' then affected_ids := array_append(affected_ids, old.device_spec_id); end if;
  if tg_op <> 'DELETE' then affected_ids := array_append(affected_ids, new.device_spec_id); end if;
  for affected_id in select distinct unnest(affected_ids) order by 1 loop
    -- Serialize evidence mutations and state transitions using the same tuple.
    -- The no-op write also prevents stale-snapshot write skew at REPEATABLE
    -- READ; all application-visible values, including updated_at, stay intact.
    update public.device_specs set updated_at = updated_at where id = affected_id;
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger serialize_device_spec_evidence_change
before insert or update or delete on public.device_spec_evidence
for each row execute function public.serialize_device_spec_evidence_change();

create or replace function public.validate_device_spec_conflict_evidence()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  affected_ids uuid[] := '{}';
  affected_id uuid;
  current_state public.device_spec_state;
  primary_count bigint;
  conflicting_count bigint;
begin
  if tg_table_name = 'device_specs' then
    if tg_op <> 'INSERT' then affected_ids := array_append(affected_ids, old.id); end if;
    if tg_op <> 'DELETE' then affected_ids := array_append(affected_ids, new.id); end if;
  else
    if tg_op <> 'INSERT' then affected_ids := array_append(affected_ids, old.device_spec_id); end if;
    if tg_op <> 'DELETE' then affected_ids := array_append(affected_ids, new.device_spec_id); end if;
  end if;
  for affected_id in select distinct unnest(affected_ids) order by 1 loop
    select state into current_state from public.device_specs where id = affected_id for update;
    -- A spec deleted in this transaction has no final invariant to validate.
    if not found then continue; end if;
    select count(*) filter (where is_primary and not is_conflicting),
           count(*) filter (where not is_primary and is_conflicting)
      into primary_count, conflicting_count
      from public.device_spec_evidence where device_spec_id = affected_id;
    if (current_state = 'CONFLICT' and (primary_count <> 1 or conflicting_count < 1))
      or (current_state <> 'CONFLICT' and conflicting_count <> 0) then
      raise exception using errcode = '23514', message = 'DEVICE_SPEC_EVIDENCE_CONFLICT_INVARIANT';
    end if;
  end loop;
  return null;
end;
$$;

create constraint trigger device_specs_conflict_evidence
after insert or update or delete on public.device_specs
deferrable initially deferred
for each row execute function public.validate_device_spec_conflict_evidence();

create constraint trigger device_spec_evidence_conflict
after insert or update or delete on public.device_spec_evidence
deferrable initially deferred
for each row execute function public.validate_device_spec_conflict_evidence();

create or replace function public.prevent_catalog_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '23514', message = 'CATALOG_AUDIT_APPEND_ONLY';
end;
$$;

create trigger catalog_audit_events_append_only
before update or delete on public.catalog_audit_events
for each row execute function public.prevent_catalog_audit_mutation();
