-- Atlas 12D1.5E2: PREPARED ONLY. Review before any Test application.
-- Employer-funded missed wages; never rewrite or redistribute weekly snapshots.
-- Migration 75 and audited credits are ONE production release unit. Never
-- promote Migration 75 alone to Main. This file is not production authorization.
begin;

create table public.transport_wage_credits (
  id uuid primary key,
  factory_id uuid not null references public.factories(id) on delete restrict,
  transport_worker_id uuid not null,
  original_work_date date not null,
  posting_date date not null,
  amount numeric not null,
  reason text not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null,
  constraint transport_wage_credits_worker_factory_fkey
    foreign key (transport_worker_id, factory_id)
    references public.transport_workers(id, factory_id) on delete restrict,
  constraint transport_wage_credits_dates_check check (
    isfinite(original_work_date) and isfinite(posting_date)
    and original_work_date <= posting_date
  ),
  -- Unconstrained NUMERIC is deliberate: NUMERIC(p,2) silently rounds input.
  constraint transport_wage_credits_amount_check check (
    amount > 0 and amount <> 'NaN'::numeric
    and amount <> 'Infinity'::numeric and amount <> '-Infinity'::numeric
    and amount = trunc(amount, 2)
  ),
  constraint transport_wage_credits_reason_check check (
    reason = btrim(reason) and reason <> '' and reason ~ '[^[:space:]]'
  ),
  constraint transport_wage_credits_posting_timestamp_check check (
    isfinite(created_at) and posting_date = (created_at at time zone 'Asia/Kolkata')::date
  )
);

create index transport_wage_credits_worker_history_idx
  on public.transport_wage_credits
    (factory_id, transport_worker_id, posting_date desc, created_at desc, id desc);

create function public.prevent_transport_wage_credit_mutation()
returns trigger language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'ATLAS_TRANSPORT_WAGE_CREDIT_IMMUTABLE' using errcode = 'P2633';
end;
$$;

-- Statement-level protection also covers TRUNCATE and zero-row UPDATE/DELETE.
create trigger transport_wage_credits_prevent_mutation
before update or delete or truncate on public.transport_wage_credits
for each statement execute function public.prevent_transport_wage_credit_mutation();

alter table public.transport_wage_credits enable row level security;
revoke all on table public.transport_wage_credits from public, anon, authenticated;
grant select on table public.transport_wage_credits to authenticated;
grant select, insert on table public.transport_wage_credits to service_role;

create policy "Active members can read their factory Transport wage credits"
  on public.transport_wage_credits for select to authenticated
  using (exists (
    select 1 from public.factory_users m
    where m.user_id = auth.uid() and m.factory_id = transport_wage_credits.factory_id
      and m.is_active = true
  ));

-- Private earning-event definition; callers authenticate and scope the worker.
-- INVOKER is sufficient inside the existing SECURITY DEFINER financial RPCs.
create function public.get_transport_worker_earning_events(
  p_factory_id uuid, p_transport_worker_id uuid
)
returns table(event_date date, amount numeric)
language sql stable
set search_path = pg_catalog, public
as $$
  select e.week_start + 6, e.total_amount
  from public.transport_weekly_earnings e
  where e.factory_id = p_factory_id and e.transport_worker_id = p_transport_worker_id
  union all
  select c.posting_date, c.amount
  from public.transport_wage_credits c
  where c.factory_id = p_factory_id and c.transport_worker_id = p_transport_worker_id;
$$;

create function public.create_transport_wage_credit(
  p_factory_id uuid,
  p_credit_id uuid,
  p_transport_worker_id uuid,
  p_original_work_date date,
  p_amount numeric,
  p_reason text
)
returns table (
  credit_id uuid, factory_id uuid, transport_worker_id uuid,
  original_work_date date, posting_date date, amount numeric, reason text,
  actor_id uuid, created_at timestamptz, was_replayed boolean
)
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := auth.uid();
  normalized_reason text := btrim(p_reason);
  original_week date;
  posted_at timestamptz;
  business_today date;
  saved public.transport_wage_credits%rowtype;
  replayed boolean := false;
begin
  if actor is null or not exists (
    select 1 from public.factory_users m
    where m.user_id = actor and m.factory_id = p_factory_id and m.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;
  if p_transport_worker_id is null or not exists (
    select 1 from public.transport_workers w
    where w.id = p_transport_worker_id and w.factory_id = p_factory_id
  ) then
    raise exception 'Transport worker does not belong to this factory.' using errcode = '42501';
  end if;
  if p_credit_id is null then
    raise exception 'credit_id is required.' using errcode = '22023';
  end if;
  if p_original_work_date is null or not isfinite(p_original_work_date) then
    raise exception 'original_work_date must be a valid finite date.' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount = 'NaN'::numeric
    or p_amount = 'Infinity'::numeric or p_amount = '-Infinity'::numeric
    or p_amount <> trunc(p_amount, 2) then
    raise exception 'amount must be positive, finite and have at most two decimal places.'
      using errcode = '22023';
  end if;
  if normalized_reason is null or normalized_reason = '' or normalized_reason !~ '[^[:space:]]' then
    raise exception 'reason is required.' using errcode = '22023';
  end if;

  -- Factory source lock FIRST, then the exact existing withdrawal worker lock.
  -- Withdrawals never acquire this factory lock after their worker lock.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'atlas:transport_source_accounting:' || p_factory_id::text, 0));
  perform pg_advisory_xact_lock(hashtext(p_factory_id::text),
    hashtext('transport_worker_withdrawal:' || p_transport_worker_id::text));

  -- After waiting, use the acceptance-time business date, not transaction start.
  posted_at := clock_timestamp();
  business_today := (posted_at at time zone 'Asia/Kolkata')::date;
  if p_original_work_date > business_today then
    raise exception 'original_work_date cannot be after the posting date.' using errcode = '22023';
  end if;
  -- Compare week identities without subtracting days at PostgreSQL date limits.
  original_week := date_trunc('week', p_original_work_date::timestamp)::date;
  if not exists (
    select 1 from public.transport_weekly_earnings e
    where e.factory_id = p_factory_id and e.week_start = original_week
  ) then
    raise exception 'ATLAS_TRANSPORT_CREDIT_WEEK_NOT_FINALIZED' using errcode = 'P2631';
  end if;

  -- Global UUID lookup happens only after authorization and eligibility checks.
  select c.* into saved from public.transport_wage_credits c where c.id = p_credit_id;
  if found then
    replayed := true;
  else
    insert into public.transport_wage_credits as c (
      id, factory_id, transport_worker_id, original_work_date, posting_date,
      amount, reason, actor_id, created_at
    ) values (
      p_credit_id, p_factory_id, p_transport_worker_id, p_original_work_date,
      business_today, p_amount, normalized_reason, actor, posted_at
    ) on conflict (id) do nothing returning c.* into saved;
    if not found then
      -- A cross-factory UUID race is arbitrated by the PK, not a leaked 23505.
      -- READ COMMITTED gives this next statement a fresh snapshot. Higher
      -- isolation may require an unchanged-UUID retry after serialization failure.
      select c.* into saved from public.transport_wage_credits c where c.id = p_credit_id;
      if not found then
        raise exception 'ATLAS_TRANSPORT_CREDIT_RETRY_REQUIRED' using errcode = '40001';
      end if;
      replayed := true;
    end if;
  end if;
  if replayed and (
    saved.factory_id is distinct from p_factory_id
    or saved.transport_worker_id is distinct from p_transport_worker_id
    or saved.original_work_date is distinct from p_original_work_date
    or saved.amount is distinct from p_amount
    or saved.reason is distinct from normalized_reason
    or saved.actor_id is distinct from actor
  ) then
    raise exception 'ATLAS_TRANSPORT_CREDIT_REPLAY_CONFLICT' using errcode = 'P2632';
  end if;
  return query select saved.id, saved.factory_id, saved.transport_worker_id,
    saved.original_work_date, saved.posting_date, saved.amount, saved.reason,
    saved.actor_id, saved.created_at, replayed;
end;
$$;

create or replace function public.get_transport_worker_available_balance(
  p_factory_id uuid, p_transport_worker_id uuid, p_as_of_date date
)
returns table(total_earned numeric, total_withdrawn numeric, available_balance numeric)
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid() and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;
  if p_transport_worker_id is null or not exists (
    select 1 from public.transport_workers
    where transport_workers.id = p_transport_worker_id and transport_workers.factory_id = p_factory_id
  ) then
    raise exception 'Transport worker does not belong to this factory.' using errcode = '42501';
  end if;
  if p_as_of_date is null or not isfinite(p_as_of_date) then
    raise exception 'as_of_date must be a valid finite date.' using errcode = '22023';
  end if;
  select coalesce(sum(e.amount), 0) into total_earned
  from public.get_transport_worker_earning_events(p_factory_id, p_transport_worker_id) e
  where e.event_date <= p_as_of_date;
  select coalesce(sum(w.amount), 0) into total_withdrawn
  from public.transport_withdrawals w
  where w.factory_id = p_factory_id and w.transport_worker_id = p_transport_worker_id
    and w.withdrawal_date <= p_as_of_date;
  available_balance := total_earned - total_withdrawn;
  return next;
end;
$$;

create or replace function public.create_transport_worker_withdrawal(
  p_factory_id uuid, p_transport_worker_id uuid, p_withdrawal_date date, p_amount numeric
)
returns table (
  withdrawal_id uuid, withdrawal_factory_id uuid, withdrawal_transport_worker_id uuid,
  withdrawal_date date, withdrawal_amount numeric, created_at timestamptz, available_balance numeric
)
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  total_earned numeric := 0;
  total_withdrawn numeric := 0;
  balance_before_withdrawal numeric := 0;
  violating_date date;
  violating_headroom numeric;
  new_withdrawal public.transport_withdrawals%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid() and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;
  if p_transport_worker_id is null or not exists (
    select 1 from public.transport_workers
    where transport_workers.id = p_transport_worker_id and transport_workers.factory_id = p_factory_id
  ) then
    raise exception 'Transport worker does not belong to this factory.' using errcode = '42501';
  end if;
  if p_withdrawal_date is null or not isfinite(p_withdrawal_date) then
    raise exception 'withdrawal_date must be a valid finite date.' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount = 'NaN'::numeric then
    raise exception 'amount must be greater than zero.' using errcode = '22023';
  end if;
  -- Preserve Migration 74's lock and rejection contract; no factory lock here.
  perform pg_advisory_xact_lock(hashtext(p_factory_id::text),
    hashtext('transport_worker_withdrawal:' || p_transport_worker_id::text));
  select coalesce(sum(e.amount), 0) into total_earned
  from public.get_transport_worker_earning_events(p_factory_id, p_transport_worker_id) e
  where e.event_date <= p_withdrawal_date;
  select coalesce(sum(w.amount), 0) into total_withdrawn
  from public.transport_withdrawals w
  where w.factory_id = p_factory_id and w.transport_worker_id = p_transport_worker_id
    and w.withdrawal_date <= p_withdrawal_date;
  balance_before_withdrawal := total_earned - total_withdrawn;
  if p_amount > balance_before_withdrawal then
    raise exception 'Withdrawal amount % exceeds available balance % as of %.',
      p_amount, balance_before_withdrawal, p_withdrawal_date using errcode = 'P0001';
  end if;

  -- Candidate plus later meaningful events, not a calendar-day loop. Earnings
  -- on a date precede the date's aggregate withdrawals. Check later withdrawal
  -- dates even if a subsequent earning event would eventually restore balance.
  with events as (
    select p_withdrawal_date as event_date, 0::numeric as delta, true as check_balance
    union all
    select e.event_date, e.amount, false
    from public.get_transport_worker_earning_events(p_factory_id, p_transport_worker_id) e
    where e.event_date > p_withdrawal_date
    union all
    select w.withdrawal_date, -w.amount, true
    from public.transport_withdrawals w
    where w.factory_id = p_factory_id and w.transport_worker_id = p_transport_worker_id
      and w.withdrawal_date > p_withdrawal_date
  ), daily as (
    select event_date, sum(delta) as delta, bool_or(check_balance) as check_balance
    from events group by event_date
  ), running as (
    select event_date, check_balance,
      balance_before_withdrawal + sum(delta) over (
        order by event_date rows between unbounded preceding and current row
      ) as headroom
    from daily
  )
  select event_date, headroom into violating_date, violating_headroom
  from running where check_balance and headroom < p_amount order by event_date limit 1;
  if found then
    raise exception 'Withdrawal amount % exceeds available balance % as of %.',
      p_amount, violating_headroom, violating_date using errcode = 'P0001';
  end if;
  insert into public.transport_withdrawals (
    factory_id, transport_worker_id, withdrawal_date, amount
  ) values (p_factory_id, p_transport_worker_id, p_withdrawal_date, p_amount)
  returning * into new_withdrawal;
  withdrawal_id := new_withdrawal.id;
  withdrawal_factory_id := new_withdrawal.factory_id;
  withdrawal_transport_worker_id := new_withdrawal.transport_worker_id;
  withdrawal_date := new_withdrawal.withdrawal_date;
  withdrawal_amount := new_withdrawal.amount;
  created_at := new_withdrawal.created_at;
  available_balance := balance_before_withdrawal - new_withdrawal.amount;
  return next;
end;
$$;

-- Exact-function ACLs only. Existing replacements retain their owners/grants.
revoke all on function public.prevent_transport_wage_credit_mutation() from public, anon, authenticated;
revoke all on function public.get_transport_worker_earning_events(uuid,uuid) from public, anon, authenticated;
revoke all on function public.create_transport_wage_credit(uuid,uuid,uuid,date,numeric,text)
  from public, anon, authenticated;
grant execute on function public.create_transport_wage_credit(uuid,uuid,uuid,date,numeric,text)
  to authenticated, service_role;
revoke execute on function public.get_transport_worker_available_balance(uuid,uuid,date) from public, anon;
revoke execute on function public.create_transport_worker_withdrawal(uuid,uuid,date,numeric) from public, anon;

comment on table public.transport_wage_credits is
  'Append-only employer-paid missed wages for finalized factory/weeks. Original work date is evidence; posting date makes wages payable. Not cash/payment movement.';
comment on function public.create_transport_wage_credit(uuid,uuid,uuid,date,numeric,text) is
  'Authenticated same-factory positive wage credit. Same UUID/actor/normalized payload replays; conflicting UUID rejects. Server owns posting date and actor.';
comment on function public.get_transport_worker_earning_events(uuid,uuid) is
  'Private authoritative earning events: weekly headers effective Sunday plus wage credits effective posting date. No source recalculation.';

commit;
