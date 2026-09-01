-- Atlas Soil Supply T2: daily operational trolley recording with historical snapshots.

alter table public.soil_worker_trolley_rates
  add constraint soil_worker_trolley_rates_snapshot_identity_key
  unique (id, factory_id, soil_worker_id);

create table public.soil_daily_trolley_entries (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  soil_worker_id uuid not null,
  work_date date not null,
  trolley_quantity numeric not null,
  soil_worker_trolley_rate_id uuid not null,
  rate_per_trolley_snapshot numeric not null,
  base_amount_snapshot numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint soil_daily_trolley_entries_id_factory_key
    unique (id, factory_id),
  constraint soil_daily_trolley_entries_worker_date_key
    unique (factory_id, soil_worker_id, work_date),
  constraint soil_daily_trolley_entries_work_date_check
    check (isfinite(work_date)),
  constraint soil_daily_trolley_entries_quantity_check check (
    trolley_quantity > 0
    and trolley_quantity <> 'NaN'::numeric
    and trolley_quantity <> 'Infinity'::numeric
    and scale(trolley_quantity) <= 3
    and trolley_quantity < 1000000000
  ),
  constraint soil_daily_trolley_entries_rate_snapshot_check check (
    rate_per_trolley_snapshot > 0
    and rate_per_trolley_snapshot <> 'NaN'::numeric
    and rate_per_trolley_snapshot <> 'Infinity'::numeric
  ),
  constraint soil_daily_trolley_entries_base_snapshot_check check (
    base_amount_snapshot > 0
    and base_amount_snapshot <> 'NaN'::numeric
    and base_amount_snapshot <> 'Infinity'::numeric
    and base_amount_snapshot = trolley_quantity * rate_per_trolley_snapshot
  ),
  constraint soil_daily_trolley_entries_worker_factory_fkey
    foreign key (soil_worker_id, factory_id)
    references public.soil_workers (id, factory_id) on delete restrict,
  constraint soil_daily_trolley_entries_rate_identity_fkey
    foreign key (soil_worker_trolley_rate_id, factory_id, soil_worker_id)
    references public.soil_worker_trolley_rates (id, factory_id, soil_worker_id)
    on delete restrict
);

create index soil_daily_trolley_entries_factory_date_worker_idx
  on public.soil_daily_trolley_entries (
    factory_id,
    work_date desc,
    soil_worker_id
  );

create trigger soil_daily_trolley_entries_set_updated_at
before update on public.soil_daily_trolley_entries
for each row execute function public.set_updated_at();

alter table public.soil_daily_trolley_entries enable row level security;

revoke all on public.soil_daily_trolley_entries from anon, authenticated;
grant select on public.soil_daily_trolley_entries to authenticated;

create policy "Authenticated users can read their factory Soil daily trolley entries"
  on public.soil_daily_trolley_entries
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = soil_daily_trolley_entries.factory_id
        and factory_users.is_active = true
    )
  );

create or replace function public.save_soil_daily_trolley_entries(
  p_factory_id uuid,
  p_work_date date,
  p_entries jsonb
)
returns setof public.soil_daily_trolley_entries
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  supplied_entry jsonb;
  supplied_worker_id uuid;
  supplied_quantity numeric;
  supplied_worker_ids uuid[] := '{}'::uuid[];
  supplied_quantities numeric[] := '{}'::numeric[];
  entry_position integer;
  existing_entry public.soil_daily_trolley_entries%rowtype;
  resolved_rate public.soil_worker_trolley_rates%rowtype;
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

  if p_work_date is null or not isfinite(p_work_date) then
    raise exception 'work_date must be a finite calendar date.'
      using errcode = '22023';
  end if;

  if p_entries is null
    or jsonb_typeof(p_entries) <> 'array'
    or jsonb_array_length(p_entries) = 0 then
    raise exception 'At least one Soil trolley entry is required.'
      using errcode = '22023';
  end if;

  for supplied_entry in
    select payload.value
    from jsonb_array_elements(p_entries) as payload(value)
  loop
    if jsonb_typeof(supplied_entry) <> 'object'
      or jsonb_typeof(supplied_entry -> 'soil_worker_id') <> 'string'
      or jsonb_typeof(supplied_entry -> 'trolley_quantity') <> 'number' then
      raise exception 'Each Soil trolley entry requires a worker UUID and numeric quantity.'
        using errcode = '22023';
    end if;

    begin
      supplied_worker_id := (supplied_entry ->> 'soil_worker_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'Each Soil trolley entry requires a valid worker UUID.'
        using errcode = '22023';
    end;

    supplied_quantity := (supplied_entry ->> 'trolley_quantity')::numeric;

    if supplied_quantity <= 0
      or supplied_quantity = 'NaN'::numeric
      or supplied_quantity = 'Infinity'::numeric
      or scale(supplied_quantity) > 3
      or supplied_quantity >= 1000000000 then
      raise exception 'trolley_quantity must be positive, below 1000000000, and use at most three decimal places.'
        using errcode = '22023';
    end if;

    if array_position(supplied_worker_ids, supplied_worker_id) is not null then
      raise exception 'Soil worker IDs cannot contain duplicates.'
        using errcode = '22023';
    end if;

    supplied_worker_ids := array_append(supplied_worker_ids, supplied_worker_id);
    supplied_quantities := array_append(supplied_quantities, supplied_quantity);
  end loop;

  if exists (
    select 1
    from unnest(supplied_worker_ids) as supplied_workers(worker_id)
    where not exists (
      select 1
      from public.soil_workers
      where soil_workers.id = supplied_workers.worker_id
        and soil_workers.factory_id = p_factory_id
    )
  ) then
    raise exception 'One or more Soil workers do not belong to this factory.'
      using errcode = 'P2602';
  end if;

  -- Match the T1 rate-writer lock before resolving new snapshots.
  for supplied_worker_id in
    select worker_id
    from unnest(supplied_worker_ids) as workers(worker_id)
    order by worker_id
  loop
    perform pg_advisory_xact_lock(
      hashtext('soil_worker_trolley_rate'),
      hashtext(supplied_worker_id::text)
    );
  end loop;

  -- Serialize worker/date upserts in a deterministic order across batches.
  for supplied_worker_id in
    select worker_id
    from unnest(supplied_worker_ids) as workers(worker_id)
    order by worker_id
  loop
    perform pg_advisory_xact_lock(
      hashtext('soil_daily_trolley_entry'),
      hashtext(supplied_worker_id::text || ':' || p_work_date::text)
    );
  end loop;

  for entry_position in 1..cardinality(supplied_worker_ids)
  loop
    supplied_worker_id := supplied_worker_ids[entry_position];
    supplied_quantity := supplied_quantities[entry_position];

    select *
      into existing_entry
      from public.soil_daily_trolley_entries
      where soil_daily_trolley_entries.factory_id = p_factory_id
        and soil_daily_trolley_entries.soil_worker_id = supplied_worker_id
        and soil_daily_trolley_entries.work_date = p_work_date
      for update;

    if found then
      if existing_entry.trolley_quantity is distinct from supplied_quantity then
        update public.soil_daily_trolley_entries
        set trolley_quantity = supplied_quantity,
            base_amount_snapshot = supplied_quantity * existing_entry.rate_per_trolley_snapshot
        where id = existing_entry.id
          and factory_id = p_factory_id;
      end if;
    else
      select *
        into resolved_rate
        from public.resolve_soil_worker_trolley_rate(
          p_factory_id,
          supplied_worker_id,
          p_work_date
        );

      insert into public.soil_daily_trolley_entries (
        factory_id,
        soil_worker_id,
        work_date,
        trolley_quantity,
        soil_worker_trolley_rate_id,
        rate_per_trolley_snapshot,
        base_amount_snapshot
      ) values (
        p_factory_id,
        supplied_worker_id,
        p_work_date,
        supplied_quantity,
        resolved_rate.id,
        resolved_rate.rate_per_trolley,
        supplied_quantity * resolved_rate.rate_per_trolley
      );
    end if;
  end loop;

  return query
  select entries.*
  from public.soil_daily_trolley_entries as entries
  where entries.factory_id = p_factory_id
    and entries.work_date = p_work_date
    and entries.soil_worker_id = any(supplied_worker_ids)
  order by entries.soil_worker_id, entries.id;
end;
$$;

revoke all on function public.save_soil_daily_trolley_entries(
  uuid, date, jsonb
) from public, anon;
grant execute on function public.save_soil_daily_trolley_entries(
  uuid, date, jsonb
) to authenticated;

comment on table public.soil_daily_trolley_entries is
  'T2 operational Soil trolley records. Base amounts are historical snapshots, not the T3 authoritative earnings ledger.';
