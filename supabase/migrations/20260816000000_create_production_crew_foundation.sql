create extension if not exists btree_gist;

create table public.production_crews (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint production_crews_factory_name_key unique (factory_id, name),
  constraint production_crews_id_factory_key unique (id, factory_id)
);

create table public.production_crew_assignments (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  labourer_id uuid not null,
  production_crew_id uuid not null,
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint production_crew_assignments_id_factory_key
    unique (id, factory_id),
  constraint production_crew_assignments_effective_dates_check
    check (effective_to is null or effective_to >= effective_from),
  constraint production_crew_assignments_labourer_factory_fkey
    foreign key (labourer_id, factory_id)
    references public.labourers (id, factory_id) on delete restrict,
  constraint production_crew_assignments_crew_factory_fkey
    foreign key (production_crew_id, factory_id)
    references public.production_crews (id, factory_id) on delete restrict,
  constraint production_crew_assignments_no_overlapping_dates
    exclude using gist (
      labourer_id with =,
      daterange(effective_from, effective_to, '[]') with &&
    )
);

create index production_crews_factory_active_idx
  on public.production_crews (factory_id) where is_active;

create index production_crew_assignments_factory_labourer_from_idx
  on public.production_crew_assignments (factory_id, labourer_id, effective_from desc);

create index production_crew_assignments_crew_from_idx
  on public.production_crew_assignments (production_crew_id, effective_from desc);

create trigger production_crews_set_updated_at
before update on public.production_crews
for each row execute function public.set_updated_at();

create trigger production_crew_assignments_set_updated_at
before update on public.production_crew_assignments
for each row execute function public.set_updated_at();

alter table public.production_crews enable row level security;
alter table public.production_crew_assignments enable row level security;

revoke all on public.production_crews, public.production_crew_assignments from anon;
revoke all on public.production_crews, public.production_crew_assignments from authenticated;

grant select, insert, update on public.production_crews to authenticated;
grant select, insert, update on public.production_crew_assignments to authenticated;

create policy "Authenticated users can read their factory production crews"
  on public.production_crews
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = production_crews.factory_id
        and factory_users.is_active = true
    )
  );

create policy "Authenticated users can insert their factory production crews"
  on public.production_crews
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = production_crews.factory_id
        and factory_users.is_active = true
    )
  );

create policy "Authenticated users can update their factory production crews"
  on public.production_crews
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = production_crews.factory_id
        and factory_users.is_active = true
    )
  )
  with check (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = production_crews.factory_id
        and factory_users.is_active = true
    )
  );

create policy "Authenticated users can read their factory production crew assignments"
  on public.production_crew_assignments
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = production_crew_assignments.factory_id
        and factory_users.is_active = true
    )
  );

create policy "Authenticated users can insert their factory production crew assignments"
  on public.production_crew_assignments
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = production_crew_assignments.factory_id
        and factory_users.is_active = true
    )
  );

create policy "Authenticated users can update their factory production crew assignments"
  on public.production_crew_assignments
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = production_crew_assignments.factory_id
        and factory_users.is_active = true
    )
  )
  with check (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = production_crew_assignments.factory_id
        and factory_users.is_active = true
    )
  );
