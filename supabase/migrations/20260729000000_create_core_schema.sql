create extension if not exists pgcrypto;

create table public.factories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint factories_name_key unique (name)
);

create table public.brick_types (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brick_types_factory_name_key unique (factory_id, name),
  constraint brick_types_id_factory_key unique (id, factory_id)
);

create table public.labourers (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  name text not null,
  assigned_brick_type_id uuid not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint labourers_id_factory_key unique (id, factory_id),
  constraint labourers_assigned_brick_type_factory_fkey
    foreign key (assigned_brick_type_id, factory_id)
    references public.brick_types (id, factory_id) on delete restrict
);

create table public.production_entries (
  id uuid primary key,
  factory_id uuid not null references public.factories(id) on delete restrict,
  labourer_id uuid not null,
  brick_type_id uuid not null,
  production_date date not null,
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint production_entries_labourer_factory_fkey
    foreign key (labourer_id, factory_id)
    references public.labourers (id, factory_id) on delete restrict,
  constraint production_entries_brick_type_factory_fkey
    foreign key (brick_type_id, factory_id)
    references public.brick_types (id, factory_id) on delete restrict
);

create index brick_types_factory_active_idx on public.brick_types (factory_id) where is_active;
create index labourers_factory_active_idx on public.labourers (factory_id) where is_active;
create index production_entries_factory_date_idx on public.production_entries (factory_id, production_date desc);
create index production_entries_labourer_date_idx on public.production_entries (labourer_id, production_date desc);
create index production_entries_brick_type_date_idx on public.production_entries (brick_type_id, production_date desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger factories_set_updated_at before update on public.factories
for each row execute function public.set_updated_at();

create trigger brick_types_set_updated_at before update on public.brick_types
for each row execute function public.set_updated_at();

create trigger labourers_set_updated_at before update on public.labourers
for each row execute function public.set_updated_at();

create trigger production_entries_set_updated_at before update on public.production_entries
for each row execute function public.set_updated_at();
