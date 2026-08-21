-- Atlas Staff Salary S2: lifecycle eligibility and immutable monthly entitlements.

create table public.staff_salary_eligibility_periods (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  staff_worker_id uuid not null,
  effective_from_month date not null,
  effective_to_month date,
  first_month_custom_salary numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_salary_eligibility_periods_id_factory_key
    unique (id, factory_id),
  constraint staff_salary_eligibility_periods_worker_factory_fkey
    foreign key (staff_worker_id, factory_id)
    references public.staff_workers (id, factory_id) on delete restrict,
  constraint staff_salary_eligibility_periods_months_check check (
    isfinite(effective_from_month)
    and effective_from_month = date_trunc('month', effective_from_month)::date
    and (
      effective_to_month is null
      or (
        isfinite(effective_to_month)
        and effective_to_month = date_trunc('month', effective_to_month)::date
        and effective_to_month >= effective_from_month
      )
    )
  ),
  constraint staff_salary_eligibility_periods_custom_salary_check check (
    first_month_custom_salary is null
    or (
      first_month_custom_salary > 0
      and first_month_custom_salary <> 'NaN'::numeric
    )
  ),
  constraint staff_salary_eligibility_periods_no_overlap exclude using gist (
    staff_worker_id with =,
    daterange(effective_from_month, effective_to_month, '[]') with &&
  )
);

create table public.staff_monthly_earnings (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  staff_worker_id uuid not null,
  salary_month date not null,
  credited_amount numeric not null,
  salary_configuration_id uuid not null,
  resolved_monthly_salary_snapshot numeric not null,
  salary_source_snapshot text not null,
  credit_source text not null,
  staff_category_id_snapshot uuid not null,
  created_at timestamptz not null default now(),
  constraint staff_monthly_earnings_id_factory_key unique (id, factory_id),
  constraint staff_monthly_earnings_worker_month_key
    unique (factory_id, staff_worker_id, salary_month),
  constraint staff_monthly_earnings_worker_factory_fkey
    foreign key (staff_worker_id, factory_id)
    references public.staff_workers (id, factory_id) on delete restrict,
  constraint staff_monthly_earnings_configuration_factory_fkey
    foreign key (salary_configuration_id, factory_id)
    references public.staff_monthly_salary_rates (id, factory_id) on delete restrict,
  constraint staff_monthly_earnings_category_factory_fkey
    foreign key (staff_category_id_snapshot, factory_id)
    references public.staff_categories (id, factory_id) on delete restrict,
  constraint staff_monthly_earnings_salary_month_check check (
    isfinite(salary_month)
    and salary_month = date_trunc('month', salary_month)::date
  ),
  constraint staff_monthly_earnings_amounts_check check (
    credited_amount > 0
    and credited_amount <> 'NaN'::numeric
    and resolved_monthly_salary_snapshot > 0
    and resolved_monthly_salary_snapshot <> 'NaN'::numeric
  ),
  constraint staff_monthly_earnings_salary_source_check check (
    salary_source_snapshot in ('CATEGORY_DEFAULT', 'STAFF_OVERRIDE')
  ),
  constraint staff_monthly_earnings_credit_source_check check (
    credit_source in ('NORMAL_SALARY', 'FIRST_MONTH_CUSTOM')
  )
);

create index staff_salary_eligibility_periods_worker_history_idx
  on public.staff_salary_eligibility_periods (
    factory_id, staff_worker_id, effective_from_month desc
  );

create index staff_monthly_earnings_worker_history_idx
  on public.staff_monthly_earnings (
    factory_id, staff_worker_id, salary_month desc, id
  );

create trigger staff_salary_eligibility_periods_set_updated_at
before update on public.staff_salary_eligibility_periods
for each row execute function public.set_updated_at();

create or replace function public.prevent_staff_monthly_earning_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'Staff monthly earnings are immutable.' using errcode = 'P2510';
end;
$$;

create trigger staff_monthly_earnings_are_immutable
before update or delete on public.staff_monthly_earnings
for each row execute function public.prevent_staff_monthly_earning_mutation();

alter table public.staff_salary_eligibility_periods enable row level security;
alter table public.staff_monthly_earnings enable row level security;

revoke all on public.staff_salary_eligibility_periods,
  public.staff_monthly_earnings from anon;
revoke all on public.staff_salary_eligibility_periods,
  public.staff_monthly_earnings from authenticated;
grant select on public.staff_salary_eligibility_periods,
  public.staff_monthly_earnings to authenticated;

-- S2 makes Staff creation and lifecycle RPC-only so eligibility cannot be bypassed.
revoke insert, update on public.staff_workers from authenticated;

create policy "Authenticated users can read their factory Staff salary eligibility"
  on public.staff_salary_eligibility_periods for select to authenticated
  using (
    exists (
      select 1 from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = staff_salary_eligibility_periods.factory_id
        and factory_users.is_active = true
    )
  );

create policy "Authenticated users can read their factory Staff monthly earnings"
  on public.staff_monthly_earnings for select to authenticated
  using (
    exists (
      select 1 from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = staff_monthly_earnings.factory_id
        and factory_users.is_active = true
    )
  );

create or replace function public.create_staff_worker(
  p_factory_id uuid,
  p_name text,
  p_staff_category_id uuid,
  p_salary_start_month date,
  p_first_month_custom_salary numeric default null
)
returns public.staff_workers
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  new_worker public.staff_workers%rowtype;
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
    raise exception 'Staff worker name is required.' using errcode = '22023';
  end if;

  if p_salary_start_month is null or not isfinite(p_salary_start_month)
    or p_salary_start_month <> date_trunc('month', p_salary_start_month)::date then
    raise exception 'salary_start_month must be the first day of a finite month.'
      using errcode = '22023';
  end if;

  if p_first_month_custom_salary is not null and (
    p_first_month_custom_salary <= 0
    or p_first_month_custom_salary = 'NaN'::numeric
  ) then
    raise exception 'first_month_custom_salary must be greater than zero.'
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.staff_categories
    where staff_categories.id = p_staff_category_id
      and staff_categories.factory_id = p_factory_id
  ) then
    raise exception 'Staff category does not belong to this factory.' using errcode = '42501';
  end if;

  insert into public.staff_workers (
    factory_id, name, staff_category_id, is_active
  ) values (
    p_factory_id, btrim(p_name), p_staff_category_id, true
  ) returning * into new_worker;

  insert into public.staff_salary_eligibility_periods (
    factory_id, staff_worker_id, effective_from_month,
    first_month_custom_salary
  ) values (
    p_factory_id, new_worker.id, p_salary_start_month,
    p_first_month_custom_salary
  );

  return new_worker;
end;
$$;

create or replace function public.deactivate_staff_worker(
  p_factory_id uuid,
  p_staff_worker_id uuid,
  p_deactivation_month date
)
returns public.staff_workers
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  worker_row public.staff_workers%rowtype;
  open_period public.staff_salary_eligibility_periods%rowtype;
  business_month date := date_trunc(
    'month', (now() at time zone 'Asia/Kolkata')::date
  )::date;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;

  if p_deactivation_month is null or not isfinite(p_deactivation_month)
    or p_deactivation_month <> date_trunc('month', p_deactivation_month)::date
    or p_deactivation_month > business_month then
    raise exception 'deactivation_month must be the first day of a month no later than the current business month.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_factory_id::text),
    hashtext('staff_salary_lifecycle:' || p_staff_worker_id::text)
  );

  select * into worker_row
  from public.staff_workers
  where staff_workers.id = p_staff_worker_id
    and staff_workers.factory_id = p_factory_id
  for update;

  if not found then
    raise exception 'Staff worker does not belong to this factory.' using errcode = 'P2502';
  end if;
  if not worker_row.is_active then
    raise exception 'Staff worker is already inactive.';
  end if;

  select * into open_period
  from public.staff_salary_eligibility_periods
  where staff_salary_eligibility_periods.factory_id = p_factory_id
    and staff_salary_eligibility_periods.staff_worker_id = p_staff_worker_id
    and staff_salary_eligibility_periods.effective_to_month is null
  for update;

  if not found then
    raise exception 'Active Staff worker has no open salary eligibility period.';
  end if;
  if p_deactivation_month < open_period.effective_from_month then
    raise exception 'deactivation_month cannot be before the salary eligibility start month.';
  end if;
  if exists (
    select 1 from public.staff_monthly_earnings
    where staff_monthly_earnings.factory_id = p_factory_id
      and staff_monthly_earnings.staff_worker_id = p_staff_worker_id
      and staff_monthly_earnings.salary_month > p_deactivation_month
  ) then
    raise exception 'Deactivation would contradict immutable Staff monthly earnings.';
  end if;

  update public.staff_salary_eligibility_periods
  set effective_to_month = p_deactivation_month
  where id = open_period.id;

  update public.staff_workers
  set is_active = false
  where id = p_staff_worker_id and factory_id = p_factory_id
  returning * into worker_row;

  return worker_row;
end;
$$;

create or replace function public.reactivate_staff_worker(
  p_factory_id uuid,
  p_staff_worker_id uuid,
  p_salary_restart_month date
)
returns public.staff_workers
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  worker_row public.staff_workers%rowtype;
  latest_eligibility_end date;
  business_month date := date_trunc(
    'month', (now() at time zone 'Asia/Kolkata')::date
  )::date;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;

  if p_salary_restart_month is null or not isfinite(p_salary_restart_month)
    or p_salary_restart_month <> date_trunc('month', p_salary_restart_month)::date
    or p_salary_restart_month > business_month then
    raise exception 'salary_restart_month must be the first day of a month no later than the current business month.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_factory_id::text),
    hashtext('staff_salary_lifecycle:' || p_staff_worker_id::text)
  );

  select * into worker_row
  from public.staff_workers
  where staff_workers.id = p_staff_worker_id
    and staff_workers.factory_id = p_factory_id
  for update;

  if not found then
    raise exception 'Staff worker does not belong to this factory.' using errcode = 'P2502';
  end if;
  if worker_row.is_active then
    raise exception 'Staff worker is already active.';
  end if;
  if exists (
    select 1 from public.staff_salary_eligibility_periods
    where staff_salary_eligibility_periods.factory_id = p_factory_id
      and staff_salary_eligibility_periods.staff_worker_id = p_staff_worker_id
      and staff_salary_eligibility_periods.effective_to_month is null
  ) then
    raise exception 'Inactive Staff worker has an open salary eligibility period.';
  end if;

  select max(effective_to_month) into latest_eligibility_end
  from public.staff_salary_eligibility_periods
  where factory_id = p_factory_id and staff_worker_id = p_staff_worker_id;

  if latest_eligibility_end is null then
    raise exception 'Staff worker has no prior salary eligibility period.';
  end if;
  if p_salary_restart_month <= latest_eligibility_end then
    raise exception 'salary_restart_month must be after the previous eligibility end month.';
  end if;

  insert into public.staff_salary_eligibility_periods (
    factory_id, staff_worker_id, effective_from_month
  ) values (
    p_factory_id, p_staff_worker_id, p_salary_restart_month
  );

  update public.staff_workers
  set is_active = true
  where id = p_staff_worker_id and factory_id = p_factory_id
  returning * into worker_row;

  return worker_row;
end;
$$;

revoke all on function public.prevent_staff_monthly_earning_mutation() from public;
revoke all on function public.create_staff_worker(uuid, text, uuid, date, numeric) from public;
revoke all on function public.create_staff_worker(uuid, text, uuid, date, numeric) from anon;
grant execute on function public.create_staff_worker(uuid, text, uuid, date, numeric) to authenticated;
revoke all on function public.deactivate_staff_worker(uuid, uuid, date) from public;
revoke all on function public.deactivate_staff_worker(uuid, uuid, date) from anon;
grant execute on function public.deactivate_staff_worker(uuid, uuid, date) to authenticated;
revoke all on function public.reactivate_staff_worker(uuid, uuid, date) from public;
revoke all on function public.reactivate_staff_worker(uuid, uuid, date) from anon;
grant execute on function public.reactivate_staff_worker(uuid, uuid, date) to authenticated;

-- The custom amount is read only on each eligibility period's first month.

create or replace function public.ensure_staff_monthly_earnings(
  p_factory_id uuid,
  p_staff_worker_id uuid,
  p_through_month date
)
returns table (
  earnings_created integer,
  first_created_month date,
  last_created_month date
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  month_row record;
  resolution record;
  amount_to_credit numeric;
  business_month date := date_trunc(
    'month', (now() at time zone 'Asia/Kolkata')::date
  )::date;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;

  if p_through_month is null or not isfinite(p_through_month)
    or p_through_month <> date_trunc('month', p_through_month)::date then
    raise exception 'through_month must be the first day of a finite month.'
      using errcode = '22023';
  end if;

  if p_through_month > business_month then
    raise exception 'through_month cannot be later than the current business month (%).',
      business_month using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.staff_workers
    where staff_workers.id = p_staff_worker_id
      and staff_workers.factory_id = p_factory_id
  ) then
    raise exception 'Staff worker does not belong to this factory.' using errcode = 'P2502';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_factory_id::text),
    hashtext('staff_salary_lifecycle:' || p_staff_worker_id::text)
  );

  earnings_created := 0;
  first_created_month := null;
  last_created_month := null;

  for month_row in
    select
      generated.salary_month::date as salary_month,
      case
        when generated.salary_month::date = eligibility.effective_from_month
          then eligibility.first_month_custom_salary
        else null
      end as first_month_custom_salary
    from public.staff_salary_eligibility_periods as eligibility
    cross join lateral generate_series(
      eligibility.effective_from_month::timestamp,
      least(
        coalesce(eligibility.effective_to_month, p_through_month),
        p_through_month
      )::timestamp,
      interval '1 month'
    ) as generated(salary_month)
    where eligibility.factory_id = p_factory_id
      and eligibility.staff_worker_id = p_staff_worker_id
      and eligibility.effective_from_month <= p_through_month
      and not exists (
        select 1 from public.staff_monthly_earnings
        where staff_monthly_earnings.factory_id = p_factory_id
          and staff_monthly_earnings.staff_worker_id = p_staff_worker_id
          and staff_monthly_earnings.salary_month = generated.salary_month::date
      )
    order by generated.salary_month
  loop
    select * into resolution
    from public.resolve_staff_monthly_salary(
      p_factory_id, p_staff_worker_id, month_row.salary_month
    );

    amount_to_credit := coalesce(
      month_row.first_month_custom_salary,
      resolution.monthly_salary
    );

    insert into public.staff_monthly_earnings (
      factory_id, staff_worker_id, salary_month, credited_amount,
      salary_configuration_id, resolved_monthly_salary_snapshot,
      salary_source_snapshot, credit_source, staff_category_id_snapshot
    ) values (
      p_factory_id, p_staff_worker_id, month_row.salary_month, amount_to_credit,
      resolution.salary_configuration_id, resolution.monthly_salary,
      resolution.source,
      case
        when month_row.first_month_custom_salary is null
          then 'NORMAL_SALARY'
        else 'FIRST_MONTH_CUSTOM'
      end,
      resolution.staff_category_id
    );

    earnings_created := earnings_created + 1;
    first_created_month := coalesce(first_created_month, month_row.salary_month);
    last_created_month := month_row.salary_month;
  end loop;

  return next;
end;
$$;

revoke all on function public.ensure_staff_monthly_earnings(uuid, uuid, date) from public;
revoke all on function public.ensure_staff_monthly_earnings(uuid, uuid, date) from anon;
grant execute on function public.ensure_staff_monthly_earnings(uuid, uuid, date) to authenticated;
