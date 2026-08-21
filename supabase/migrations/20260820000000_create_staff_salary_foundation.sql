create extension if not exists btree_gist;

create table public.staff_categories (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_categories_id_factory_key unique (id, factory_id),
  constraint staff_categories_factory_name_key unique (factory_id, name),
  constraint staff_categories_name_trimmed_check
    check (name = btrim(name) and name <> '')
);

create table public.staff_workers (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  name text not null,
  staff_category_id uuid not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_workers_id_factory_key unique (id, factory_id),
  constraint staff_workers_name_trimmed_check
    check (name = btrim(name) and name <> ''),
  constraint staff_workers_category_factory_fkey
    foreign key (staff_category_id, factory_id)
    references public.staff_categories (id, factory_id) on delete restrict
);

create table public.staff_monthly_salary_rates (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  staff_category_id uuid,
  staff_worker_id uuid,
  monthly_salary numeric not null,
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_monthly_salary_rates_id_factory_key unique (id, factory_id),
  constraint staff_monthly_salary_rates_exactly_one_target_check
    check ((staff_category_id is not null) <> (staff_worker_id is not null)),
  constraint staff_monthly_salary_rates_amount_check
    check (monthly_salary > 0 and monthly_salary <> 'NaN'::numeric),
  constraint staff_monthly_salary_rates_effective_dates_check
    check (
      effective_from not in ('infinity'::date, '-infinity'::date)
      and (effective_to is null or (
        effective_to not in ('infinity'::date, '-infinity'::date)
        and effective_to >= effective_from
      ))
    ),
  constraint staff_monthly_salary_rates_category_factory_fkey
    foreign key (staff_category_id, factory_id)
    references public.staff_categories (id, factory_id) on delete restrict,
  constraint staff_monthly_salary_rates_worker_factory_fkey
    foreign key (staff_worker_id, factory_id)
    references public.staff_workers (id, factory_id) on delete restrict,
  constraint staff_monthly_salary_rates_no_overlapping_category_dates
    exclude using gist (
      staff_category_id with =,
      daterange(effective_from, effective_to, '[]') with &&
    ) where (staff_category_id is not null),
  constraint staff_monthly_salary_rates_no_overlapping_worker_dates
    exclude using gist (
      staff_worker_id with =,
      daterange(effective_from, effective_to, '[]') with &&
    ) where (staff_worker_id is not null)
);

create index staff_categories_factory_active_idx
  on public.staff_categories (factory_id) where is_active;

create index staff_workers_factory_category_active_idx
  on public.staff_workers (factory_id, staff_category_id) where is_active;

create index staff_monthly_salary_rates_factory_from_idx
  on public.staff_monthly_salary_rates (factory_id, effective_from desc);

create trigger staff_categories_set_updated_at
before update on public.staff_categories
for each row execute function public.set_updated_at();

create trigger staff_workers_set_updated_at
before update on public.staff_workers
for each row execute function public.set_updated_at();

create trigger staff_monthly_salary_rates_set_updated_at
before update on public.staff_monthly_salary_rates
for each row execute function public.set_updated_at();

create or replace function public.prevent_staff_worker_reassignment()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.id is distinct from old.id
    or new.factory_id is distinct from old.factory_id
    or new.staff_category_id is distinct from old.staff_category_id then
    raise exception 'A Staff worker''s identity, factory, and category cannot be changed.'
      using errcode = 'P2501';
  end if;
  return new;
end;
$$;

create trigger staff_workers_prevent_reassignment
before update on public.staff_workers
for each row execute function public.prevent_staff_worker_reassignment();

alter table public.staff_categories enable row level security;
alter table public.staff_workers enable row level security;
alter table public.staff_monthly_salary_rates enable row level security;

revoke all on public.staff_categories, public.staff_workers,
  public.staff_monthly_salary_rates from anon;
revoke all on public.staff_categories, public.staff_workers,
  public.staff_monthly_salary_rates from authenticated;

grant select, insert, update on public.staff_categories to authenticated;
grant select, insert, update on public.staff_workers to authenticated;
grant select on public.staff_monthly_salary_rates to authenticated;

create policy "Authenticated users can read their factory Staff categories"
  on public.staff_categories for select to authenticated
  using (exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = staff_categories.factory_id
      and factory_users.is_active = true
  ));

create policy "Authenticated users can insert their factory Staff categories"
  on public.staff_categories for insert to authenticated
  with check (exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = staff_categories.factory_id
      and factory_users.is_active = true
  ));

create policy "Authenticated users can update their factory Staff categories"
  on public.staff_categories for update to authenticated
  using (exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = staff_categories.factory_id
      and factory_users.is_active = true
  ))
  with check (exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = staff_categories.factory_id
      and factory_users.is_active = true
  ));

create policy "Authenticated users can read their factory Staff workers"
  on public.staff_workers for select to authenticated
  using (exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = staff_workers.factory_id
      and factory_users.is_active = true
  ));

create policy "Authenticated users can insert their factory Staff workers"
  on public.staff_workers for insert to authenticated
  with check (exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = staff_workers.factory_id
      and factory_users.is_active = true
  ));

create policy "Authenticated users can update their factory Staff workers"
  on public.staff_workers for update to authenticated
  using (exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = staff_workers.factory_id
      and factory_users.is_active = true
  ))
  with check (exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = staff_workers.factory_id
      and factory_users.is_active = true
  ));

create policy "Authenticated users can read their factory Staff salary rates"
  on public.staff_monthly_salary_rates for select to authenticated
  using (exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = staff_monthly_salary_rates.factory_id
      and factory_users.is_active = true
  ));

create or replace function public.create_staff_category_monthly_salary(
  p_factory_id uuid,
  p_staff_category_id uuid,
  p_monthly_salary numeric,
  p_effective_from date
)
returns public.staff_monthly_salary_rates
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  previous_rate public.staff_monthly_salary_rates%rowtype;
  new_rate public.staff_monthly_salary_rates%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;

  if p_staff_category_id is null or not exists (
    select 1 from public.staff_categories
    where staff_categories.id = p_staff_category_id
      and staff_categories.factory_id = p_factory_id
  ) then
    raise exception 'Staff category does not belong to this factory.' using errcode = '42501';
  end if;

  if p_monthly_salary is null or p_monthly_salary <= 0
    or p_monthly_salary = 'NaN'::numeric then
    raise exception 'monthly_salary must be greater than zero.' using errcode = '22023';
  end if;

  if p_effective_from is null
    or p_effective_from in ('infinity'::date, '-infinity'::date) then
    raise exception 'effective_from must be a finite date.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_factory_id::text),
    hashtext('staff_category_monthly_salary:' || p_staff_category_id::text)
  );

  select * into previous_rate
  from public.staff_monthly_salary_rates
  where factory_id = p_factory_id
    and staff_category_id = p_staff_category_id
    and staff_worker_id is null
  order by effective_from desc, id desc
  limit 1 for update;

  if found then
    if p_effective_from <= previous_rate.effective_from then
      raise exception 'effective_from must be later than the latest category salary start (%).',
        previous_rate.effective_from using errcode = 'P0001';
    end if;
    if previous_rate.effective_to is not null then
      raise exception 'Latest category salary must be open-ended before adding a replacement.'
        using errcode = 'P0001';
    end if;
    update public.staff_monthly_salary_rates
    set effective_to = p_effective_from - 1
    where id = previous_rate.id;
  end if;

  insert into public.staff_monthly_salary_rates (
    factory_id, staff_category_id, staff_worker_id,
    monthly_salary, effective_from, effective_to
  ) values (
    p_factory_id, p_staff_category_id, null,
    p_monthly_salary, p_effective_from, null
  ) returning * into new_rate;

  return new_rate;
end;
$$;

create or replace function public.create_staff_monthly_salary_override(
  p_factory_id uuid,
  p_staff_worker_id uuid,
  p_monthly_salary numeric,
  p_effective_from date
)
returns public.staff_monthly_salary_rates
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  previous_rate public.staff_monthly_salary_rates%rowtype;
  new_rate public.staff_monthly_salary_rates%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;

  if p_staff_worker_id is null or not exists (
    select 1 from public.staff_workers
    where staff_workers.id = p_staff_worker_id
      and staff_workers.factory_id = p_factory_id
  ) then
    raise exception 'Staff worker does not belong to this factory.' using errcode = '42501';
  end if;

  if p_monthly_salary is null or p_monthly_salary <= 0
    or p_monthly_salary = 'NaN'::numeric then
    raise exception 'monthly_salary must be greater than zero.' using errcode = '22023';
  end if;

  if p_effective_from is null
    or p_effective_from in ('infinity'::date, '-infinity'::date) then
    raise exception 'effective_from must be a finite date.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_factory_id::text),
    hashtext('staff_worker_monthly_salary:' || p_staff_worker_id::text)
  );

  select * into previous_rate
  from public.staff_monthly_salary_rates
  where factory_id = p_factory_id
    and staff_worker_id = p_staff_worker_id
    and staff_category_id is null
  order by effective_from desc, id desc
  limit 1 for update;

  if found then
    if p_effective_from <= previous_rate.effective_from then
      raise exception 'effective_from must be later than the latest Staff override start (%).',
        previous_rate.effective_from using errcode = 'P0001';
    end if;
    if previous_rate.effective_to is not null then
      raise exception 'Latest Staff override must be open-ended before adding a replacement.'
        using errcode = 'P0001';
    end if;
    update public.staff_monthly_salary_rates
    set effective_to = p_effective_from - 1
    where id = previous_rate.id;
  end if;

  insert into public.staff_monthly_salary_rates (
    factory_id, staff_category_id, staff_worker_id,
    monthly_salary, effective_from, effective_to
  ) values (
    p_factory_id, null, p_staff_worker_id,
    p_monthly_salary, p_effective_from, null
  ) returning * into new_rate;

  return new_rate;
end;
$$;

create or replace function public.resolve_staff_monthly_salary(
  p_factory_id uuid,
  p_staff_id uuid,
  p_effective_date date
)
returns table (
  salary_configuration_id uuid,
  monthly_salary numeric,
  source text,
  staff_category_id uuid
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  worker_category_id uuid;
  matching_rate public.staff_monthly_salary_rates%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;

  if p_effective_date is null
    or p_effective_date in ('infinity'::date, '-infinity'::date) then
    raise exception 'effective_date must be a finite date.' using errcode = '22023';
  end if;

  select staff_workers.staff_category_id into worker_category_id
  from public.staff_workers
  where staff_workers.id = p_staff_id
    and staff_workers.factory_id = p_factory_id;

  if not found then
    raise exception 'Staff worker does not belong to this factory.' using errcode = 'P2502';
  end if;

  select * into matching_rate
  from public.staff_monthly_salary_rates
  where staff_monthly_salary_rates.factory_id = p_factory_id
    and staff_monthly_salary_rates.staff_worker_id = p_staff_id
    and staff_monthly_salary_rates.staff_category_id is null
    and staff_monthly_salary_rates.effective_from <= p_effective_date
    and (
      staff_monthly_salary_rates.effective_to is null
      or staff_monthly_salary_rates.effective_to >= p_effective_date
    );

  if found then
    salary_configuration_id := matching_rate.id;
    monthly_salary := matching_rate.monthly_salary;
    source := 'STAFF_OVERRIDE';
    staff_category_id := worker_category_id;
    return next;
    return;
  end if;

  select * into matching_rate
  from public.staff_monthly_salary_rates
  where staff_monthly_salary_rates.factory_id = p_factory_id
    and staff_monthly_salary_rates.staff_category_id = worker_category_id
    and staff_monthly_salary_rates.staff_worker_id is null
    and staff_monthly_salary_rates.effective_from <= p_effective_date
    and (
      staff_monthly_salary_rates.effective_to is null
      or staff_monthly_salary_rates.effective_to >= p_effective_date
    );

  if not found then
    raise exception 'No monthly salary applies to Staff worker % on %.',
      p_staff_id, p_effective_date using errcode = 'P2503';
  end if;

  salary_configuration_id := matching_rate.id;
  monthly_salary := matching_rate.monthly_salary;
  source := 'CATEGORY_DEFAULT';
  staff_category_id := worker_category_id;
  return next;
end;
$$;

revoke all on function public.prevent_staff_worker_reassignment() from public;
revoke all on function public.create_staff_category_monthly_salary(uuid, uuid, numeric, date) from public;
revoke all on function public.create_staff_category_monthly_salary(uuid, uuid, numeric, date) from anon;
grant execute on function public.create_staff_category_monthly_salary(uuid, uuid, numeric, date) to authenticated;
revoke all on function public.create_staff_monthly_salary_override(uuid, uuid, numeric, date) from public;
revoke all on function public.create_staff_monthly_salary_override(uuid, uuid, numeric, date) from anon;
grant execute on function public.create_staff_monthly_salary_override(uuid, uuid, numeric, date) to authenticated;
revoke all on function public.resolve_staff_monthly_salary(uuid, uuid, date) from public;
revoke all on function public.resolve_staff_monthly_salary(uuid, uuid, date) from anon;
grant execute on function public.resolve_staff_monthly_salary(uuid, uuid, date) to authenticated;
