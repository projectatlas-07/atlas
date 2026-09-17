-- Production rate simplification: direct effective-dated labourer rates.

alter table public.labourers
  add column production_origin_label text,
  add constraint labourers_production_origin_label_check
    check (
      production_origin_label is null
      or (
        production_origin_label = btrim(production_origin_label)
        and production_origin_label <> ''
        and char_length(production_origin_label) <= 100
        and production_origin_label !~ '[[:cntrl:]]'
      )
    );

comment on column public.labourers.production_origin_label is
  'Optional Production-only identification label. It never affects rate resolution, eligibility, or accounting.';

-- Keep a small cutover only: active labourers without a direct rate on the
-- cutover date inherit the crew rate that resolves that day. Existing direct
-- rows remain as-is; crew history and assignments stay available as Legacy data.
insert into public.production_wage_rates (
  factory_id,
  production_crew_id,
  labourer_id,
  rate_per_1000_bricks,
  effective_from,
  effective_to
)
select
  labourers.factory_id,
  null,
  labourers.id,
  crew_rates.rate_per_1000_bricks,
  date '2026-09-15',
  (
    select min(future_direct.effective_from) - 1
    from public.production_wage_rates as future_direct
    where future_direct.factory_id = labourers.factory_id
      and future_direct.labourer_id = labourers.id
      and future_direct.production_crew_id is null
      and future_direct.effective_from > date '2026-09-15'
  )
from public.labourers
join public.production_crew_assignments as assignments
  on assignments.factory_id = labourers.factory_id
  and assignments.labourer_id = labourers.id
  and assignments.effective_from <= date '2026-09-15'
  and (assignments.effective_to is null or assignments.effective_to >= date '2026-09-15')
join public.production_wage_rates as crew_rates
  on crew_rates.factory_id = assignments.factory_id
  and crew_rates.production_crew_id = assignments.production_crew_id
  and crew_rates.labourer_id is null
  and crew_rates.effective_from <= date '2026-09-15'
  and (crew_rates.effective_to is null or crew_rates.effective_to >= date '2026-09-15')
where labourers.is_active = true
  and not exists (
    select 1
    from public.production_wage_rates as direct_rates
    where direct_rates.factory_id = labourers.factory_id
      and direct_rates.labourer_id = labourers.id
      and direct_rates.production_crew_id is null
      and direct_rates.effective_from <= date '2026-09-15'
      and (direct_rates.effective_to is null or direct_rates.effective_to >= date '2026-09-15')
  );

create or replace function public.set_production_labourer_rates(
  p_factory_id uuid,
  p_labourer_ids uuid[],
  p_rate_per_1000_bricks numeric,
  p_effective_from date
)
returns setof public.production_wage_rates
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  selected_labourer_id uuid;
  previous_rate public.production_wage_rates%rowtype;
  next_rate public.production_wage_rates%rowtype;
  new_rate public.production_wage_rates%rowtype;
  previous_rate_found boolean;
  next_rate_found boolean;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;

  if p_labourer_ids is null or cardinality(p_labourer_ids) = 0
    or cardinality(p_labourer_ids) > 500
    or array_position(p_labourer_ids, null) is not null
    or (select count(distinct selected.labourer_id)
        from unnest(p_labourer_ids) as selected(labourer_id))
      <> cardinality(p_labourer_ids) then
    raise exception 'Choose between 1 and 500 distinct labourers.' using errcode = '22023';
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
  if (
    select count(*)
    from public.labourers
    where labourers.factory_id = p_factory_id
      and labourers.id = any(p_labourer_ids)
      and labourers.is_active = true
  ) <> cardinality(p_labourer_ids) then
    raise exception 'Every selected labourer must be active and belong to this factory.' using errcode = '42501';
  end if;

  for selected_labourer_id in
    select selected.labourer_id
    from unnest(p_labourer_ids) as selected(labourer_id)
    order by selected.labourer_id
  loop
    perform pg_advisory_xact_lock(
      hashtext(p_factory_id::text),
      hashtext('labourer_production_wage_rate:' || selected_labourer_id::text)
    );

    if exists (
      select 1
      from public.production_wage_rates
      where production_wage_rates.factory_id = p_factory_id
        and production_wage_rates.labourer_id = selected_labourer_id
        and production_wage_rates.production_crew_id is null
        and production_wage_rates.effective_from = p_effective_from
    ) then
      raise exception 'A Production rate already starts for this labourer on %.', p_effective_from
        using errcode = 'P2408';
    end if;

    select * into previous_rate
    from public.production_wage_rates
    where production_wage_rates.factory_id = p_factory_id
      and production_wage_rates.labourer_id = selected_labourer_id
      and production_wage_rates.production_crew_id is null
      and production_wage_rates.effective_from < p_effective_from
    order by production_wage_rates.effective_from desc, production_wage_rates.id desc
    limit 1
    for update;
    previous_rate_found := found;

    select * into next_rate
    from public.production_wage_rates
    where production_wage_rates.factory_id = p_factory_id
      and production_wage_rates.labourer_id = selected_labourer_id
      and production_wage_rates.production_crew_id is null
      and production_wage_rates.effective_from > p_effective_from
    order by production_wage_rates.effective_from, production_wage_rates.id
    limit 1
    for update;
    next_rate_found := found;

    if previous_rate_found
      and (previous_rate.effective_to is null or previous_rate.effective_to >= p_effective_from) then
      update public.production_wage_rates
      set effective_to = p_effective_from - 1
      where id = previous_rate.id and factory_id = p_factory_id;
    end if;

    insert into public.production_wage_rates (
      factory_id,
      production_crew_id,
      labourer_id,
      rate_per_1000_bricks,
      effective_from,
      effective_to
    ) values (
      p_factory_id,
      null,
      selected_labourer_id,
      p_rate_per_1000_bricks,
      p_effective_from,
      case when next_rate_found then next_rate.effective_from - 1 else null end
    )
    returning * into new_rate;

    return next new_rate;
  end loop;
end;
$$;

create or replace function public.create_labourer_production_wage_rate_override(
  p_factory_id uuid,
  p_labourer_id uuid,
  p_rate_per_1000_bricks numeric,
  p_effective_from date
)
returns public.production_wage_rates
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  new_rate public.production_wage_rates%rowtype;
begin
  select * into new_rate
  from public.set_production_labourer_rates(
    p_factory_id,
    array[p_labourer_id],
    p_rate_per_1000_bricks,
    p_effective_from
  );
  return new_rate;
end;
$$;

create or replace function public.set_production_labourer_origin(
  p_factory_id uuid,
  p_labourer_id uuid,
  p_origin_label text
)
returns public.labourers
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_origin text := nullif(btrim(coalesce(p_origin_label, '')), '');
  saved_labourer public.labourers%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;
  if p_labourer_id is null or not exists (
    select 1 from public.labourers
    where labourers.id = p_labourer_id and labourers.factory_id = p_factory_id
  ) then
    raise exception 'Labourer does not belong to this factory.' using errcode = '42501';
  end if;
  if normalized_origin is not null and (
    char_length(normalized_origin) > 100 or normalized_origin ~ '[[:cntrl:]]'
  ) then
    raise exception 'Origin must be at most 100 characters and stay on one line.' using errcode = '22023';
  end if;

  update public.labourers
  set production_origin_label = normalized_origin
  where id = p_labourer_id and factory_id = p_factory_id
  returning * into saved_labourer;
  return saved_labourer;
end;
$$;

create or replace function public.resolve_production_wage_rate(
  p_factory_id uuid,
  p_labourer_id uuid,
  p_work_date date
)
returns table (
  production_wage_rate_id uuid,
  rate_per_1000_bricks numeric,
  rate_source text,
  production_crew_id uuid
)
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
declare
  matching_rate_count integer;
  matched_rate public.production_wage_rates%rowtype;
begin
  if p_factory_id is null or p_labourer_id is null
    or p_work_date is null or not isfinite(p_work_date) then
    raise exception 'Factory, labourer, and finite work date are required.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.labourers
    where labourers.id = p_labourer_id and labourers.factory_id = p_factory_id
  ) then
    raise exception 'Labourer does not belong to this factory.' using errcode = 'P2401';
  end if;

  select count(*)
  into matching_rate_count
  from public.production_wage_rates
  where production_wage_rates.factory_id = p_factory_id
    and production_wage_rates.labourer_id = p_labourer_id
    and production_wage_rates.production_crew_id is null
    and production_wage_rates.effective_from <= p_work_date
    and (production_wage_rates.effective_to is null or production_wage_rates.effective_to >= p_work_date);

  if matching_rate_count = 0 then
    raise exception 'Rate not set for labourer % on %.', p_labourer_id, p_work_date
      using errcode = 'P2402';
  end if;
  if matching_rate_count > 1 then
    raise exception 'Multiple direct Production rates apply to labourer % on %.', p_labourer_id, p_work_date
      using errcode = 'P2404';
  end if;

  select * into matched_rate
  from public.production_wage_rates
  where production_wage_rates.factory_id = p_factory_id
    and production_wage_rates.labourer_id = p_labourer_id
    and production_wage_rates.production_crew_id is null
    and production_wage_rates.effective_from <= p_work_date
    and (production_wage_rates.effective_to is null or production_wage_rates.effective_to >= p_work_date);

  production_wage_rate_id := matched_rate.id;
  rate_per_1000_bricks := matched_rate.rate_per_1000_bricks;
  -- Keep the internal compatibility label accepted by immutable weekly detail rows.
  rate_source := 'individual_override';
  production_crew_id := null;
  return next;
end;
$$;

revoke all on function public.set_production_labourer_rates(uuid, uuid[], numeric, date)
  from public, anon, authenticated;
grant execute on function public.set_production_labourer_rates(uuid, uuid[], numeric, date)
  to authenticated;
revoke all on function public.set_production_labourer_origin(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.set_production_labourer_origin(uuid, uuid, text)
  to authenticated;

revoke all on function public.create_labourer_production_wage_rate_override(uuid, uuid, numeric, date)
  from public, anon, authenticated;
grant execute on function public.create_labourer_production_wage_rate_override(uuid, uuid, numeric, date)
  to authenticated;

revoke all on function public.resolve_production_wage_rate(uuid, uuid, date)
  from public, anon, authenticated;

comment on function public.set_production_labourer_rates(uuid, uuid[], numeric, date) is
  'Atomically adds one direct effective-dated Production rate for each selected active labourer, including safe backdated interval insertion.';
comment on function public.set_production_labourer_origin(uuid, uuid, text) is
  'Sets an optional normalized Production origin label with no wage or eligibility meaning.';
comment on function public.resolve_production_wage_rate(uuid, uuid, date) is
  'Private direct-labourer Production rate resolver. Missing dates fail explicitly; Production crews are not consulted.';
