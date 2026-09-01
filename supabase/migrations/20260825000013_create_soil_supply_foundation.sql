-- Atlas Soil Supply T1: independent workers and individual effective-dated trolley rates.

create extension if not exists btree_gist;

create table public.soil_workers (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint soil_workers_id_factory_key unique (id, factory_id),
  constraint soil_workers_name_check check (
    name <> ''
    and name = btrim(name)
    and name = regexp_replace(name, '[[:space:]]+', ' ', 'g')
    and name !~ '[[:cntrl:]]'
  )
);

create table public.soil_worker_trolley_rates (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  soil_worker_id uuid not null,
  rate_per_trolley numeric not null,
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  constraint soil_worker_trolley_rates_id_factory_key unique (id, factory_id),
  constraint soil_worker_trolley_rates_rate_check check (
    rate_per_trolley > 0
    and rate_per_trolley <> 'NaN'::numeric
    and rate_per_trolley <> 'Infinity'::numeric
  ),
  constraint soil_worker_trolley_rates_effective_dates_check check (
    isfinite(effective_from)
    and (
      effective_to is null
      or (isfinite(effective_to) and effective_to >= effective_from)
    )
  ),
  constraint soil_worker_trolley_rates_worker_factory_fkey
    foreign key (soil_worker_id, factory_id)
    references public.soil_workers (id, factory_id) on delete restrict,
  constraint soil_worker_trolley_rates_no_overlapping_dates
    exclude using gist (
      soil_worker_id with =,
      daterange(effective_from, effective_to, '[]') with &&
    )
);

create index soil_workers_factory_name_idx
  on public.soil_workers (factory_id, name, id);

create index soil_worker_trolley_rates_factory_worker_from_idx
  on public.soil_worker_trolley_rates (
    factory_id,
    soil_worker_id,
    effective_from desc,
    id desc
  );

create trigger soil_workers_set_updated_at
before update on public.soil_workers
for each row execute function public.set_updated_at();

alter table public.soil_workers enable row level security;
alter table public.soil_worker_trolley_rates enable row level security;

revoke all on public.soil_workers from anon, authenticated;
revoke all on public.soil_worker_trolley_rates from anon, authenticated;

grant select on public.soil_workers to authenticated;
grant select on public.soil_worker_trolley_rates to authenticated;

create policy "Authenticated users can read their factory Soil workers"
  on public.soil_workers
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = soil_workers.factory_id
        and factory_users.is_active = true
    )
  );

create policy "Authenticated users can read their factory Soil trolley rates"
  on public.soil_worker_trolley_rates
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = soil_worker_trolley_rates.factory_id
        and factory_users.is_active = true
    )
  );

create or replace function public.create_soil_worker_with_initial_trolley_rate(
  p_factory_id uuid,
  p_name text,
  p_initial_rate_per_trolley numeric,
  p_initial_effective_from date
)
returns public.soil_workers
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_name text;
  new_worker public.soil_workers%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.'
      using errcode = '42501';
  end if;

  normalized_name := btrim(regexp_replace(p_name, '[[:space:]]+', ' ', 'g'));
  if normalized_name is null or normalized_name = '' then
    raise exception 'Soil worker name is required.'
      using errcode = '22023';
  end if;

  if p_initial_rate_per_trolley is null
    or p_initial_rate_per_trolley <= 0
    or p_initial_rate_per_trolley = 'NaN'::numeric
    or p_initial_rate_per_trolley = 'Infinity'::numeric then
    raise exception 'initial_rate_per_trolley must be greater than zero.'
      using errcode = '22023';
  end if;

  if p_initial_effective_from is null or not isfinite(p_initial_effective_from) then
    raise exception 'initial_effective_from must be a finite calendar date.'
      using errcode = '22023';
  end if;

  insert into public.soil_workers (factory_id, name)
  values (p_factory_id, normalized_name)
  returning * into new_worker;

  insert into public.soil_worker_trolley_rates (
    factory_id,
    soil_worker_id,
    rate_per_trolley,
    effective_from
  ) values (
    p_factory_id,
    new_worker.id,
    p_initial_rate_per_trolley,
    p_initial_effective_from
  );

  return new_worker;
end;
$$;

create or replace function public.create_soil_worker_trolley_rate(
  p_factory_id uuid,
  p_soil_worker_id uuid,
  p_rate_per_trolley numeric,
  p_effective_from date
)
returns public.soil_worker_trolley_rates
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  previous_rate public.soil_worker_trolley_rates%rowtype;
  new_rate public.soil_worker_trolley_rates%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.'
      using errcode = '42501';
  end if;

  if p_soil_worker_id is null or not exists (
    select 1
    from public.soil_workers
    where soil_workers.id = p_soil_worker_id
      and soil_workers.factory_id = p_factory_id
  ) then
    raise exception 'Soil worker does not belong to this factory.'
      using errcode = 'P2602';
  end if;

  if p_rate_per_trolley is null
    or p_rate_per_trolley <= 0
    or p_rate_per_trolley = 'NaN'::numeric
    or p_rate_per_trolley = 'Infinity'::numeric then
    raise exception 'rate_per_trolley must be greater than zero.'
      using errcode = '22023';
  end if;

  if p_effective_from is null or not isfinite(p_effective_from) then
    raise exception 'effective_from must be a finite calendar date.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtext('soil_worker_trolley_rate'),
    hashtext(p_soil_worker_id::text)
  );

  select *
    into previous_rate
    from public.soil_worker_trolley_rates
    where soil_worker_trolley_rates.factory_id = p_factory_id
      and soil_worker_trolley_rates.soil_worker_id = p_soil_worker_id
    order by soil_worker_trolley_rates.effective_from desc,
      soil_worker_trolley_rates.id desc
    limit 1
    for update;

  if not found then
    raise exception 'Soil worker has no initial trolley rate.'
      using errcode = 'P2601';
  end if;

  if p_effective_from <= previous_rate.effective_from then
    raise exception 'effective_from must be later than the latest Soil trolley-rate start (%).',
      previous_rate.effective_from
      using errcode = 'P2603';
  end if;

  if previous_rate.effective_to is not null then
    raise exception 'Latest Soil trolley rate must be open-ended before adding a replacement.'
      using errcode = 'P2604';
  end if;

  update public.soil_worker_trolley_rates
  set effective_to = p_effective_from - 1
  where id = previous_rate.id;

  insert into public.soil_worker_trolley_rates (
    factory_id,
    soil_worker_id,
    rate_per_trolley,
    effective_from
  ) values (
    p_factory_id,
    p_soil_worker_id,
    p_rate_per_trolley,
    p_effective_from
  )
  returning * into new_rate;

  return new_rate;
end;
$$;

create or replace function public.resolve_soil_worker_trolley_rate(
  p_factory_id uuid,
  p_soil_worker_id uuid,
  p_work_date date
)
returns public.soil_worker_trolley_rates
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  matching_rate_count integer;
  matched_rate public.soil_worker_trolley_rates%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.'
      using errcode = '42501';
  end if;

  if p_soil_worker_id is null or not exists (
    select 1
    from public.soil_workers
    where soil_workers.id = p_soil_worker_id
      and soil_workers.factory_id = p_factory_id
  ) then
    raise exception 'Soil worker does not belong to this factory.'
      using errcode = 'P2602';
  end if;

  if p_work_date is null or not isfinite(p_work_date) then
    raise exception 'work_date must be a finite calendar date.'
      using errcode = '22023';
  end if;

  select count(*)
    into matching_rate_count
    from public.soil_worker_trolley_rates
    where soil_worker_trolley_rates.factory_id = p_factory_id
      and soil_worker_trolley_rates.soil_worker_id = p_soil_worker_id
      and soil_worker_trolley_rates.effective_from <= p_work_date
      and (
        soil_worker_trolley_rates.effective_to is null
        or soil_worker_trolley_rates.effective_to >= p_work_date
      );

  if matching_rate_count = 0 then
    raise exception 'No Soil trolley rate applies to worker % on %.',
      p_soil_worker_id,
      p_work_date
      using errcode = 'P2605';
  end if;

  if matching_rate_count > 1 then
    raise exception 'Multiple Soil trolley rates apply to worker % on %.',
      p_soil_worker_id,
      p_work_date
      using errcode = 'P2606';
  end if;

  select *
    into matched_rate
    from public.soil_worker_trolley_rates
    where soil_worker_trolley_rates.factory_id = p_factory_id
      and soil_worker_trolley_rates.soil_worker_id = p_soil_worker_id
      and soil_worker_trolley_rates.effective_from <= p_work_date
      and (
        soil_worker_trolley_rates.effective_to is null
        or soil_worker_trolley_rates.effective_to >= p_work_date
      )
    order by soil_worker_trolley_rates.effective_from desc,
      soil_worker_trolley_rates.id desc
    limit 1;

  return matched_rate;
end;
$$;

revoke all on function public.create_soil_worker_with_initial_trolley_rate(
  uuid, text, numeric, date
) from public, anon;
grant execute on function public.create_soil_worker_with_initial_trolley_rate(
  uuid, text, numeric, date
) to authenticated;

revoke all on function public.create_soil_worker_trolley_rate(
  uuid, uuid, numeric, date
) from public, anon;
grant execute on function public.create_soil_worker_trolley_rate(
  uuid, uuid, numeric, date
) to authenticated;

revoke all on function public.resolve_soil_worker_trolley_rate(
  uuid, uuid, date
) from public, anon;
grant execute on function public.resolve_soil_worker_trolley_rate(
  uuid, uuid, date
) to authenticated;

comment on table public.soil_workers is
  'Independent factory-scoped Soil Supply workers. Lifecycle write operations are added in T7.';
comment on table public.soil_worker_trolley_rates is
  'Historical individual Soil worker wage rates expressed in rupees per trolley.';
