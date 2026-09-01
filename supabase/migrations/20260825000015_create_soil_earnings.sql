-- Atlas Soil Supply T3: immutable trolley-derived financial earnings.

alter table public.soil_daily_trolley_entries
  add constraint soil_daily_trolley_entries_earning_source_identity_key
  unique (id, factory_id, soil_worker_id, work_date);

create table public.soil_earnings (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  soil_worker_id uuid not null,
  soil_daily_trolley_entry_id uuid not null,
  work_date date not null,
  event_type text not null,
  event_sequence integer not null,
  amount numeric not null,
  trolley_quantity_snapshot numeric not null,
  rate_per_trolley_snapshot numeric not null,
  previous_base_amount_snapshot numeric not null,
  source_base_amount_snapshot numeric not null,
  created_at timestamptz not null default now(),
  constraint soil_earnings_id_factory_key unique (id, factory_id),
  constraint soil_earnings_work_date_check check (isfinite(work_date)),
  constraint soil_earnings_event_type_check
    check (event_type in ('BASE', 'CORRECTION')),
  constraint soil_earnings_source_sequence_key
    unique (soil_daily_trolley_entry_id, event_sequence),
  constraint soil_earnings_event_sequence_check check (
    (event_type = 'BASE' and event_sequence = 1)
    or (event_type = 'CORRECTION' and event_sequence > 1)
  ),
  constraint soil_earnings_amount_check check (
    amount <> 0
    and amount <> 'NaN'::numeric
    and amount <> 'Infinity'::numeric
    and amount <> '-Infinity'::numeric
  ),
  constraint soil_earnings_quantity_snapshot_check check (
    trolley_quantity_snapshot > 0
    and trolley_quantity_snapshot <> 'NaN'::numeric
    and trolley_quantity_snapshot <> 'Infinity'::numeric
    and scale(trolley_quantity_snapshot) <= 3
    and trolley_quantity_snapshot < 1000000000
  ),
  constraint soil_earnings_rate_snapshot_check check (
    rate_per_trolley_snapshot > 0
    and rate_per_trolley_snapshot <> 'NaN'::numeric
    and rate_per_trolley_snapshot <> 'Infinity'::numeric
  ),
  constraint soil_earnings_previous_base_snapshot_check check (
    previous_base_amount_snapshot >= 0
    and previous_base_amount_snapshot <> 'NaN'::numeric
    and previous_base_amount_snapshot <> 'Infinity'::numeric
  ),
  constraint soil_earnings_source_base_snapshot_check check (
    source_base_amount_snapshot > 0
    and source_base_amount_snapshot <> 'NaN'::numeric
    and source_base_amount_snapshot <> 'Infinity'::numeric
    and source_base_amount_snapshot = trolley_quantity_snapshot * rate_per_trolley_snapshot
  ),
  constraint soil_earnings_event_math_check check (
    amount = source_base_amount_snapshot - previous_base_amount_snapshot
    and (
      (event_type = 'BASE'
        and previous_base_amount_snapshot = 0
        and amount = source_base_amount_snapshot)
      or
      (event_type = 'CORRECTION'
        and previous_base_amount_snapshot > 0
        and amount <> 0)
    )
  ),
  constraint soil_earnings_worker_factory_fkey
    foreign key (soil_worker_id, factory_id)
    references public.soil_workers (id, factory_id) on delete restrict,
  constraint soil_earnings_source_identity_fkey
    foreign key (
      soil_daily_trolley_entry_id,
      factory_id,
      soil_worker_id,
      work_date
    )
    references public.soil_daily_trolley_entries (
      id,
      factory_id,
      soil_worker_id,
      work_date
    ) on delete restrict
);

create unique index soil_earnings_one_base_per_daily_entry_idx
  on public.soil_earnings (soil_daily_trolley_entry_id)
  where event_type = 'BASE';

create index soil_earnings_factory_worker_history_idx
  on public.soil_earnings (
    factory_id,
    soil_worker_id,
    work_date desc,
    soil_daily_trolley_entry_id,
    event_sequence desc,
    id desc
  );

create index soil_earnings_factory_source_history_idx
  on public.soil_earnings (
    factory_id,
    soil_daily_trolley_entry_id,
    event_sequence,
    id
  );

alter table public.soil_earnings enable row level security;

revoke all on public.soil_earnings from anon, authenticated;
grant select on public.soil_earnings to authenticated;

create policy "Authenticated users can read their factory Soil earnings"
  on public.soil_earnings
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = soil_earnings.factory_id
        and factory_users.is_active = true
    )
  );

create or replace function public.prevent_soil_earning_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'Soil earning history is immutable.'
    using errcode = 'P2701';
  return null;
end;
$$;

create trigger soil_earnings_prevent_update_delete
before update or delete on public.soil_earnings
for each row execute function public.prevent_soil_earning_mutation();

revoke all on function public.prevent_soil_earning_mutation() from public, anon, authenticated;

-- Backfill every T2 operational row from its stored snapshots, never current rates.
insert into public.soil_earnings (
  factory_id,
  soil_worker_id,
  soil_daily_trolley_entry_id,
  work_date,
  event_type,
  event_sequence,
  amount,
  trolley_quantity_snapshot,
  rate_per_trolley_snapshot,
  previous_base_amount_snapshot,
  source_base_amount_snapshot,
  created_at
)
select
  daily.factory_id,
  daily.soil_worker_id,
  daily.id,
  daily.work_date,
  'BASE',
  1,
  daily.base_amount_snapshot,
  daily.trolley_quantity,
  daily.rate_per_trolley_snapshot,
  0,
  daily.base_amount_snapshot,
  daily.created_at
from public.soil_daily_trolley_entries as daily
where not exists (
  select 1
  from public.soil_earnings as existing_base
  where existing_base.soil_daily_trolley_entry_id = daily.id
    and existing_base.event_type = 'BASE'
)
on conflict (soil_daily_trolley_entry_id) where event_type = 'BASE' do nothing;

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
  saved_entry public.soil_daily_trolley_entries%rowtype;
  resolved_rate public.soil_worker_trolley_rates%rowtype;
  previous_base_amount numeric;
  new_base_amount numeric;
  correction_amount numeric;
  existing_base_event_count bigint;
  existing_ledger_total numeric;
  next_event_sequence integer;
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
      select
        count(*) filter (where soil_earnings.event_type = 'BASE'),
        coalesce(sum(soil_earnings.amount), 0),
        coalesce(max(soil_earnings.event_sequence), 0) + 1
      into existing_base_event_count, existing_ledger_total, next_event_sequence
      from public.soil_earnings
      where soil_earnings.factory_id = p_factory_id
        and soil_earnings.soil_daily_trolley_entry_id = existing_entry.id;

      if existing_base_event_count <> 1
        or existing_ledger_total <> existing_entry.base_amount_snapshot then
        raise exception 'Soil earning history does not reconcile with daily entry %.',
          existing_entry.id
          using errcode = 'P2702';
      end if;

      if existing_entry.trolley_quantity is distinct from supplied_quantity then
        previous_base_amount := existing_entry.base_amount_snapshot;
        new_base_amount := supplied_quantity * existing_entry.rate_per_trolley_snapshot;
        correction_amount := new_base_amount - previous_base_amount;

        update public.soil_daily_trolley_entries
        set trolley_quantity = supplied_quantity,
            base_amount_snapshot = new_base_amount
        where id = existing_entry.id
          and factory_id = p_factory_id
        returning * into saved_entry;

        insert into public.soil_earnings (
          factory_id,
          soil_worker_id,
          soil_daily_trolley_entry_id,
          work_date,
          event_type,
          event_sequence,
          amount,
          trolley_quantity_snapshot,
          rate_per_trolley_snapshot,
          previous_base_amount_snapshot,
          source_base_amount_snapshot
        ) values (
          p_factory_id,
          supplied_worker_id,
          saved_entry.id,
          p_work_date,
          'CORRECTION',
          next_event_sequence,
          correction_amount,
          saved_entry.trolley_quantity,
          saved_entry.rate_per_trolley_snapshot,
          previous_base_amount,
          saved_entry.base_amount_snapshot
        );
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
      )
      returning * into saved_entry;

      insert into public.soil_earnings (
        factory_id,
        soil_worker_id,
        soil_daily_trolley_entry_id,
        work_date,
        event_type,
        event_sequence,
        amount,
        trolley_quantity_snapshot,
        rate_per_trolley_snapshot,
        previous_base_amount_snapshot,
        source_base_amount_snapshot
      ) values (
        p_factory_id,
        supplied_worker_id,
        saved_entry.id,
        p_work_date,
        'BASE',
        1,
        saved_entry.base_amount_snapshot,
        saved_entry.trolley_quantity,
        saved_entry.rate_per_trolley_snapshot,
        0,
        saved_entry.base_amount_snapshot
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

revoke all on function public.save_soil_daily_trolley_entries(uuid, date, jsonb)
  from public, anon;
grant execute on function public.save_soil_daily_trolley_entries(uuid, date, jsonb)
  to authenticated;

create or replace function public.get_soil_total_earned(
  p_factory_id uuid,
  p_soil_worker_id uuid
)
returns table (total_earned numeric)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
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

  return query
  select coalesce(sum(soil_earnings.amount), 0)
  from public.soil_earnings
  where soil_earnings.factory_id = p_factory_id
    and soil_earnings.soil_worker_id = p_soil_worker_id;
end;
$$;

revoke all on function public.get_soil_total_earned(uuid, uuid)
  from public, anon;
grant execute on function public.get_soil_total_earned(uuid, uuid)
  to authenticated;

comment on table public.soil_earnings is
  'Immutable T3 Soil earnings ledger. BASE and CORRECTION events are generated transactionally from daily trolley saves.';
