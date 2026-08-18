create table public.transport_crew_wage_rates (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  transport_crew_id uuid not null,
  rate_per_paya numeric not null,
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  constraint transport_crew_wage_rates_id_factory_key
    unique (id, factory_id),
  constraint transport_crew_wage_rates_rate_per_paya_check
    check (
      rate_per_paya > 0
      and rate_per_paya <> 'NaN'::numeric
    ),
  constraint transport_crew_wage_rates_effective_dates_check
    check (
      isfinite(effective_from)
      and (
        effective_to is null
        or (isfinite(effective_to) and effective_to >= effective_from)
      )
    ),
  constraint transport_crew_wage_rates_crew_factory_fkey
    foreign key (transport_crew_id, factory_id)
    references public.transport_crews (id, factory_id) on delete restrict,
  constraint transport_crew_wage_rates_no_overlapping_dates
    exclude using gist (
      transport_crew_id with =,
      daterange(effective_from, effective_to, '[]') with &&
    )
);

create index transport_crew_wage_rates_factory_crew_from_idx
  on public.transport_crew_wage_rates (
    factory_id,
    transport_crew_id,
    effective_from desc,
    id desc
  );

alter table public.transport_crew_wage_rates enable row level security;

revoke all on public.transport_crew_wage_rates from anon;
revoke all on public.transport_crew_wage_rates from authenticated;

grant select on public.transport_crew_wage_rates to authenticated;

create policy "Authenticated users can read their factory transport crew wage rates"
  on public.transport_crew_wage_rates
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = transport_crew_wage_rates.factory_id
        and factory_users.is_active = true
    )
  );

create or replace function public.create_transport_crew_wage_rate(
  p_factory_id uuid,
  p_transport_crew_id uuid,
  p_effective_from date,
  p_rate_per_paya numeric
)
returns public.transport_crew_wage_rates
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  previous_rate public.transport_crew_wage_rates%rowtype;
  new_rate public.transport_crew_wage_rates%rowtype;
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

  if p_transport_crew_id is null or not exists (
    select 1
    from public.transport_crews
    where transport_crews.id = p_transport_crew_id
      and transport_crews.factory_id = p_factory_id
  ) then
    raise exception 'Transport crew does not belong to this factory.'
      using errcode = '42501';
  end if;

  if p_rate_per_paya is null
    or p_rate_per_paya <= 0
    or p_rate_per_paya = 'NaN'::numeric then
    raise exception 'rate_per_paya must be greater than zero.'
      using errcode = '22023';
  end if;

  if p_effective_from is null or not isfinite(p_effective_from) then
    raise exception 'effective_from must be a finite calendar date.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_factory_id::text),
    hashtext('transport_crew_wage_rate:' || p_transport_crew_id::text)
  );

  select *
    into previous_rate
    from public.transport_crew_wage_rates
    where transport_crew_wage_rates.factory_id = p_factory_id
      and transport_crew_wage_rates.transport_crew_id = p_transport_crew_id
    order by transport_crew_wage_rates.effective_from desc,
      transport_crew_wage_rates.id desc
    limit 1
    for update;

  if found then
    if p_effective_from = previous_rate.effective_from then
      raise exception 'A transport crew wage rate already starts on %.',
        previous_rate.effective_from
        using errcode = 'P0001';
    end if;

    if p_effective_from < previous_rate.effective_from then
      raise exception 'Backdated transport crew wage rates are not allowed; effective_from must be later than the latest rate start (%).',
        previous_rate.effective_from
        using errcode = 'P0001';
    end if;

    if previous_rate.effective_to is not null then
      raise exception 'Latest transport crew wage rate must be open-ended before adding a replacement.'
        using errcode = 'P0001';
    end if;

    update public.transport_crew_wage_rates
    set effective_to = p_effective_from - 1
    where id = previous_rate.id;
  end if;

  insert into public.transport_crew_wage_rates (
    factory_id,
    transport_crew_id,
    rate_per_paya,
    effective_from,
    effective_to
  )
  values (
    p_factory_id,
    p_transport_crew_id,
    p_rate_per_paya,
    p_effective_from,
    null
  )
  returning * into new_rate;

  return new_rate;
end;
$$;

revoke all on function public.create_transport_crew_wage_rate(uuid, uuid, date, numeric)
  from public;
revoke all on function public.create_transport_crew_wage_rate(uuid, uuid, date, numeric)
  from anon;
grant execute on function public.create_transport_crew_wage_rate(uuid, uuid, date, numeric)
  to authenticated;
