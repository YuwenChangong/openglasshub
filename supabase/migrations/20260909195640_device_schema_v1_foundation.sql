-- Database Schema v1 Release A: additive, data-free foundation.
-- Definition enforcement and catalog-admin policies are added by the next tasks.
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
  constraint device_specs_identity_context_key unique (device_id, spec_definition_id, region_key, variant_key)
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
