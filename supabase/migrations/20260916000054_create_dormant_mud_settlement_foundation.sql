begin;

-- Mud Multi-Group Phase 3: dormant factory-wide settlement snapshots.
-- No existing financial RPC calls these functions and every factory remains
-- LEGACY_WEEKLY. Real withdrawal integration belongs to a later milestone.

create table public.mud_factory_settlements (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  previous_cutoff date,
  settled_through date not null,
  settlement_type text not null,
  triggering_labour_group_id uuid,
  triggering_withdrawal_id uuid references public.withdrawals(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint mud_factory_settlements_id_factory_key unique (id, factory_id),
  constraint mud_factory_settlements_trigger_group_factory_fkey
    foreign key (triggering_labour_group_id, factory_id)
    references public.labour_groups(id, factory_id) on delete restrict,
  constraint mud_factory_settlements_dates_check check (
    isfinite(settled_through)
    and (previous_cutoff is null or (
      isfinite(previous_cutoff) and previous_cutoff <= settled_through
    ))
  ),
  constraint mud_factory_settlements_type_check
    check (settlement_type in ('legacy_opening', 'checkpoint')),
  constraint mud_factory_settlements_context_check check (
    (settlement_type = 'legacy_opening'
      and previous_cutoff is null
      and triggering_labour_group_id is null
      and triggering_withdrawal_id is null)
    or
    (settlement_type = 'checkpoint'
      and (triggering_withdrawal_id is null or triggering_labour_group_id is not null))
  )
);

create unique index mud_factory_settlements_one_legacy_opening_idx
  on public.mud_factory_settlements(factory_id)
  where settlement_type = 'legacy_opening';

create unique index mud_factory_settlements_triggering_withdrawal_idx
  on public.mud_factory_settlements(triggering_withdrawal_id)
  where triggering_withdrawal_id is not null;

create index mud_factory_settlements_cutoff_idx
  on public.mud_factory_settlements(factory_id, settled_through desc, created_at desc, id desc);

create table public.mud_factory_settlement_days (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null,
  factory_id uuid not null,
  work_date date not null,
  eligible_factory_production bigint not null,
  total_active_mud_members bigint not null,
  created_at timestamptz not null default now(),
  constraint mud_factory_settlement_days_identity_key
    unique (settlement_id, factory_id, work_date),
  constraint mud_factory_settlement_days_factory_date_key
    unique (factory_id, work_date),
  constraint mud_factory_settlement_days_settlement_fkey
    foreign key (settlement_id, factory_id)
    references public.mud_factory_settlements(id, factory_id) on delete restrict,
  constraint mud_factory_settlement_days_work_date_check check (isfinite(work_date)),
  constraint mud_factory_settlement_days_production_check
    check (eligible_factory_production >= 0),
  constraint mud_factory_settlement_days_members_check
    check (total_active_mud_members > 0)
);

create index mud_factory_settlement_days_settlement_idx
  on public.mud_factory_settlement_days(settlement_id, work_date);

create table public.mud_group_settlement_days (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null,
  factory_id uuid not null,
  work_date date not null,
  labour_group_id uuid not null,
  mud_group_term_id uuid not null,
  member_count integer not null,
  allocated_production bigint not null,
  mud_group_rate_id uuid not null,
  rate_per_1000_bricks numeric not null,
  earned_amount numeric not null,
  created_at timestamptz not null default now(),
  constraint mud_group_settlement_days_account_date_key
    unique (factory_id, work_date, labour_group_id),
  constraint mud_group_settlement_days_parent_fkey
    foreign key (settlement_id, factory_id, work_date)
    references public.mud_factory_settlement_days(settlement_id, factory_id, work_date)
    on delete restrict,
  constraint mud_group_settlement_days_group_factory_fkey
    foreign key (labour_group_id, factory_id)
    references public.labour_groups(id, factory_id) on delete restrict,
  constraint mud_group_settlement_days_term_fkey
    foreign key (mud_group_term_id, factory_id, labour_group_id)
    references public.mud_group_terms(id, factory_id, labour_group_id) on delete restrict,
  constraint mud_group_settlement_days_rate_fkey
    foreign key (mud_group_rate_id, factory_id, labour_group_id)
    references public.mud_group_rates(id, factory_id, labour_group_id) on delete restrict,
  constraint mud_group_settlement_days_work_date_check check (isfinite(work_date)),
  constraint mud_group_settlement_days_member_count_check check (member_count > 0),
  constraint mud_group_settlement_days_production_check check (allocated_production >= 0),
  constraint mud_group_settlement_days_rate_check check (
    rate_per_1000_bricks > 0
    and rate_per_1000_bricks <> 'NaN'::numeric
    and rate_per_1000_bricks <> 'Infinity'::numeric
    and rate_per_1000_bricks <> '-Infinity'::numeric
  ),
  constraint mud_group_settlement_days_amount_check check (
    earned_amount >= 0
    and earned_amount <> 'NaN'::numeric
    and earned_amount <> 'Infinity'::numeric
    and earned_amount <> '-Infinity'::numeric
  )
);

create index mud_group_settlement_days_settlement_idx
  on public.mud_group_settlement_days(settlement_id, work_date, labour_group_id);

create table public.mud_group_legacy_openings (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null,
  factory_id uuid not null,
  labour_group_id uuid not null,
  legacy_cutoff date not null,
  locked_weekly_earned numeric not null,
  created_at timestamptz not null default now(),
  constraint mud_group_legacy_openings_group_key unique (factory_id, labour_group_id),
  constraint mud_group_legacy_openings_settlement_group_key
    unique (settlement_id, factory_id, labour_group_id),
  constraint mud_group_legacy_openings_settlement_fkey
    foreign key (settlement_id, factory_id)
    references public.mud_factory_settlements(id, factory_id) on delete restrict,
  constraint mud_group_legacy_openings_group_factory_fkey
    foreign key (labour_group_id, factory_id)
    references public.labour_groups(id, factory_id) on delete restrict,
  constraint mud_group_legacy_openings_cutoff_check check (isfinite(legacy_cutoff)),
  constraint mud_group_legacy_openings_amount_check check (
    locked_weekly_earned >= 0
    and locked_weekly_earned <> 'NaN'::numeric
    and locked_weekly_earned <> 'Infinity'::numeric
    and locked_weekly_earned <> '-Infinity'::numeric
  )
);

alter table public.mud_factory_settlements enable row level security;
alter table public.mud_factory_settlement_days enable row level security;
alter table public.mud_group_settlement_days enable row level security;
alter table public.mud_group_legacy_openings enable row level security;

revoke all on public.mud_factory_settlements,
  public.mud_factory_settlement_days,
  public.mud_group_settlement_days,
  public.mud_group_legacy_openings
  from anon, authenticated;

grant select on public.mud_factory_settlements,
  public.mud_factory_settlement_days,
  public.mud_group_settlement_days,
  public.mud_group_legacy_openings
  to authenticated;

create policy "Authenticated users can read their factory Mud settlements"
  on public.mud_factory_settlements for select to authenticated
  using (
    exists (
      select 1 from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = mud_factory_settlements.factory_id
        and factory_users.is_active = true
    )
  );

create policy "Authenticated users can read their factory Mud settlement days"
  on public.mud_factory_settlement_days for select to authenticated
  using (
    exists (
      select 1 from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = mud_factory_settlement_days.factory_id
        and factory_users.is_active = true
    )
  );

create policy "Authenticated users can read their factory Mud group settlement days"
  on public.mud_group_settlement_days for select to authenticated
  using (
    exists (
      select 1 from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = mud_group_settlement_days.factory_id
        and factory_users.is_active = true
    )
  );

create policy "Authenticated users can read their factory Mud legacy openings"
  on public.mud_group_legacy_openings for select to authenticated
  using (
    exists (
      select 1 from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = mud_group_legacy_openings.factory_id
        and factory_users.is_active = true
    )
  );

create or replace function public.reject_mud_settlement_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'Mud settlement snapshots are immutable.' using errcode = 'P2901';
end;
$$;

create trigger mud_factory_settlements_immutable
before update or delete on public.mud_factory_settlements
for each row execute function public.reject_mud_settlement_mutation();

create trigger mud_factory_settlement_days_immutable
before update or delete on public.mud_factory_settlement_days
for each row execute function public.reject_mud_settlement_mutation();

create trigger mud_group_settlement_days_immutable
before update or delete on public.mud_group_settlement_days
for each row execute function public.reject_mud_settlement_mutation();

create trigger mud_group_legacy_openings_immutable
before update or delete on public.mud_group_legacy_openings
for each row execute function public.reject_mud_settlement_mutation();

create or replace function public.create_mud_factory_settlement(
  p_factory_id uuid,
  p_settled_through date,
  p_triggering_labour_group_id uuid default null,
  p_triggering_withdrawal_id uuid default null
)
returns table (
  settlement_id uuid,
  previous_cutoff date,
  settled_through date,
  daily_snapshots integer,
  group_snapshots integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  resolved_previous_cutoff date;
  first_term_date date;
  work_date_cursor date;
  new_settlement_id uuid := gen_random_uuid();
  inserted_daily_count integer := 0;
  inserted_group_count integer := 0;
  current_group_count integer;
  day_eligible_production bigint;
  day_allocated_production bigint;
begin
  if p_factory_id is null or p_settled_through is null or not isfinite(p_settled_through) then
    raise exception 'Factory and finite settlement cutoff are required.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.factories where factories.id = p_factory_id) then
    raise exception 'Factory does not exist.' using errcode = '42501';
  end if;
  if p_triggering_labour_group_id is not null and not exists (
    select 1 from public.labour_groups
    where labour_groups.id = p_triggering_labour_group_id
      and labour_groups.factory_id = p_factory_id
  ) then
    raise exception 'Triggering Mud group does not belong to this factory.' using errcode = '42501';
  end if;
  if p_triggering_withdrawal_id is not null then
    if p_triggering_labour_group_id is null or not exists (
      select 1 from public.withdrawals
      where withdrawals.id = p_triggering_withdrawal_id
        and withdrawals.factory_id = p_factory_id
        and withdrawals.labour_group_id = p_triggering_labour_group_id
        and withdrawals.labourer_id is null
    ) then
      raise exception 'Triggering withdrawal does not belong to the triggering Mud group.' using errcode = '42501';
    end if;
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_factory_id::text), hashtext('mud_factory_settlement')
  );

  select max(settlements.settled_through)
  into resolved_previous_cutoff
  from public.mud_factory_settlements as settlements
  where settlements.factory_id = p_factory_id;

  if resolved_previous_cutoff is not null and p_settled_through < resolved_previous_cutoff then
    raise exception 'Mud settlement cutoff cannot move backward from %.', resolved_previous_cutoff
      using errcode = 'P2902';
  end if;

  select min(terms.effective_from)
  into first_term_date
  from public.mud_group_terms as terms
  where terms.factory_id = p_factory_id;

  if resolved_previous_cutoff is null and first_term_date is null then
    raise exception 'No Mud group term exists for this factory.' using errcode = 'P2903';
  end if;
  if resolved_previous_cutoff is null and p_settled_through < first_term_date then
    raise exception 'Settlement cutoff is before the first Mud group term.' using errcode = 'P2903';
  end if;

  insert into public.mud_factory_settlements(
    id, factory_id, previous_cutoff, settled_through, settlement_type,
    triggering_labour_group_id, triggering_withdrawal_id
  ) values (
    new_settlement_id, p_factory_id, resolved_previous_cutoff, p_settled_through,
    'checkpoint', p_triggering_labour_group_id, p_triggering_withdrawal_id
  );

  -- Equal cutoffs are auditable checkpoints with no repeated earning rows.
  if resolved_previous_cutoff is not null and p_settled_through = resolved_previous_cutoff then
    settlement_id := new_settlement_id;
    previous_cutoff := resolved_previous_cutoff;
    settled_through := p_settled_through;
    daily_snapshots := 0;
    group_snapshots := 0;
    return next;
    return;
  end if;

  -- Keep the two reads of the Phase 1 allocation authority on one stable source
  -- snapshot while the checkpoint is built.
  lock table public.mud_group_terms, public.mud_group_rates,
    public.production_entries in share mode;

  work_date_cursor := coalesce(resolved_previous_cutoff + 1, first_term_date);
  while work_date_cursor <= p_settled_through loop
    insert into public.mud_factory_settlement_days(
      settlement_id, factory_id, work_date,
      eligible_factory_production, total_active_mud_members
    )
    select
      new_settlement_id,
      p_factory_id,
      work_date_cursor,
      allocation.eligible_factory_production,
      allocation.total_active_members
    from public.get_mud_group_daily_allocation(
      p_factory_id, work_date_cursor
    ) as allocation
    limit 1;

    if not found then
      raise exception 'Mud allocation returned no groups for %.', work_date_cursor
        using errcode = 'P2904';
    end if;

    insert into public.mud_group_settlement_days(
      settlement_id, factory_id, work_date, labour_group_id,
      mud_group_term_id, member_count, allocated_production,
      mud_group_rate_id, rate_per_1000_bricks, earned_amount
    )
    select
      new_settlement_id,
      p_factory_id,
      work_date_cursor,
      allocation.labour_group_id,
      terms.id,
      allocation.member_count,
      allocation.allocated_production,
      allocation.mud_group_rate_id,
      allocation.rate_per_1000_bricks,
      allocation.earned_amount
    from public.get_mud_group_daily_allocation(
      p_factory_id, work_date_cursor
    ) as allocation
    join public.mud_group_terms as terms
      on terms.factory_id = p_factory_id
      and terms.labour_group_id = allocation.labour_group_id
      and terms.effective_from <= work_date_cursor
      and (terms.effective_to is null or terms.effective_to >= work_date_cursor)
    order by allocation.labour_group_id;

    get diagnostics current_group_count = row_count;
    inserted_group_count := inserted_group_count + current_group_count;

    select factory_day.eligible_factory_production,
      coalesce(sum(group_day.allocated_production), 0)
    into day_eligible_production, day_allocated_production
    from public.mud_factory_settlement_days as factory_day
    left join public.mud_group_settlement_days as group_day
      on group_day.settlement_id = factory_day.settlement_id
      and group_day.factory_id = factory_day.factory_id
      and group_day.work_date = factory_day.work_date
    where factory_day.settlement_id = new_settlement_id
      and factory_day.factory_id = p_factory_id
      and factory_day.work_date = work_date_cursor
    group by factory_day.eligible_factory_production;

    if current_group_count = 0 or day_allocated_production <> day_eligible_production then
      raise exception 'Mud allocation did not exactly preserve Production for %.', work_date_cursor
        using errcode = 'P2905';
    end if;

    inserted_daily_count := inserted_daily_count + 1;
    work_date_cursor := work_date_cursor + 1;
  end loop;

  settlement_id := new_settlement_id;
  previous_cutoff := resolved_previous_cutoff;
  settled_through := p_settled_through;
  daily_snapshots := inserted_daily_count;
  group_snapshots := inserted_group_count;
  return next;
end;
$$;

create or replace function public.create_mud_legacy_opening(
  p_factory_id uuid,
  p_legacy_cutoff date
)
returns table (
  settlement_id uuid,
  settled_through date,
  group_openings integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  locked_legacy_cutoff date;
  new_settlement_id uuid := gen_random_uuid();
  inserted_openings integer;
begin
  if p_factory_id is null or p_legacy_cutoff is null or not isfinite(p_legacy_cutoff) then
    raise exception 'Factory and finite Legacy Opening cutoff are required.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_factory_id::text), hashtext('mud_factory_settlement')
  );

  if exists (
    select 1 from public.mud_factory_settlements
    where mud_factory_settlements.factory_id = p_factory_id
  ) then
    raise exception 'Legacy Opening must be the first Mud settlement for a factory.' using errcode = 'P2906';
  end if;

  select max(weekly.week_start + 6)
  into locked_legacy_cutoff
  from public.weekly_earnings as weekly
  where weekly.factory_id = p_factory_id
    and weekly.labour_group_id is not null
    and weekly.labourer_id is null;

  if locked_legacy_cutoff is null then
    raise exception 'No locked legacy Mud weekly earnings exist for this factory.' using errcode = 'P2907';
  end if;
  if p_legacy_cutoff <> locked_legacy_cutoff then
    raise exception 'Legacy Opening cutoff must equal the latest locked Mud week end %.', locked_legacy_cutoff
      using errcode = 'P2907';
  end if;

  insert into public.mud_factory_settlements(
    id, factory_id, previous_cutoff, settled_through, settlement_type
  ) values (
    new_settlement_id, p_factory_id, null, p_legacy_cutoff, 'legacy_opening'
  );

  insert into public.mud_group_legacy_openings(
    settlement_id, factory_id, labour_group_id, legacy_cutoff, locked_weekly_earned
  )
  select
    new_settlement_id,
    groups.factory_id,
    groups.id,
    p_legacy_cutoff,
    coalesce(sum(weekly.amount) filter (
      where weekly.week_start + 6 <= p_legacy_cutoff
    ), 0)
  from public.labour_groups as groups
  left join public.weekly_earnings as weekly
    on weekly.factory_id = groups.factory_id
    and weekly.labour_group_id = groups.id
    and weekly.labourer_id is null
  where groups.factory_id = p_factory_id
  group by groups.factory_id, groups.id;

  get diagnostics inserted_openings = row_count;

  settlement_id := new_settlement_id;
  settled_through := p_legacy_cutoff;
  group_openings := inserted_openings;
  return next;
end;
$$;

create or replace function public.calculate_mud_group_settlement_account(
  p_factory_id uuid,
  p_labour_group_id uuid,
  p_as_of_date date
)
returns table (
  settled_earned numeric,
  live_earned numeric,
  total_earned numeric,
  total_withdrawn numeric,
  available_balance numeric,
  latest_settlement_cutoff date
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  resolved_cutoff date;
  live_start date;
  resolved_settled_earned numeric := 0;
  resolved_live_earned numeric := 0;
  resolved_total_withdrawn numeric := 0;
begin
  if p_factory_id is null or p_labour_group_id is null
    or p_as_of_date is null or not isfinite(p_as_of_date) then
    raise exception 'Factory, Mud group, and finite as-of date are required.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.labour_groups
    where labour_groups.id = p_labour_group_id
      and labour_groups.factory_id = p_factory_id
  ) then
    raise exception 'Mud group does not belong to this factory.' using errcode = '42501';
  end if;

  select max(settlements.settled_through)
  into resolved_cutoff
  from public.mud_factory_settlements as settlements
  where settlements.factory_id = p_factory_id;

  if resolved_cutoff is not null and p_as_of_date < resolved_cutoff then
    raise exception 'As-of date cannot be before the factory Mud cutoff %.', resolved_cutoff
      using errcode = 'P2908';
  end if;

  select
    coalesce((
      select sum(openings.locked_weekly_earned)
      from public.mud_group_legacy_openings as openings
      where openings.factory_id = p_factory_id
        and openings.labour_group_id = p_labour_group_id
    ), 0)
    + coalesce((
      select sum(days.earned_amount)
      from public.mud_group_settlement_days as days
      where days.factory_id = p_factory_id
        and days.labour_group_id = p_labour_group_id
    ), 0)
  into resolved_settled_earned;

  if resolved_cutoff is null then
    select min(terms.effective_from)
    into live_start
    from public.mud_group_terms as terms
    where terms.factory_id = p_factory_id;
  else
    live_start := resolved_cutoff + 1;
  end if;

  if live_start is not null and live_start <= p_as_of_date then
    select coalesce(sum(allocation.earned_amount) filter (
      where allocation.labour_group_id = p_labour_group_id
    ), 0)
    into resolved_live_earned
    from generate_series(0, p_as_of_date - live_start) as generated(day_offset)
    cross join lateral public.get_mud_group_daily_allocation(
      p_factory_id, live_start + generated.day_offset
    ) as allocation;
  end if;

  select coalesce(sum(existing.amount), 0)
  into resolved_total_withdrawn
  from public.withdrawals as existing
  where existing.factory_id = p_factory_id
    and existing.labour_group_id = p_labour_group_id
    and existing.labourer_id is null
    and existing.withdrawal_date <= p_as_of_date;

  settled_earned := resolved_settled_earned;
  live_earned := resolved_live_earned;
  total_earned := resolved_settled_earned + resolved_live_earned;
  total_withdrawn := resolved_total_withdrawn;
  available_balance := total_earned - resolved_total_withdrawn;
  latest_settlement_cutoff := resolved_cutoff;
  return next;
end;
$$;

create or replace function public.get_mud_group_settlement_account(
  p_factory_id uuid,
  p_labour_group_id uuid,
  p_as_of_date date
)
returns table (
  settled_earned numeric,
  live_earned numeric,
  total_earned numeric,
  total_withdrawn numeric,
  available_balance numeric,
  latest_settlement_cutoff date
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;

  return query
  select * from public.calculate_mud_group_settlement_account(
    p_factory_id, p_labour_group_id, p_as_of_date
  );
end;
$$;

revoke all on function public.create_mud_factory_settlement(uuid, date, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.create_mud_legacy_opening(uuid, date)
  from public, anon, authenticated;
grant execute on function public.create_mud_factory_settlement(uuid, date, uuid, uuid)
  to service_role;
grant execute on function public.create_mud_legacy_opening(uuid, date)
  to service_role;

revoke all on function public.calculate_mud_group_settlement_account(uuid, uuid, date)
  from public, anon, authenticated;
revoke all on function public.get_mud_group_settlement_account(uuid, uuid, date)
  from public, anon, authenticated;
grant execute on function public.get_mud_group_settlement_account(uuid, uuid, date)
  to authenticated;

comment on table public.mud_factory_settlements is
  'Dormant immutable factory-wide Mud cutoff headers. No live financial path creates these in Phase 3.';
comment on table public.mud_factory_settlement_days is
  'Immutable eligible Production and total-member snapshots for each newly settled factory date.';
comment on table public.mud_group_settlement_days is
  'Immutable per-group term, allocation, rate, and earning snapshots for each settled date.';
comment on table public.mud_group_legacy_openings is
  'Compact immutable per-group totals copied from locked legacy Mud weekly earnings during a future cutover.';
comment on function public.create_mud_factory_settlement(uuid, date, uuid, uuid) is
  'Service-only dormant factory checkpoint builder using the Phase 1 daily allocation authority.';
comment on function public.create_mud_legacy_opening(uuid, date) is
  'Service-only future cutover helper; Phase 3 does not invoke it for real data.';
comment on function public.get_mud_group_settlement_account(uuid, uuid, date) is
  'Dormant Mud account read model: settled plus post-cutoff live earnings minus group withdrawals.';

commit;
