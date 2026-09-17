begin;

create type public.mud_accounting_mode as enum (
  'LEGACY_WEEKLY',
  'SHADOW',
  'SETTLEMENT'
);

create table public.mud_accounting_states (
  factory_id uuid primary key references public.factories(id) on delete restrict,
  accounting_mode public.mud_accounting_mode not null default 'LEGACY_WEEKLY',
  updated_at timestamptz not null default now(),
  constraint mud_accounting_states_factory_mode_key unique (factory_id, accounting_mode)
);

create table public.mud_accounting_mode_transitions (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  old_mode public.mud_accounting_mode not null,
  new_mode public.mud_accounting_mode not null,
  changed_at timestamptz not null default now(),
  actor uuid not null,
  constraint mud_accounting_mode_transitions_changed_check check (
    (old_mode = 'LEGACY_WEEKLY' and new_mode = 'SHADOW')
    or (old_mode = 'SHADOW' and new_mode = 'SETTLEMENT')
  )
);

create index mud_accounting_mode_transitions_factory_changed_idx
  on public.mud_accounting_mode_transitions(factory_id, changed_at, id);

insert into public.mud_accounting_states(factory_id, accounting_mode)
select factories.id, 'LEGACY_WEEKLY'
from public.factories;

create or replace function public.initialize_mud_accounting_state()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.mud_accounting_states(factory_id, accounting_mode)
  values (new.id, 'LEGACY_WEEKLY');
  return new;
end;
$$;

create trigger factories_initialize_mud_accounting_state
after insert on public.factories
for each row execute function public.initialize_mud_accounting_state();

create or replace function public.protect_mud_accounting_state_transition()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.factory_id <> old.factory_id then
    raise exception 'Mud accounting state cannot move between factories.' using errcode = 'P2800';
  end if;
  if new.accounting_mode = old.accounting_mode then
    raise exception 'Mud accounting mode is already %.', old.accounting_mode using errcode = 'P2801';
  end if;
  if not (
    (old.accounting_mode = 'LEGACY_WEEKLY' and new.accounting_mode = 'SHADOW')
    or (old.accounting_mode = 'SHADOW' and new.accounting_mode = 'SETTLEMENT')
  ) then
    raise exception 'Mud accounting mode cannot transition from % to %.', old.accounting_mode, new.accounting_mode
      using errcode = 'P2802';
  end if;
  if auth.uid() is null then
    raise exception 'Mud accounting transitions require an authenticated actor.' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger mud_accounting_states_protect_transition
before update on public.mud_accounting_states
for each row execute function public.protect_mud_accounting_state_transition();

create or replace function public.audit_mud_accounting_state_transition()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.mud_accounting_mode_transitions(
    factory_id, old_mode, new_mode, actor
  ) values (
    new.factory_id, old.accounting_mode, new.accounting_mode, auth.uid()
  );
  return new;
end;
$$;

create trigger mud_accounting_states_audit_transition
after update on public.mud_accounting_states
for each row execute function public.audit_mud_accounting_state_transition();

alter table public.mud_accounting_states enable row level security;
alter table public.mud_accounting_mode_transitions enable row level security;

revoke all on public.mud_accounting_states, public.mud_accounting_mode_transitions
  from anon, authenticated;
grant select on public.mud_accounting_states, public.mud_accounting_mode_transitions
  to authenticated;

create policy "Authenticated users can read their factory Mud accounting state"
  on public.mud_accounting_states for select to authenticated
  using (
    exists (
      select 1 from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = mud_accounting_states.factory_id
        and factory_users.is_active = true
    )
  );

create policy "Authenticated users can read their factory Mud mode history"
  on public.mud_accounting_mode_transitions for select to authenticated
  using (
    exists (
      select 1 from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = mud_accounting_mode_transitions.factory_id
        and factory_users.is_active = true
    )
  );

create or replace function public.transition_mud_accounting_mode(
  p_factory_id uuid,
  p_new_mode public.mud_accounting_mode
)
returns setof public.mud_accounting_states
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_mode public.mud_accounting_mode;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;

  select states.accounting_mode into current_mode
  from public.mud_accounting_states as states
  where states.factory_id = p_factory_id
  for update;
  if not found then
    raise exception 'Mud accounting state is missing for this factory.' using errcode = 'P2803';
  end if;
  if not (
    (current_mode = 'LEGACY_WEEKLY' and p_new_mode = 'SHADOW')
    or (current_mode = 'SHADOW' and p_new_mode = 'SETTLEMENT')
  ) then
    raise exception 'Mud accounting mode cannot transition from % to %.', current_mode, p_new_mode
      using errcode = 'P2802';
  end if;

  return query
  update public.mud_accounting_states
  set accounting_mode = p_new_mode
  where factory_id = p_factory_id
  returning *;
end;
$$;

create or replace function public.get_mud_group_configuration(
  p_factory_id uuid,
  p_as_of_date date
)
returns table (
  labour_group_id uuid,
  group_name text,
  current_member_count integer,
  current_rate_per_1000_bricks numeric,
  is_earning boolean,
  current_term_id uuid,
  current_rate_id uuid,
  accounting_mode public.mud_accounting_mode
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
  if p_as_of_date is null or not isfinite(p_as_of_date) then
    raise exception 'As-of date must be a finite calendar date.' using errcode = '22023';
  end if;

  return query
  select
    groups.id,
    groups.name,
    coalesce(active_term.member_count, latest_term.member_count),
    active_rate.rate_per_1000_bricks,
    active_term.id is not null,
    active_term.id,
    active_rate.id,
    states.accounting_mode
  from public.labour_groups as groups
  join public.mud_accounting_states as states
    on states.factory_id = groups.factory_id
  left join lateral (
    select terms.id, terms.member_count
    from public.mud_group_terms as terms
    where terms.factory_id = groups.factory_id
      and terms.labour_group_id = groups.id
      and terms.effective_from <= p_as_of_date
      and (terms.effective_to is null or terms.effective_to >= p_as_of_date)
    order by terms.effective_from desc, terms.id
    limit 1
  ) as active_term on true
  left join lateral (
    select terms.member_count
    from public.mud_group_terms as terms
    where terms.factory_id = groups.factory_id
      and terms.labour_group_id = groups.id
      and terms.effective_from <= p_as_of_date
    order by terms.effective_from desc, terms.id
    limit 1
  ) as latest_term on true
  left join lateral (
    select rates.id, rates.rate_per_1000_bricks
    from public.mud_group_rates as rates
    where rates.factory_id = groups.factory_id
      and rates.labour_group_id = groups.id
      and rates.effective_from <= p_as_of_date
      and (rates.effective_to is null or rates.effective_to >= p_as_of_date)
    order by rates.effective_from desc, rates.id
    limit 1
  ) as active_rate on true
  where groups.factory_id = p_factory_id
  order by groups.name, groups.id;
end;
$$;

create or replace function public.create_mud_group(
  p_factory_id uuid,
  p_name text,
  p_member_count integer,
  p_earning_start_date date,
  p_initial_rate numeric,
  p_rate_effective_date date
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  created_group_id uuid;
  becomes_legacy_group boolean;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'Mud group name is required.' using errcode = '22023';
  end if;
  if p_member_count is null or p_member_count <= 0 then
    raise exception 'Member count must be a positive integer.' using errcode = '22023';
  end if;
  if p_earning_start_date is null or not isfinite(p_earning_start_date)
    or p_rate_effective_date is null or not isfinite(p_rate_effective_date) then
    raise exception 'Earning and rate dates must be finite calendar dates.' using errcode = '22023';
  end if;
  if p_initial_rate is null or p_initial_rate <= 0
    or p_initial_rate = 'NaN'::numeric
    or p_initial_rate = 'Infinity'::numeric
    or p_initial_rate = '-Infinity'::numeric then
    raise exception 'Initial rate must be a positive finite number.' using errcode = '22023';
  end if;
  if p_rate_effective_date > p_earning_start_date then
    raise exception 'Initial rate must cover the first earning date.' using errcode = 'P2810';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_factory_id::text), hashtext('mud_group_configuration'));
  becomes_legacy_group := not exists (
    select 1 from public.labour_groups as groups
    where groups.factory_id = p_factory_id and groups.is_active
  );

  insert into public.labour_groups(
    factory_id, name, member_names, member_count, is_active
  ) values (
    p_factory_id, btrim(p_name), null, p_member_count, becomes_legacy_group
  ) returning id into created_group_id;

  insert into public.mud_group_terms(
    factory_id, labour_group_id, member_count, effective_from, effective_to
  ) values (
    p_factory_id, created_group_id, p_member_count, p_earning_start_date, null
  );
  insert into public.mud_group_rates(
    factory_id, labour_group_id, rate_per_1000_bricks, effective_from, effective_to
  ) values (
    p_factory_id, created_group_id, p_initial_rate, p_rate_effective_date, null
  );

  return created_group_id;
end;
$$;

create or replace function public.set_mud_group_member_count(
  p_factory_id uuid,
  p_labour_group_id uuid,
  p_member_count integer,
  p_effective_from date
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_term public.mud_group_terms%rowtype;
  created_term_id uuid;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;
  if p_member_count is null or p_member_count <= 0 then
    raise exception 'Member count must be a positive integer.' using errcode = '22023';
  end if;
  if p_effective_from is null or not isfinite(p_effective_from) then
    raise exception 'Effective-from date must be a finite calendar date.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.labour_groups
    where labour_groups.id = p_labour_group_id and labour_groups.factory_id = p_factory_id
  ) then
    raise exception 'Mud group does not belong to this factory.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_factory_id::text), hashtext('mud_group_configuration:' || p_labour_group_id::text)
  );
  select * into current_term
  from public.mud_group_terms as terms
  where terms.factory_id = p_factory_id
    and terms.labour_group_id = p_labour_group_id
    and terms.effective_from <= p_effective_from
    and (terms.effective_to is null or terms.effective_to >= p_effective_from)
  for update;
  if not found then
    raise exception 'Mud group is not earning on the selected member-count date.' using errcode = 'P2811';
  end if;
  if current_term.effective_from = p_effective_from then
    raise exception 'A Mud member-count term already starts on this date.' using errcode = 'P2812';
  end if;

  update public.mud_group_terms
  set effective_to = p_effective_from - 1
  where id = current_term.id;
  insert into public.mud_group_terms(
    factory_id, labour_group_id, member_count, effective_from, effective_to
  ) values (
    p_factory_id, p_labour_group_id, p_member_count,
    p_effective_from, current_term.effective_to
  ) returning id into created_term_id;
  return created_term_id;
end;
$$;

create or replace function public.set_mud_group_rate(
  p_factory_id uuid,
  p_labour_group_id uuid,
  p_rate_per_1000_bricks numeric,
  p_effective_from date
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  previous_rate public.mud_group_rates%rowtype;
  next_rate public.mud_group_rates%rowtype;
  previous_found boolean;
  next_found boolean;
  created_rate_id uuid;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;
  if p_rate_per_1000_bricks is null or p_rate_per_1000_bricks <= 0
    or p_rate_per_1000_bricks = 'NaN'::numeric
    or p_rate_per_1000_bricks = 'Infinity'::numeric
    or p_rate_per_1000_bricks = '-Infinity'::numeric then
    raise exception 'Rate per 1,000 bricks must be a positive finite number.' using errcode = '22023';
  end if;
  if p_effective_from is null or not isfinite(p_effective_from) then
    raise exception 'Effective-from date must be a finite calendar date.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.labour_groups
    where labour_groups.id = p_labour_group_id and labour_groups.factory_id = p_factory_id
  ) then
    raise exception 'Mud group does not belong to this factory.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_factory_id::text), hashtext('mud_group_configuration:' || p_labour_group_id::text)
  );
  if exists (
    select 1 from public.mud_group_rates as rates
    where rates.factory_id = p_factory_id
      and rates.labour_group_id = p_labour_group_id
      and rates.effective_from = p_effective_from
  ) then
    raise exception 'A Mud group rate already starts on this date.' using errcode = 'P2813';
  end if;

  select * into previous_rate
  from public.mud_group_rates as rates
  where rates.factory_id = p_factory_id
    and rates.labour_group_id = p_labour_group_id
    and rates.effective_from < p_effective_from
  order by rates.effective_from desc, rates.id desc
  limit 1 for update;
  previous_found := found;
  select * into next_rate
  from public.mud_group_rates as rates
  where rates.factory_id = p_factory_id
    and rates.labour_group_id = p_labour_group_id
    and rates.effective_from > p_effective_from
  order by rates.effective_from, rates.id
  limit 1 for update;
  next_found := found;

  if previous_found
    and (previous_rate.effective_to is null or previous_rate.effective_to >= p_effective_from) then
    update public.mud_group_rates
    set effective_to = p_effective_from - 1
    where id = previous_rate.id;
  end if;
  insert into public.mud_group_rates(
    factory_id, labour_group_id, rate_per_1000_bricks, effective_from, effective_to
  ) values (
    p_factory_id, p_labour_group_id, p_rate_per_1000_bricks, p_effective_from,
    case when next_found then next_rate.effective_from - 1 else null end
  ) returning id into created_rate_id;
  return created_rate_id;
end;
$$;

create or replace function public.stop_mud_group_earning(
  p_factory_id uuid,
  p_labour_group_id uuid,
  p_stop_date date
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_term public.mud_group_terms%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;
  if p_stop_date is null or not isfinite(p_stop_date) then
    raise exception 'Stop date must be a finite calendar date.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.labour_groups
    where labour_groups.id = p_labour_group_id and labour_groups.factory_id = p_factory_id
  ) then
    raise exception 'Mud group does not belong to this factory.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_factory_id::text), hashtext('mud_group_configuration:' || p_labour_group_id::text)
  );
  select * into current_term
  from public.mud_group_terms as terms
  where terms.factory_id = p_factory_id
    and terms.labour_group_id = p_labour_group_id
    and terms.effective_from <= p_stop_date
    and (terms.effective_to is null or terms.effective_to >= p_stop_date)
  for update;
  if not found then
    raise exception 'Mud group is not earning on the selected stop date.' using errcode = 'P2814';
  end if;
  if current_term.effective_from = p_stop_date then
    raise exception 'Stop date must be after the term first earning date.' using errcode = 'P2815';
  end if;

  update public.mud_group_terms
  set effective_to = p_stop_date - 1
  where id = current_term.id;
  return current_term.id;
end;
$$;

create or replace function public.restart_mud_group_earning(
  p_factory_id uuid,
  p_labour_group_id uuid,
  p_member_count integer,
  p_restart_date date
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  matching_rate_count integer;
  next_term_start date;
  created_term_id uuid;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;
  if p_member_count is null or p_member_count <= 0 then
    raise exception 'Member count must be a positive integer.' using errcode = '22023';
  end if;
  if p_restart_date is null or not isfinite(p_restart_date) then
    raise exception 'Restart date must be a finite calendar date.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.labour_groups
    where labour_groups.id = p_labour_group_id and labour_groups.factory_id = p_factory_id
  ) then
    raise exception 'Mud group does not belong to this factory.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_factory_id::text), hashtext('mud_group_configuration:' || p_labour_group_id::text)
  );
  if exists (
    select 1 from public.mud_group_terms as terms
    where terms.factory_id = p_factory_id
      and terms.labour_group_id = p_labour_group_id
      and terms.effective_from <= p_restart_date
      and (terms.effective_to is null or terms.effective_to >= p_restart_date)
  ) then
    raise exception 'Mud group is already earning on the selected restart date.' using errcode = 'P2816';
  end if;
  select count(*) into matching_rate_count
  from public.mud_group_rates as rates
  where rates.factory_id = p_factory_id
    and rates.labour_group_id = p_labour_group_id
    and rates.effective_from <= p_restart_date
    and (rates.effective_to is null or rates.effective_to >= p_restart_date);
  if matching_rate_count = 0 then
    raise exception 'Mud rate not set for the selected restart date.' using errcode = 'P2817';
  end if;
  if matching_rate_count > 1 then
    raise exception 'Overlapping Mud group rates apply on the selected restart date.' using errcode = 'P2818';
  end if;

  select min(terms.effective_from) into next_term_start
  from public.mud_group_terms as terms
  where terms.factory_id = p_factory_id
    and terms.labour_group_id = p_labour_group_id
    and terms.effective_from > p_restart_date;
  insert into public.mud_group_terms(
    factory_id, labour_group_id, member_count, effective_from, effective_to
  ) values (
    p_factory_id, p_labour_group_id, p_member_count, p_restart_date,
    case when next_term_start is not null then next_term_start - 1 else null end
  ) returning id into created_term_id;
  return created_term_id;
end;
$$;

create or replace function public.get_mud_group_range_allocation(
  p_factory_id uuid,
  p_from_date date,
  p_to_date date
)
returns table (
  production_date date,
  labour_group_id uuid,
  member_count integer,
  total_active_members bigint,
  eligible_factory_production bigint,
  allocated_production bigint,
  mud_group_rate_id uuid,
  rate_per_1000_bricks numeric,
  earned_amount numeric
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
  if p_from_date is null or p_to_date is null
    or not isfinite(p_from_date) or not isfinite(p_to_date)
    or p_from_date > p_to_date then
    raise exception 'A valid inclusive date range is required.' using errcode = '22023';
  end if;

  return query
  select
    days.work_date,
    allocation.labour_group_id,
    allocation.member_count,
    allocation.total_active_members,
    allocation.eligible_factory_production,
    allocation.allocated_production,
    allocation.mud_group_rate_id,
    allocation.rate_per_1000_bricks,
    allocation.earned_amount
  from generate_series(0, p_to_date - p_from_date) as generated(day_offset)
  cross join lateral (
    select p_from_date + generated.day_offset as work_date
  ) as days
  cross join lateral public.get_mud_group_daily_allocation(
    p_factory_id, days.work_date
  ) as allocation
  order by days.work_date, allocation.labour_group_id;
end;
$$;

revoke all on function public.transition_mud_accounting_mode(uuid, public.mud_accounting_mode)
  from public, anon, authenticated;
revoke all on function public.get_mud_group_configuration(uuid, date)
  from public, anon, authenticated;
revoke all on function public.create_mud_group(uuid, text, integer, date, numeric, date)
  from public, anon, authenticated;
revoke all on function public.set_mud_group_member_count(uuid, uuid, integer, date)
  from public, anon, authenticated;
revoke all on function public.set_mud_group_rate(uuid, uuid, numeric, date)
  from public, anon, authenticated;
revoke all on function public.stop_mud_group_earning(uuid, uuid, date)
  from public, anon, authenticated;
revoke all on function public.restart_mud_group_earning(uuid, uuid, integer, date)
  from public, anon, authenticated;
revoke all on function public.get_mud_group_range_allocation(uuid, date, date)
  from public, anon, authenticated;

grant execute on function public.get_mud_group_configuration(uuid, date)
  to authenticated;
grant execute on function public.transition_mud_accounting_mode(uuid, public.mud_accounting_mode)
  to authenticated;
grant execute on function public.create_mud_group(uuid, text, integer, date, numeric, date)
  to authenticated;
grant execute on function public.set_mud_group_member_count(uuid, uuid, integer, date)
  to authenticated;
grant execute on function public.set_mud_group_rate(uuid, uuid, numeric, date)
  to authenticated;
grant execute on function public.stop_mud_group_earning(uuid, uuid, date)
  to authenticated;
grant execute on function public.restart_mud_group_earning(uuid, uuid, integer, date)
  to authenticated;
grant execute on function public.get_mud_group_range_allocation(uuid, date, date)
  to authenticated;

comment on table public.mud_accounting_states is
  'Per-factory Mud accounting authority. Phase 2 initializes and remains LEGACY_WEEKLY.';
comment on table public.mud_accounting_mode_transitions is
  'Immutable forward-only Mud accounting-mode audit history.';
comment on function public.get_mud_group_range_allocation(uuid, date, date) is
  'Operational live range allocation composed exclusively from the Phase 1 daily term/rate authority.';

commit;
