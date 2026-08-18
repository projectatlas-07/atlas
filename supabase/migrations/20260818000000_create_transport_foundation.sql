create extension if not exists btree_gist;

create table public.transport_workers (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transport_workers_id_factory_key unique (id, factory_id)
);

create table public.transport_crews (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  name text not null,
  work_direction text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transport_crews_factory_name_key unique (factory_id, name),
  constraint transport_crews_id_factory_key unique (id, factory_id),
  constraint transport_crews_work_direction_check
    check (work_direction in ('FIELD_TO_KILN', 'KILN_TO_FIELD'))
);

create table public.transport_crew_memberships (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  transport_worker_id uuid not null,
  transport_crew_id uuid not null,
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  constraint transport_crew_memberships_id_factory_key
    unique (id, factory_id),
  constraint transport_crew_memberships_effective_dates_check
    check (effective_to is null or effective_to >= effective_from),
  constraint transport_crew_memberships_worker_factory_fkey
    foreign key (transport_worker_id, factory_id)
    references public.transport_workers (id, factory_id) on delete restrict,
  constraint transport_crew_memberships_crew_factory_fkey
    foreign key (transport_crew_id, factory_id)
    references public.transport_crews (id, factory_id) on delete restrict,
  constraint transport_crew_memberships_no_overlapping_dates
    exclude using gist (
      transport_worker_id with =,
      daterange(effective_from, effective_to, '[]') with &&
    )
);

create index transport_workers_factory_active_idx
  on public.transport_workers (factory_id) where is_active;

create index transport_crews_factory_active_idx
  on public.transport_crews (factory_id) where is_active;

create index transport_crew_memberships_factory_worker_from_idx
  on public.transport_crew_memberships (
    factory_id,
    transport_worker_id,
    effective_from desc
  );

create index transport_crew_memberships_crew_from_idx
  on public.transport_crew_memberships (transport_crew_id, effective_from desc);

create trigger transport_workers_set_updated_at
before update on public.transport_workers
for each row execute function public.set_updated_at();

create trigger transport_crews_set_updated_at
before update on public.transport_crews
for each row execute function public.set_updated_at();

alter table public.transport_workers enable row level security;
alter table public.transport_crews enable row level security;
alter table public.transport_crew_memberships enable row level security;

revoke all on public.transport_workers, public.transport_crews,
  public.transport_crew_memberships from anon;
revoke all on public.transport_workers, public.transport_crews,
  public.transport_crew_memberships from authenticated;

grant select, insert, update on public.transport_workers to authenticated;
grant select, insert, update on public.transport_crews to authenticated;
grant select, insert, update on public.transport_crew_memberships to authenticated;

create policy "Authenticated users can read their factory transport workers"
  on public.transport_workers
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = transport_workers.factory_id
        and factory_users.is_active = true
    )
  );

create policy "Authenticated users can insert their factory transport workers"
  on public.transport_workers
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = transport_workers.factory_id
        and factory_users.is_active = true
    )
  );

create policy "Authenticated users can update their factory transport workers"
  on public.transport_workers
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = transport_workers.factory_id
        and factory_users.is_active = true
    )
  )
  with check (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = transport_workers.factory_id
        and factory_users.is_active = true
    )
  );

create policy "Authenticated users can read their factory transport crews"
  on public.transport_crews
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = transport_crews.factory_id
        and factory_users.is_active = true
    )
  );

create policy "Authenticated users can insert their factory transport crews"
  on public.transport_crews
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = transport_crews.factory_id
        and factory_users.is_active = true
    )
  );

create policy "Authenticated users can update their factory transport crews"
  on public.transport_crews
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = transport_crews.factory_id
        and factory_users.is_active = true
    )
  )
  with check (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = transport_crews.factory_id
        and factory_users.is_active = true
    )
  );

create policy "Authenticated users can read their factory transport crew memberships"
  on public.transport_crew_memberships
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = transport_crew_memberships.factory_id
        and factory_users.is_active = true
    )
  );

create policy "Authenticated users can insert their factory transport crew memberships"
  on public.transport_crew_memberships
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = transport_crew_memberships.factory_id
        and factory_users.is_active = true
    )
  );

create policy "Authenticated users can update their factory transport crew memberships"
  on public.transport_crew_memberships
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = transport_crew_memberships.factory_id
        and factory_users.is_active = true
    )
  )
  with check (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = transport_crew_memberships.factory_id
        and factory_users.is_active = true
    )
  );
