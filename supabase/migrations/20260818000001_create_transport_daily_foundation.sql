create table public.transport_daily_entries (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  transport_crew_id uuid not null,
  work_date date not null,
  paya_quantity numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transport_daily_entries_id_parent_key
    unique (id, factory_id, transport_crew_id, work_date),
  constraint transport_daily_entries_factory_crew_date_key
    unique (factory_id, transport_crew_id, work_date),
  constraint transport_daily_entries_paya_quantity_check
    check (paya_quantity > 0 and paya_quantity <> 'NaN'::numeric),
  constraint transport_daily_entries_crew_factory_fkey
    foreign key (transport_crew_id, factory_id)
    references public.transport_crews (id, factory_id) on delete restrict
);

create table public.transport_daily_attendance (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  transport_daily_entry_id uuid not null,
  transport_crew_id uuid not null,
  transport_worker_id uuid not null,
  work_date date not null,
  created_at timestamptz not null default now(),
  constraint transport_daily_attendance_id_factory_key
    unique (id, factory_id),
  constraint transport_daily_attendance_worker_day_key
    unique (factory_id, transport_worker_id, work_date),
  constraint transport_daily_attendance_parent_fkey
    foreign key (
      transport_daily_entry_id,
      factory_id,
      transport_crew_id,
      work_date
    )
    references public.transport_daily_entries (
      id,
      factory_id,
      transport_crew_id,
      work_date
    ) on delete restrict,
  constraint transport_daily_attendance_worker_factory_fkey
    foreign key (transport_worker_id, factory_id)
    references public.transport_workers (id, factory_id) on delete restrict
);

create or replace function public.validate_transport_daily_attendance_membership()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1
    from public.transport_crew_memberships
    where transport_crew_memberships.factory_id = new.factory_id
      and transport_crew_memberships.transport_worker_id = new.transport_worker_id
      and transport_crew_memberships.transport_crew_id = new.transport_crew_id
      and transport_crew_memberships.effective_from <= new.work_date
      and (
        transport_crew_memberships.effective_to is null
        or transport_crew_memberships.effective_to >= new.work_date
      )
  ) then
    raise exception 'Transport worker is not a member of this crew on work date %.',
      new.work_date
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_transport_daily_attendance_membership()
  from public;
revoke all on function public.validate_transport_daily_attendance_membership()
  from anon;
revoke all on function public.validate_transport_daily_attendance_membership()
  from authenticated;

create constraint trigger transport_daily_attendance_validate_membership
after insert or update
on public.transport_daily_attendance
for each row execute function public.validate_transport_daily_attendance_membership();

create index transport_daily_entries_factory_date_idx
  on public.transport_daily_entries (factory_id, work_date desc);

create index transport_daily_attendance_entry_idx
  on public.transport_daily_attendance (transport_daily_entry_id);

create index transport_daily_attendance_crew_date_idx
  on public.transport_daily_attendance (
    factory_id,
    transport_crew_id,
    work_date desc
  );

create trigger transport_daily_entries_set_updated_at
before update on public.transport_daily_entries
for each row execute function public.set_updated_at();

alter table public.transport_daily_entries enable row level security;
alter table public.transport_daily_attendance enable row level security;

revoke all on public.transport_daily_entries, public.transport_daily_attendance
  from anon;
revoke all on public.transport_daily_entries, public.transport_daily_attendance
  from authenticated;

grant select on public.transport_daily_entries to authenticated;
grant select on public.transport_daily_attendance to authenticated;

create policy "Authenticated users can read their factory transport daily entries"
  on public.transport_daily_entries
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = transport_daily_entries.factory_id
        and factory_users.is_active = true
    )
  );

create policy "Authenticated users can read their factory transport daily attendance"
  on public.transport_daily_attendance
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = transport_daily_attendance.factory_id
        and factory_users.is_active = true
    )
  );
