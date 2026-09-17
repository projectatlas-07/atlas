begin;

create extension if not exists btree_gist;

do $$
declare
  conflicting_factory_id uuid;
begin
  select groups.factory_id into conflicting_factory_id
  from public.labour_groups as groups
  where groups.is_active
  group by groups.factory_id
  having count(*) > 1
  limit 1;
  if conflicting_factory_id is not null then
    raise exception 'Mud multi-group foundation stopped: factory % has multiple current active groups.', conflicting_factory_id
      using errcode = 'P2700';
  end if;

  select groups.factory_id into conflicting_factory_id
  from public.labour_groups as groups
  where groups.is_active and groups.member_count is null
  limit 1;
  if conflicting_factory_id is not null then
    raise exception 'Mud multi-group foundation stopped: the active group for factory % has no member count.', conflicting_factory_id
      using errcode = 'P2700';
  end if;

  select rates.factory_id into conflicting_factory_id
  from public.wage_rates as rates
  where rates.applies_to = 'mud_supply'
    and not exists (
      select 1 from public.labour_groups as groups
      where groups.factory_id = rates.factory_id and groups.is_active
    )
  limit 1;
  if conflicting_factory_id is not null then
    raise exception 'Mud multi-group foundation stopped: factory % has Mud rate history but no active group.', conflicting_factory_id
      using errcode = 'P2700';
  end if;

  select earlier.factory_id into conflicting_factory_id
  from public.wage_rates as earlier
  join public.wage_rates as later
    on later.factory_id = earlier.factory_id
    and later.applies_to = earlier.applies_to
    and later.id > earlier.id
    and daterange(earlier.effective_from, earlier.effective_to, '[]')
      && daterange(later.effective_from, later.effective_to, '[]')
  where earlier.applies_to = 'mud_supply'
  limit 1;
  if conflicting_factory_id is not null then
    raise exception 'Mud multi-group foundation stopped: factory % has overlapping Mud rate history.', conflicting_factory_id
      using errcode = 'P2700';
  end if;

  select rates.factory_id into conflicting_factory_id
  from public.wage_rates as rates
  where rates.applies_to = 'mud_supply'
    and (
      not isfinite(rates.effective_from)
      or (rates.effective_to is not null and not isfinite(rates.effective_to))
    )
  limit 1;
  if conflicting_factory_id is not null then
    raise exception 'Mud multi-group foundation stopped: factory % has a non-finite Mud rate date.', conflicting_factory_id
      using errcode = 'P2700';
  end if;
end;
$$;

create table public.mud_group_terms (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  labour_group_id uuid not null,
  member_count integer not null,
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  constraint mud_group_terms_id_factory_group_key
    unique (id, factory_id, labour_group_id),
  constraint mud_group_terms_group_factory_fkey
    foreign key (labour_group_id, factory_id)
    references public.labour_groups(id, factory_id) on delete restrict,
  constraint mud_group_terms_member_count_check check (member_count > 0),
  constraint mud_group_terms_dates_check check (
    isfinite(effective_from)
    and (effective_to is null or (isfinite(effective_to) and effective_to >= effective_from))
  ),
  constraint mud_group_terms_no_overlap
    exclude using gist (
      factory_id with =,
      labour_group_id with =,
      daterange(effective_from, effective_to, '[]') with &&
    )
);

create index mud_group_terms_factory_date_idx
  on public.mud_group_terms(factory_id, effective_from, effective_to, labour_group_id);

create table public.mud_group_rates (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  labour_group_id uuid not null,
  rate_per_1000_bricks numeric not null,
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  constraint mud_group_rates_id_factory_group_key
    unique (id, factory_id, labour_group_id),
  constraint mud_group_rates_group_factory_fkey
    foreign key (labour_group_id, factory_id)
    references public.labour_groups(id, factory_id) on delete restrict,
  constraint mud_group_rates_rate_check check (
    rate_per_1000_bricks > 0
    and rate_per_1000_bricks <> 'NaN'::numeric
    and rate_per_1000_bricks <> 'Infinity'::numeric
    and rate_per_1000_bricks <> '-Infinity'::numeric
  ),
  constraint mud_group_rates_dates_check check (
    isfinite(effective_from)
    and (effective_to is null or (isfinite(effective_to) and effective_to >= effective_from))
  ),
  constraint mud_group_rates_no_overlap
    exclude using gist (
      factory_id with =,
      labour_group_id with =,
      daterange(effective_from, effective_to, '[]') with &&
    )
);

create index mud_group_rates_factory_date_idx
  on public.mud_group_rates(factory_id, effective_from, effective_to, labour_group_id);

alter table public.mud_group_terms enable row level security;
alter table public.mud_group_rates enable row level security;

revoke all on public.mud_group_terms, public.mud_group_rates from anon, authenticated;
grant select on public.mud_group_terms, public.mud_group_rates to authenticated;

create policy "Authenticated users can read their factory Mud group terms"
  on public.mud_group_terms for select to authenticated
  using (
    exists (
      select 1 from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = mud_group_terms.factory_id
        and factory_users.is_active = true
    )
  );

create policy "Authenticated users can read their factory Mud group rates"
  on public.mud_group_rates for select to authenticated
  using (
    exists (
      select 1 from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = mud_group_rates.factory_id
        and factory_users.is_active = true
    )
  );

-- Dormant test-data backfill: the current single active group receives one
-- open term, beginning with its earliest existing factory Mud rate or today.
insert into public.mud_group_terms (
  factory_id, labour_group_id, member_count, effective_from, effective_to
)
select
  groups.factory_id,
  groups.id,
  groups.member_count,
  coalesce(min(rates.effective_from), (now() at time zone 'Asia/Kolkata')::date),
  null
from public.labour_groups as groups
left join public.wage_rates as rates
  on rates.factory_id = groups.factory_id
  and rates.applies_to = 'mud_supply'
where groups.is_active
group by groups.factory_id, groups.id, groups.member_count;

-- Preserve the legacy rows in wage_rates. Copy their exact effective periods
-- only to the current active group for the dormant group-rate foundation.
insert into public.mud_group_rates (
  factory_id, labour_group_id, rate_per_1000_bricks,
  effective_from, effective_to, created_at
)
select
  rates.factory_id,
  groups.id,
  rates.rate_per_1000_bricks,
  rates.effective_from,
  rates.effective_to,
  rates.created_at
from public.wage_rates as rates
join public.labour_groups as groups
  on groups.factory_id = rates.factory_id
  and groups.is_active
where rates.applies_to = 'mud_supply';

create or replace function public.get_mud_group_daily_allocation(
  p_factory_id uuid,
  p_production_date date
)
returns table (
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
declare
  active_term_count integer;
  matching_rate_count integer;
  invalid_group_id uuid;
  eligible_quantity bigint;
  resolved_total_members bigint;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;
  if p_production_date is null or not isfinite(p_production_date) then
    raise exception 'Production date must be a finite calendar date.' using errcode = '22023';
  end if;

  select terms.labour_group_id into invalid_group_id
  from public.mud_group_terms as terms
  where terms.factory_id = p_factory_id
    and terms.effective_from <= p_production_date
    and (terms.effective_to is null or terms.effective_to >= p_production_date)
  group by terms.labour_group_id
  having count(*) > 1
  limit 1;
  if found then
    raise exception 'Overlapping Mud group terms apply to group % on %.', invalid_group_id, p_production_date
      using errcode = 'P2702';
  end if;

  select count(*), coalesce(sum(terms.member_count), 0)
  into active_term_count, resolved_total_members
  from public.mud_group_terms as terms
  where terms.factory_id = p_factory_id
    and terms.effective_from <= p_production_date
    and (terms.effective_to is null or terms.effective_to >= p_production_date);
  if active_term_count = 0 then
    raise exception 'No active Mud group coverage exists for %.', p_production_date
      using errcode = 'P2701';
  end if;
  if resolved_total_members <= 0 then
    raise exception 'Mud member-count coverage is missing for %.', p_production_date
      using errcode = 'P2703';
  end if;

  select active.labour_group_id, count(rates.id)
  into invalid_group_id, matching_rate_count
  from (
    select terms.labour_group_id
    from public.mud_group_terms as terms
    where terms.factory_id = p_factory_id
      and terms.effective_from <= p_production_date
      and (terms.effective_to is null or terms.effective_to >= p_production_date)
  ) as active
  left join public.mud_group_rates as rates
    on rates.factory_id = p_factory_id
    and rates.labour_group_id = active.labour_group_id
    and rates.effective_from <= p_production_date
    and (rates.effective_to is null or rates.effective_to >= p_production_date)
  group by active.labour_group_id
  having count(rates.id) <> 1
  order by active.labour_group_id
  limit 1;
  if found then
    if matching_rate_count = 0 then
      raise exception 'Mud rate not set for group % on %.', invalid_group_id, p_production_date
        using errcode = 'P2704';
    end if;
    raise exception 'Overlapping Mud group rates apply to group % on %.', invalid_group_id, p_production_date
      using errcode = 'P2705';
  end if;

  select coalesce(sum(entries.quantity), 0)::bigint
  into eligible_quantity
  from public.production_entries as entries
  join public.labourers as labourers
    on labourers.id = entries.labourer_id
    and labourers.factory_id = entries.factory_id
  where entries.factory_id = p_factory_id
    and entries.production_date = p_production_date;

  return query
  with active as (
    select terms.labour_group_id, terms.member_count
    from public.mud_group_terms as terms
    where terms.factory_id = p_factory_id
      and terms.effective_from <= p_production_date
      and (terms.effective_to is null or terms.effective_to >= p_production_date)
  ), weighted as (
    select
      active.labour_group_id,
      active.member_count,
      rates.id as mud_group_rate_id,
      rates.rate_per_1000_bricks,
      floor(
        eligible_quantity::numeric * active.member_count::numeric
        / resolved_total_members::numeric
      )::bigint as base_allocation,
      mod(
        eligible_quantity::numeric * active.member_count::numeric,
        resolved_total_members::numeric
      ) as allocation_remainder
    from active
    join public.mud_group_rates as rates
      on rates.factory_id = p_factory_id
      and rates.labour_group_id = active.labour_group_id
      and rates.effective_from <= p_production_date
      and (rates.effective_to is null or rates.effective_to >= p_production_date)
  ), ranked as (
    select
      weighted.*,
      sum(weighted.base_allocation) over () as base_total,
      row_number() over (
        order by weighted.allocation_remainder desc, weighted.labour_group_id asc
      ) as remainder_rank
    from weighted
  ), allocated as (
    select
      ranked.*,
      ranked.base_allocation + case
        when ranked.remainder_rank <= eligible_quantity - ranked.base_total then 1
        else 0
      end as final_allocation
    from ranked
  )
  select
    allocated.labour_group_id,
    allocated.member_count,
    resolved_total_members,
    eligible_quantity,
    allocated.final_allocation,
    allocated.mud_group_rate_id,
    allocated.rate_per_1000_bricks,
    allocated.final_allocation::numeric * allocated.rate_per_1000_bricks / 1000
  from allocated
  order by allocated.labour_group_id;
end;
$$;

revoke all on function public.get_mud_group_daily_allocation(uuid, date)
  from public, anon, authenticated;
grant execute on function public.get_mud_group_daily_allocation(uuid, date)
  to authenticated;

comment on table public.mud_group_terms is
  'Dormant effective-dated Mud group activation and member-count history. Not yet used by active accounting.';
comment on table public.mud_group_rates is
  'Dormant group-specific effective-dated Mud rates. Legacy factory Mud rates remain authoritative until cutover.';
comment on function public.get_mud_group_daily_allocation(uuid, date) is
  'Dormant authoritative proportional daily allocation using whole-brick largest remainder. Does not write accounting rows.';

commit;
