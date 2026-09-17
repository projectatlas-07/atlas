-- Production Accounting Phase 2B: settlement checkpoints and live account balance.

-- Abort the forward migration before creating anything if current Production
-- test data cannot be represented by the new account without guessing.
do $$
declare
  business_today date := (now() at time zone 'Asia/Kolkata')::date;
  missing_rate_count bigint;
  negative_account_count bigint;
begin
  with latest_legacy_cutoff as (
    select factory_id, labourer_id, max(week_start + 6) as settled_through
    from public.weekly_earnings
    where labourer_id is not null
    group by factory_id, labourer_id
  )
  select count(*) into missing_rate_count
  from public.production_entries as entries
  left join latest_legacy_cutoff as legacy
    on legacy.factory_id = entries.factory_id
    and legacy.labourer_id = entries.labourer_id
  where entries.production_date <= business_today
    and (legacy.settled_through is null or entries.production_date > legacy.settled_through)
    and not exists (
      select 1
      from public.production_wage_rates as rates
      where rates.factory_id = entries.factory_id
        and rates.labourer_id = entries.labourer_id
        and rates.production_crew_id is null
        and rates.effective_from <= entries.production_date
        and (rates.effective_to is null or rates.effective_to >= entries.production_date)
    );

  if missing_rate_count > 0 then
    raise exception 'Production settlement cutover stopped: % live Production date(s) have no direct labourer rate.', missing_rate_count
      using errcode = 'P2510';
  end if;

  with latest_legacy_cutoff as (
    select factory_id, labourer_id, max(week_start + 6) as settled_through
    from public.weekly_earnings
    where labourer_id is not null
    group by factory_id, labourer_id
  ), legacy as (
    select factory_id, labourer_id, sum(amount) as earned
    from public.weekly_earnings
    where labourer_id is not null
    group by factory_id, labourer_id
  ), live as (
    select
      entries.factory_id,
      entries.labourer_id,
      sum(entries.quantity::numeric * rates.rate_per_1000_bricks / 1000) as earned
    from public.production_entries as entries
    left join latest_legacy_cutoff as cutoff
      on cutoff.factory_id = entries.factory_id
      and cutoff.labourer_id = entries.labourer_id
    join public.production_wage_rates as rates
      on rates.factory_id = entries.factory_id
      and rates.labourer_id = entries.labourer_id
      and rates.production_crew_id is null
      and rates.effective_from <= entries.production_date
      and (rates.effective_to is null or rates.effective_to >= entries.production_date)
    where entries.production_date <= business_today
      and (cutoff.settled_through is null or entries.production_date > cutoff.settled_through)
    group by entries.factory_id, entries.labourer_id
  ), withdrawn as (
    select factory_id, labourer_id, sum(amount) as amount
    from public.withdrawals
    where labourer_id is not null and withdrawal_date <= business_today
    group by factory_id, labourer_id
  ), accounts as (
    select factory_id, labourer_id from legacy
    union
    select factory_id, labourer_id from live
    union
    select factory_id, labourer_id from withdrawn
  )
  select count(*) into negative_account_count
  from accounts
  left join legacy using (factory_id, labourer_id)
  left join live using (factory_id, labourer_id)
  left join withdrawn using (factory_id, labourer_id)
  where coalesce(legacy.earned, 0) + coalesce(live.earned, 0) - coalesce(withdrawn.amount, 0) < 0;

  if negative_account_count > 0 then
    raise exception 'Production settlement cutover stopped: % labourer account(s) would open with a negative balance.', negative_account_count
      using errcode = 'P2511';
  end if;
end;
$$;

create table public.production_earning_settlements (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  labourer_id uuid not null,
  previous_settled_through date,
  settled_through date not null,
  total_quantity bigint not null,
  total_earned numeric not null,
  settlement_type text not null,
  withdrawal_id uuid,
  created_at timestamptz not null default now(),
  constraint production_earning_settlements_id_factory_labourer_key
    unique (id, factory_id, labourer_id),
  constraint production_earning_settlements_labourer_factory_fkey
    foreign key (labourer_id, factory_id)
    references public.labourers(id, factory_id) on delete restrict,
  constraint production_earning_settlements_withdrawal_fkey
    foreign key (withdrawal_id)
    references public.withdrawals(id) on delete restrict
    deferrable initially deferred,
  constraint production_earning_settlements_withdrawal_key unique (withdrawal_id),
  constraint production_earning_settlements_dates_check
    check (
      isfinite(settled_through)
      and (previous_settled_through is null or (
        isfinite(previous_settled_through)
        and previous_settled_through <= settled_through
      ))
    ),
  constraint production_earning_settlements_quantity_check
    check (total_quantity >= 0),
  constraint production_earning_settlements_amount_check
    check (
      total_earned >= 0
      and total_earned <> 'NaN'::numeric
      and total_earned <> 'Infinity'::numeric
      and total_earned <> '-Infinity'::numeric
    ),
  constraint production_earning_settlements_type_check
    check (settlement_type in ('legacy_opening', 'withdrawal')),
  constraint production_earning_settlements_type_withdrawal_check
    check (
      (settlement_type = 'legacy_opening'
        and withdrawal_id is null
        and previous_settled_through is null)
      or
      (settlement_type = 'withdrawal' and withdrawal_id is not null)
    )
);

create unique index production_earning_settlements_one_legacy_opening_idx
  on public.production_earning_settlements(factory_id, labourer_id)
  where settlement_type = 'legacy_opening';

create index production_earning_settlements_account_cutoff_idx
  on public.production_earning_settlements(factory_id, labourer_id, settled_through desc, created_at desc, id desc);

create table public.production_earning_settlement_details (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null,
  factory_id uuid not null,
  labourer_id uuid not null,
  production_entry_id uuid not null references public.production_entries(id) on delete restrict,
  work_date date not null,
  quantity bigint not null,
  production_wage_rate_id uuid not null,
  rate_per_1000_bricks numeric not null,
  earned_amount numeric not null,
  created_at timestamptz not null default now(),
  constraint production_earning_settlement_details_settlement_fkey
    foreign key (settlement_id, factory_id, labourer_id)
    references public.production_earning_settlements(id, factory_id, labourer_id) on delete restrict,
  constraint production_earning_settlement_details_rate_fkey
    foreign key (production_wage_rate_id, factory_id)
    references public.production_wage_rates(id, factory_id) on delete restrict,
  constraint production_earning_settlement_details_account_date_key
    unique (factory_id, labourer_id, work_date),
  constraint production_earning_settlement_details_work_date_check
    check (isfinite(work_date)),
  constraint production_earning_settlement_details_quantity_check
    check (quantity > 0),
  constraint production_earning_settlement_details_rate_check
    check (
      rate_per_1000_bricks > 0
      and rate_per_1000_bricks <> 'NaN'::numeric
      and rate_per_1000_bricks <> 'Infinity'::numeric
      and rate_per_1000_bricks <> '-Infinity'::numeric
    ),
  constraint production_earning_settlement_details_amount_check
    check (
      earned_amount >= 0
      and earned_amount <> 'NaN'::numeric
      and earned_amount <> 'Infinity'::numeric
      and earned_amount <> '-Infinity'::numeric
    )
);

create index production_earning_settlement_details_settlement_idx
  on public.production_earning_settlement_details(settlement_id);

alter table public.production_earning_settlements enable row level security;
alter table public.production_earning_settlement_details enable row level security;

revoke all on public.production_earning_settlements from anon, authenticated;
revoke all on public.production_earning_settlement_details from anon, authenticated;
grant select on public.production_earning_settlements to authenticated;
grant select on public.production_earning_settlement_details to authenticated;

create policy "Authenticated users can read their factory Production settlements"
  on public.production_earning_settlements
  for select to authenticated
  using (
    exists (
      select 1 from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = production_earning_settlements.factory_id
        and factory_users.is_active = true
    )
  );

create policy "Authenticated users can read their factory Production settlement details"
  on public.production_earning_settlement_details
  for select to authenticated
  using (
    exists (
      select 1 from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = production_earning_settlement_details.factory_id
        and factory_users.is_active = true
    )
  );

create or replace function public.reject_production_settlement_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'Production earning settlement snapshots are immutable.' using errcode = 'P2501';
end;
$$;

create trigger production_earning_settlements_immutable
before update or delete on public.production_earning_settlements
for each row execute function public.reject_production_settlement_mutation();

create trigger production_earning_settlement_details_immutable
before update or delete on public.production_earning_settlement_details
for each row execute function public.reject_production_settlement_mutation();

-- Existing Production weekly rows become one compact immutable opening per
-- labourer. Their original weekly headers and details remain unchanged.
insert into public.production_earning_settlements (
  factory_id,
  labourer_id,
  previous_settled_through,
  settled_through,
  total_quantity,
  total_earned,
  settlement_type,
  withdrawal_id
)
select
  weekly.factory_id,
  weekly.labourer_id,
  null,
  max(weekly.week_start + 6),
  sum(weekly.quantity_used)::bigint,
  sum(weekly.amount),
  'legacy_opening',
  null
from public.weekly_earnings as weekly
where weekly.labourer_id is not null
group by weekly.factory_id, weekly.labourer_id;

create or replace function public.calculate_production_labourer_account(
  p_factory_id uuid,
  p_labourer_id uuid,
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
  resolved_settled_earned numeric := 0;
  resolved_live_earned numeric := 0;
  resolved_total_withdrawn numeric := 0;
begin
  if p_factory_id is null or p_labourer_id is null
    or p_as_of_date is null or not isfinite(p_as_of_date) then
    raise exception 'Factory, labourer, and finite as-of date are required.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.labourers
    where labourers.id = p_labourer_id
      and labourers.factory_id = p_factory_id
  ) then
    raise exception 'Labourer does not belong to this factory.' using errcode = '42501';
  end if;

  select max(settlements.settled_through), coalesce(sum(settlements.total_earned), 0)
  into resolved_cutoff, resolved_settled_earned
  from public.production_earning_settlements as settlements
  where settlements.factory_id = p_factory_id
    and settlements.labourer_id = p_labourer_id
    and settlements.settled_through <= p_as_of_date;

  select coalesce(sum(
    entries.quantity::numeric * resolved.rate_per_1000_bricks / 1000
  ), 0)
  into resolved_live_earned
  from public.production_entries as entries
  cross join lateral public.resolve_production_wage_rate(
    entries.factory_id,
    entries.labourer_id,
    entries.production_date
  ) as resolved
  where entries.factory_id = p_factory_id
    and entries.labourer_id = p_labourer_id
    and (resolved_cutoff is null or entries.production_date > resolved_cutoff)
    and entries.production_date <= p_as_of_date;

  select coalesce(sum(existing.amount), 0)
  into resolved_total_withdrawn
  from public.withdrawals as existing
  where existing.factory_id = p_factory_id
    and existing.labourer_id = p_labourer_id
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

revoke all on function public.calculate_production_labourer_account(uuid, uuid, date)
  from public, anon, authenticated;

create or replace function public.get_production_labourer_account(
  p_factory_id uuid,
  p_labourer_id uuid,
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
  select * from public.calculate_production_labourer_account(
    p_factory_id, p_labourer_id, p_as_of_date
  );
end;
$$;

revoke all on function public.get_production_labourer_account(uuid, uuid, date)
  from public, anon, authenticated;
grant execute on function public.get_production_labourer_account(uuid, uuid, date)
  to authenticated;

create or replace function public.create_labourer_withdrawal(
  p_factory_id uuid,
  p_labourer_id uuid,
  p_withdrawal_date date,
  p_settlement_cutoff date,
  p_amount numeric
)
returns table (
  withdrawal_id uuid,
  withdrawal_factory_id uuid,
  withdrawal_labourer_id uuid,
  withdrawal_date date,
  withdrawal_amount numeric,
  created_at timestamptz,
  available_balance numeric,
  settlement_id uuid,
  settled_through date
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  business_today date := (now() at time zone 'Asia/Kolkata')::date;
  previous_cutoff date;
  latest_withdrawal_date date;
  settlement_quantity bigint := 0;
  settlement_earned numeric := 0;
  balance_before_withdrawal numeric := 0;
  new_withdrawal_id uuid := gen_random_uuid();
  new_settlement_id uuid := gen_random_uuid();
  new_withdrawal public.withdrawals%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;
  if p_labourer_id is null or not exists (
    select 1 from public.labourers
    where labourers.id = p_labourer_id
      and labourers.factory_id = p_factory_id
  ) then
    raise exception 'Labourer does not belong to this factory.' using errcode = '42501';
  end if;
  if p_withdrawal_date is null or not isfinite(p_withdrawal_date)
    or p_settlement_cutoff is null or not isfinite(p_settlement_cutoff) then
    raise exception 'Withdrawal date and settlement cutoff must be finite calendar dates.' using errcode = '22023';
  end if;
  if p_withdrawal_date > business_today then
    raise exception 'Withdrawal date cannot be in the future.' using errcode = 'P2502';
  end if;
  if p_settlement_cutoff > p_withdrawal_date then
    raise exception 'Settlement cutoff cannot be after the withdrawal date.' using errcode = 'P2503';
  end if;
  if p_amount is null or p_amount <= 0
    or p_amount = 'NaN'::numeric
    or p_amount = 'Infinity'::numeric
    or p_amount = '-Infinity'::numeric then
    raise exception 'amount must be a positive finite number.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_factory_id::text),
    hashtext('production_account:' || p_labourer_id::text)
  );

  select max(settlements.settled_through)
  into previous_cutoff
  from public.production_earning_settlements as settlements
  where settlements.factory_id = p_factory_id
    and settlements.labourer_id = p_labourer_id;

  select max(existing.withdrawal_date)
  into latest_withdrawal_date
  from public.withdrawals as existing
  where existing.factory_id = p_factory_id
    and existing.labourer_id = p_labourer_id;

  if previous_cutoff is not null and p_settlement_cutoff < previous_cutoff then
    raise exception 'Settlement cutoff cannot be before the latest cutoff %.', previous_cutoff using errcode = 'P2504';
  end if;
  if latest_withdrawal_date is not null and p_withdrawal_date < latest_withdrawal_date then
    raise exception 'Withdrawal date cannot be before the latest withdrawal date %.', latest_withdrawal_date using errcode = 'P2505';
  end if;

  select
    coalesce(sum(entries.quantity), 0)::bigint,
    coalesce(sum(entries.quantity::numeric * resolved.rate_per_1000_bricks / 1000), 0)
  into settlement_quantity, settlement_earned
  from public.production_entries as entries
  cross join lateral public.resolve_production_wage_rate(
    entries.factory_id,
    entries.labourer_id,
    entries.production_date
  ) as resolved
  where entries.factory_id = p_factory_id
    and entries.labourer_id = p_labourer_id
    and (previous_cutoff is null or entries.production_date > previous_cutoff)
    and entries.production_date <= p_settlement_cutoff;

  insert into public.production_earning_settlements (
    id, factory_id, labourer_id, previous_settled_through, settled_through,
    total_quantity, total_earned, settlement_type, withdrawal_id
  ) values (
    new_settlement_id, p_factory_id, p_labourer_id, previous_cutoff, p_settlement_cutoff,
    settlement_quantity, settlement_earned, 'withdrawal', new_withdrawal_id
  );

  insert into public.production_earning_settlement_details (
    settlement_id, factory_id, labourer_id, production_entry_id, work_date,
    quantity, production_wage_rate_id, rate_per_1000_bricks, earned_amount
  )
  select
    new_settlement_id,
    entries.factory_id,
    entries.labourer_id,
    entries.id,
    entries.production_date,
    entries.quantity,
    resolved.production_wage_rate_id,
    resolved.rate_per_1000_bricks,
    entries.quantity::numeric * resolved.rate_per_1000_bricks / 1000
  from public.production_entries as entries
  cross join lateral public.resolve_production_wage_rate(
    entries.factory_id,
    entries.labourer_id,
    entries.production_date
  ) as resolved
  where entries.factory_id = p_factory_id
    and entries.labourer_id = p_labourer_id
    and (previous_cutoff is null or entries.production_date > previous_cutoff)
    and entries.production_date <= p_settlement_cutoff
  order by entries.production_date, entries.id;

  select account.available_balance
  into balance_before_withdrawal
  from public.calculate_production_labourer_account(
    p_factory_id, p_labourer_id, p_withdrawal_date
  ) as account;

  if p_amount > balance_before_withdrawal then
    raise exception 'Withdrawal amount % exceeds available balance % as of %.',
      p_amount, balance_before_withdrawal, p_withdrawal_date
      using errcode = 'P0001';
  end if;

  insert into public.withdrawals (
    id, factory_id, labourer_id, withdrawal_date, amount
  ) values (
    new_withdrawal_id, p_factory_id, p_labourer_id, p_withdrawal_date, p_amount
  ) returning * into new_withdrawal;

  withdrawal_id := new_withdrawal.id;
  withdrawal_factory_id := new_withdrawal.factory_id;
  withdrawal_labourer_id := new_withdrawal.labourer_id;
  withdrawal_date := new_withdrawal.withdrawal_date;
  withdrawal_amount := new_withdrawal.amount;
  created_at := new_withdrawal.created_at;
  available_balance := balance_before_withdrawal - new_withdrawal.amount;
  settlement_id := new_settlement_id;
  settled_through := p_settlement_cutoff;
  return next;
end;
$$;

-- Compatibility for old clients: the same authoritative path with yesterday's
-- cutoff. The five-argument overload is the new explicit UI contract.
create or replace function public.create_labourer_withdrawal(
  p_factory_id uuid,
  p_labourer_id uuid,
  p_withdrawal_date date,
  p_amount numeric
)
returns table (
  withdrawal_id uuid,
  withdrawal_factory_id uuid,
  withdrawal_labourer_id uuid,
  withdrawal_date date,
  withdrawal_amount numeric,
  created_at timestamptz,
  available_balance numeric
)
language sql
security definer
set search_path = pg_catalog, public
as $$
  select
    created.withdrawal_id,
    created.withdrawal_factory_id,
    created.withdrawal_labourer_id,
    created.withdrawal_date,
    created.withdrawal_amount,
    created.created_at,
    created.available_balance
  from public.create_labourer_withdrawal(
    p_factory_id,
    p_labourer_id,
    p_withdrawal_date,
    p_withdrawal_date - 1,
    p_amount
  ) as created;
$$;

revoke all on function public.create_labourer_withdrawal(uuid, uuid, date, date, numeric)
  from public, anon, authenticated;
grant execute on function public.create_labourer_withdrawal(uuid, uuid, date, date, numeric)
  to authenticated;
revoke all on function public.create_labourer_withdrawal(uuid, uuid, date, numeric)
  from public, anon, authenticated;
grant execute on function public.create_labourer_withdrawal(uuid, uuid, date, numeric)
  to authenticated;

comment on table public.production_earning_settlements is
  'Immutable incremental Production earning checkpoints. Legacy openings preserve existing weekly totals without reconstructing days.';
comment on table public.production_earning_settlement_details is
  'Immutable daily quantity and direct-rate snapshots included in a Production earning checkpoint.';
comment on function public.get_production_labourer_account(uuid, uuid, date) is
  'Authoritative Production labourer account: settled earned plus post-cutoff live earned minus withdrawals.';
comment on function public.create_labourer_withdrawal(uuid, uuid, date, date, numeric) is
  'Atomically settles Production through a chosen cutoff and creates one immutable labourer withdrawal.';
