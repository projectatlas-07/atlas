-- Atlas Sales correction C2: factory Vehicle master and immutable-per-save
-- Challan delivery-wage snapshots.

begin;

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  vehicle_number text not null,
  normalized_vehicle_number text not null,
  delivery_wage_tracking_enabled boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vehicles_id_factory_key unique (id, factory_id),
  constraint vehicles_factory_normalized_number_key
    unique (factory_id, normalized_vehicle_number),
  constraint vehicles_vehicle_number_check check (
    vehicle_number <> ''
    and vehicle_number = upper(vehicle_number)
    and vehicle_number = btrim(vehicle_number)
    and vehicle_number = regexp_replace(vehicle_number, '[[:space:]]+', ' ', 'g')
    and vehicle_number !~ '[[:cntrl:]]'
    and normalized_vehicle_number = upper(
      regexp_replace(vehicle_number, '[[:space:]]+', '', 'g')
    )
  ),
  constraint vehicles_normalized_vehicle_number_check check (
    normalized_vehicle_number <> ''
    and char_length(normalized_vehicle_number) <= 32
    and normalized_vehicle_number ~ '^[A-Z0-9-]+$'
  )
);

create index vehicles_factory_active_number_idx
  on public.vehicles(factory_id, is_active, normalized_vehicle_number, id);

create trigger vehicles_set_updated_at
before update on public.vehicles
for each row execute function public.set_updated_at();

alter table public.vehicles enable row level security;
revoke all on public.vehicles from anon, authenticated;
grant select on public.vehicles to authenticated;

create policy "Authenticated users can read their factory Vehicles"
  on public.vehicles
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = vehicles.factory_id
        and factory_users.is_active = true
    )
  );

-- Pre-C2 rows retain their legacy text/rate. C2 rows use nullable compatibility
-- mirrors because a real Challan may have no Vehicle and no internal trip wage.
alter table public.challans
  alter column vehicle_number drop not null,
  alter column tractor_labour_rate_snapshot drop not null,
  drop constraint challans_vehicle_number_check,
  drop constraint challans_tractor_labour_rate_check;

alter table public.challans
  add constraint challans_vehicle_number_check check (
    vehicle_number is null
    or (
      vehicle_number <> ''
      and vehicle_number = upper(vehicle_number)
      and vehicle_number = btrim(vehicle_number)
      and vehicle_number = regexp_replace(vehicle_number, '[[:space:]]+', ' ', 'g')
      and vehicle_number !~ '[[:cntrl:]]'
      and upper(regexp_replace(vehicle_number, '[[:space:]]+', '', 'g'))
        ~ '^[A-Z0-9-]+$'
    )
  ),
  add constraint challans_tractor_labour_rate_check check (
    tractor_labour_rate_snapshot is null
    or (
      tractor_labour_rate_snapshot >= 0
      and tractor_labour_rate_snapshot < 1000000000
      and tractor_labour_rate_snapshot <> 'NaN'::numeric
      and tractor_labour_rate_snapshot <> 'Infinity'::numeric
      and tractor_labour_rate_snapshot = round(tractor_labour_rate_snapshot, 2)
    )
  ),
  add column vehicle_id uuid,
  add column vehicle_number_snapshot text,
  add column delivery_wage_applicable_snapshot boolean not null default false,
  add column trip_labour_wage numeric(14, 2),
  add constraint challans_vehicle_factory_fkey
    foreign key (vehicle_id, factory_id)
    references public.vehicles(id, factory_id) on delete restrict,
  add constraint challans_vehicle_number_snapshot_check check (
    vehicle_number_snapshot is null
    or (
      vehicle_number_snapshot <> ''
      and vehicle_number_snapshot = upper(vehicle_number_snapshot)
      and vehicle_number_snapshot = btrim(vehicle_number_snapshot)
      and vehicle_number_snapshot = regexp_replace(
        vehicle_number_snapshot, '[[:space:]]+', ' ', 'g'
      )
      and vehicle_number_snapshot !~ '[[:cntrl:]]'
      and upper(regexp_replace(
        vehicle_number_snapshot, '[[:space:]]+', '', 'g'
      )) ~ '^[A-Z0-9-]+$'
    )
  ),
  add constraint challans_vehicle_wage_snapshot_check check (
    (
      vehicle_id is null
      and vehicle_number_snapshot is null
      and delivery_wage_applicable_snapshot = false
      and trip_labour_wage is null
    )
    or (
      vehicle_id is not null
      and vehicle_number_snapshot is not null
      and delivery_wage_applicable_snapshot = false
      and trip_labour_wage is null
    )
    or (
      vehicle_id is not null
      and vehicle_number_snapshot is not null
      and delivery_wage_applicable_snapshot = true
      and trip_labour_wage > 0
      and trip_labour_wage < 1000000000
      and trip_labour_wage <> 'NaN'::numeric
      and trip_labour_wage <> 'Infinity'::numeric
      and trip_labour_wage = round(trip_labour_wage, 2)
    )
  );

create index challans_factory_vehicle_date_idx
  on public.challans(factory_id, vehicle_id, challan_date desc, challan_number desc)
  where vehicle_id is not null;

create or replace function public.find_or_create_vehicle(
  p_factory_id uuid,
  p_vehicle_number text,
  p_delivery_wage_tracking_enabled boolean default false
)
returns public.vehicles
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  display_number text := upper(btrim(regexp_replace(
    coalesce(p_vehicle_number, ''), '[[:space:]]+', ' ', 'g'
  )));
  normalized_number text := upper(regexp_replace(
    btrim(coalesce(p_vehicle_number, '')), '[[:space:]]+', '', 'g'
  ));
  vehicle_row public.vehicles%rowtype;
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
  if p_delivery_wage_tracking_enabled is null then
    raise exception 'Delivery Wage Tracking must be ON or OFF.' using errcode = '22023';
  end if;
  if normalized_number = ''
    or char_length(normalized_number) > 32
    or normalized_number !~ '^[A-Z0-9-]+$' then
    raise exception 'Vehicle number must contain only letters, numbers, spaces, or hyphens.'
      using errcode = '22023';
  end if;

  insert into public.vehicles(
    factory_id,
    vehicle_number,
    normalized_vehicle_number,
    delivery_wage_tracking_enabled
  ) values (
    p_factory_id,
    display_number,
    normalized_number,
    p_delivery_wage_tracking_enabled
  )
  on conflict (factory_id, normalized_vehicle_number) do nothing
  returning * into vehicle_row;

  if vehicle_row.id is null then
    select * into vehicle_row
    from public.vehicles
    where factory_id = p_factory_id
      and normalized_vehicle_number = normalized_number;
  end if;

  return vehicle_row;
end;
$$;

create or replace function public.set_vehicle_delivery_wage_tracking(
  p_factory_id uuid,
  p_vehicle_id uuid,
  p_enabled boolean
)
returns public.vehicles
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  vehicle_row public.vehicles%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'Delivery Wage Tracking must be ON or OFF.' using errcode = '22023';
  end if;

  select * into vehicle_row
  from public.vehicles
  where id = p_vehicle_id and factory_id = p_factory_id
  for update;
  if not found then
    raise exception 'Vehicle does not belong to this factory.' using errcode = 'P3102';
  end if;

  update public.vehicles
  set delivery_wage_tracking_enabled = p_enabled
  where id = p_vehicle_id and factory_id = p_factory_id
  returning * into vehicle_row;
  return vehicle_row;
end;
$$;

create or replace function public.archive_vehicle(
  p_factory_id uuid,
  p_vehicle_id uuid
)
returns public.vehicles
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  vehicle_row public.vehicles%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;

  select * into vehicle_row
  from public.vehicles
  where id = p_vehicle_id and factory_id = p_factory_id
  for update;
  if not found then
    raise exception 'Vehicle does not belong to this factory.' using errcode = 'P3102';
  end if;
  if not vehicle_row.is_active then
    raise exception 'This Vehicle is already archived.' using errcode = 'P3103';
  end if;

  update public.vehicles
  set is_active = false
  where id = p_vehicle_id and factory_id = p_factory_id
  returning * into vehicle_row;
  return vehicle_row;
end;
$$;

create or replace function public.restore_vehicle(
  p_factory_id uuid,
  p_vehicle_id uuid
)
returns public.vehicles
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  vehicle_row public.vehicles%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;

  select * into vehicle_row
  from public.vehicles
  where id = p_vehicle_id and factory_id = p_factory_id
  for update;
  if not found then
    raise exception 'Vehicle does not belong to this factory.' using errcode = 'P3102';
  end if;
  if vehicle_row.is_active then
    raise exception 'This Vehicle is already active.' using errcode = 'P3104';
  end if;

  update public.vehicles
  set is_active = true
  where id = p_vehicle_id and factory_id = p_factory_id
  returning * into vehicle_row;
  return vehicle_row;
end;
$$;

create or replace function public.resolve_challan_vehicle_snapshot(
  p_factory_id uuid,
  p_vehicle_id uuid,
  p_trip_labour_wage numeric
)
returns table (
  snapshot_vehicle_number text,
  snapshot_delivery_wage_applicable boolean,
  snapshot_trip_labour_wage numeric
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  vehicle_row public.vehicles%rowtype;
begin
  if p_vehicle_id is null then
    return query select null::text, false, null::numeric;
    return;
  end if;

  -- The shared row lock makes create/edit serialize with configuration and
  -- lifecycle changes, so the final snapshot is always one committed state.
  select * into vehicle_row
  from public.vehicles
  where id = p_vehicle_id and factory_id = p_factory_id
  for share;
  if not found then
    raise exception 'Vehicle does not belong to this factory.' using errcode = 'P3102';
  end if;
  if not vehicle_row.is_active then
    raise exception 'Archived Vehicles cannot be selected. Restore the Vehicle first.'
      using errcode = 'P3105';
  end if;

  if vehicle_row.delivery_wage_tracking_enabled then
    if p_trip_labour_wage is null
      or p_trip_labour_wage = 'NaN'::numeric
      or p_trip_labour_wage = 'Infinity'::numeric
      or p_trip_labour_wage <= 0
      or p_trip_labour_wage >= 1000000000
      or p_trip_labour_wage <> round(p_trip_labour_wage, 2) then
      raise exception 'Trip Labour Wage must be positive and use at most two decimal places.'
        using errcode = 'P3106';
    end if;
    return query select
      vehicle_row.vehicle_number,
      true,
      p_trip_labour_wage;
  else
    return query select
      vehicle_row.vehicle_number,
      false,
      null::numeric;
  end if;
end;
$$;

create or replace function public.create_challan_with_vehicle_snapshot(
  p_factory_id uuid,
  p_challan_date date,
  p_customer_id uuid,
  p_vehicle_id uuid,
  p_trip_labour_wage numeric,
  p_items jsonb,
  p_flexible_lines jsonb
)
returns public.challans
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  factory_profile public.factories%rowtype;
  customer_profile public.customers%rowtype;
  vehicle_snapshot record;
  allocated_number bigint;
  legacy_compatible_address_snapshot text;
  new_challan public.challans%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;
  if p_challan_date is null or not isfinite(p_challan_date) then
    raise exception 'Challan date must be a finite calendar date.' using errcode = '22023';
  end if;
  if p_items is null
    or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) > 100 then
    raise exception 'Challan brick items must be an array of at most 100 items.'
      using errcode = '22023';
  end if;
  if p_flexible_lines is null
    or jsonb_typeof(p_flexible_lines) <> 'array'
    or jsonb_array_length(p_flexible_lines) > 100 then
    raise exception 'Flexible Challan lines must be an array of at most 100 lines.'
      using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) = 0
    and jsonb_array_length(p_flexible_lines) = 0 then
    raise exception 'A Challan must contain at least one meaningful document line.'
      using errcode = 'P3011';
  end if;

  select * into factory_profile
  from public.factories
  where id = p_factory_id
  for share;
  if not found
    or factory_profile.name = ''
    or factory_profile.business_description = ''
    or factory_profile.village = ''
    or factory_profile.post_office = ''
    or factory_profile.police_station = ''
    or factory_profile.district = ''
    or factory_profile.state = ''
    or factory_profile.mobile = '' then
    raise exception 'Complete the structured printable factory profile before creating a Challan.'
      using errcode = 'P3010';
  end if;

  select * into customer_profile
  from public.customers
  where id = p_customer_id and factory_id = p_factory_id;
  if not found then
    raise exception 'Customer does not belong to this factory.' using errcode = 'P3002';
  end if;

  select * into vehicle_snapshot
  from public.resolve_challan_vehicle_snapshot(
    p_factory_id, p_vehicle_id, p_trip_labour_wage
  );

  legacy_compatible_address_snapshot := coalesce(
    nullif(factory_profile.address, ''),
    format(
      'Vill. %s · P.O. %s · P.S. %s · Dist. %s · %s',
      factory_profile.village,
      factory_profile.post_office,
      factory_profile.police_station,
      factory_profile.district,
      factory_profile.state
    )
  );

  insert into public.challan_number_counters(factory_id, last_challan_number)
  values (p_factory_id, 1)
  on conflict (factory_id) do update
  set last_challan_number = challan_number_counters.last_challan_number + 1,
      updated_at = now()
  returning last_challan_number into allocated_number;

  insert into public.challans(
    factory_id, challan_number, challan_date, customer_id,
    customer_name_snapshot, customer_address_snapshot, customer_mobile_snapshot,
    company_name_snapshot, company_business_description_snapshot,
    company_address_snapshot, company_mobile_snapshot,
    company_village_snapshot, company_post_office_snapshot,
    company_police_station_snapshot, company_district_snapshot,
    company_state_snapshot,
    vehicle_number, tractor_labour_rate_snapshot,
    vehicle_id, vehicle_number_snapshot,
    delivery_wage_applicable_snapshot, trip_labour_wage
  ) values (
    p_factory_id, allocated_number, p_challan_date, p_customer_id,
    customer_profile.name, customer_profile.address, customer_profile.mobile,
    factory_profile.name, factory_profile.business_description,
    legacy_compatible_address_snapshot, factory_profile.mobile,
    factory_profile.village, factory_profile.post_office,
    factory_profile.police_station, factory_profile.district,
    factory_profile.state,
    vehicle_snapshot.snapshot_vehicle_number,
    vehicle_snapshot.snapshot_trip_labour_wage,
    p_vehicle_id,
    vehicle_snapshot.snapshot_vehicle_number,
    vehicle_snapshot.snapshot_delivery_wage_applicable,
    vehicle_snapshot.snapshot_trip_labour_wage
  ) returning * into new_challan;

  perform public.insert_challan_items(p_factory_id, new_challan.id, p_items);
  perform public.replace_challan_flexible_lines(
    p_factory_id, new_challan.id, p_flexible_lines
  );
  perform public.assert_challan_final_content(p_factory_id, new_challan.id);

  select * into new_challan
  from public.challans
  where id = new_challan.id and factory_id = p_factory_id;
  return new_challan;
end;
$$;

create or replace function public.update_challan_with_vehicle_snapshot(
  p_factory_id uuid,
  p_challan_id uuid,
  p_challan_date date,
  p_customer_id uuid,
  p_vehicle_id uuid,
  p_trip_labour_wage numeric,
  p_items jsonb,
  p_flexible_lines jsonb,
  p_replace_flexible_lines boolean
)
returns public.challans
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  existing_challan public.challans%rowtype;
  customer_profile public.customers%rowtype;
  vehicle_snapshot record;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;

  select * into existing_challan
  from public.challans
  where id = p_challan_id and factory_id = p_factory_id
  for update;
  if not found then
    raise exception 'Challan does not belong to this factory.' using errcode = 'P3003';
  end if;
  if existing_challan.is_locked then
    raise exception 'A locked Challan cannot be changed.' using errcode = 'P3005';
  end if;
  if existing_challan.status <> 'active' then
    raise exception 'A void Challan cannot be changed.' using errcode = 'P3006';
  end if;
  if p_challan_date is null or not isfinite(p_challan_date) then
    raise exception 'Challan date must be a finite calendar date.' using errcode = '22023';
  end if;
  if p_items is null
    or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) > 100 then
    raise exception 'Challan brick items must be an array of at most 100 items.'
      using errcode = '22023';
  end if;
  if p_replace_flexible_lines is null then
    raise exception 'Flexible-line replacement intent is required.' using errcode = '22023';
  end if;
  if p_replace_flexible_lines and (
    p_flexible_lines is null
    or jsonb_typeof(p_flexible_lines) <> 'array'
    or jsonb_array_length(p_flexible_lines) > 100
  ) then
    raise exception 'Flexible Challan lines must be an array of at most 100 lines.'
      using errcode = '22023';
  end if;

  select * into customer_profile
  from public.customers
  where id = p_customer_id and factory_id = p_factory_id;
  if not found then
    raise exception 'Customer does not belong to this factory.' using errcode = 'P3002';
  end if;

  select * into vehicle_snapshot
  from public.resolve_challan_vehicle_snapshot(
    p_factory_id, p_vehicle_id, p_trip_labour_wage
  );

  update public.challans
  set challan_date = p_challan_date,
      customer_id = p_customer_id,
      customer_name_snapshot = customer_profile.name,
      customer_address_snapshot = customer_profile.address,
      customer_mobile_snapshot = customer_profile.mobile,
      vehicle_number = vehicle_snapshot.snapshot_vehicle_number,
      tractor_labour_rate_snapshot = vehicle_snapshot.snapshot_trip_labour_wage,
      vehicle_id = p_vehicle_id,
      vehicle_number_snapshot = vehicle_snapshot.snapshot_vehicle_number,
      delivery_wage_applicable_snapshot =
        vehicle_snapshot.snapshot_delivery_wage_applicable,
      trip_labour_wage = vehicle_snapshot.snapshot_trip_labour_wage
  where id = p_challan_id and factory_id = p_factory_id;

  delete from public.challan_items
  where challan_id = p_challan_id and factory_id = p_factory_id;
  perform public.insert_challan_items(p_factory_id, p_challan_id, p_items);

  if p_replace_flexible_lines then
    perform public.replace_challan_flexible_lines(
      p_factory_id, p_challan_id, p_flexible_lines
    );
  end if;
  perform public.assert_challan_final_content(p_factory_id, p_challan_id);

  select * into existing_challan
  from public.challans
  where id = p_challan_id and factory_id = p_factory_id;
  return existing_challan;
end;
$$;

create or replace function public.create_challan(
  p_factory_id uuid,
  p_challan_date date,
  p_customer_id uuid,
  p_vehicle_id uuid,
  p_trip_labour_wage numeric,
  p_items jsonb,
  p_flexible_lines jsonb default '[]'::jsonb
)
returns public.challans
language sql
security definer
set search_path = pg_catalog, public
as $$
  select * from public.create_challan_with_vehicle_snapshot(
    p_factory_id, p_challan_date, p_customer_id, p_vehicle_id,
    p_trip_labour_wage, p_items, coalesce(p_flexible_lines, '[]'::jsonb)
  );
$$;

create or replace function public.update_challan(
  p_factory_id uuid,
  p_challan_id uuid,
  p_challan_date date,
  p_customer_id uuid,
  p_vehicle_id uuid,
  p_trip_labour_wage numeric,
  p_items jsonb,
  p_flexible_lines jsonb default null
)
returns public.challans
language sql
security definer
set search_path = pg_catalog, public
as $$
  select * from public.update_challan_with_vehicle_snapshot(
    p_factory_id, p_challan_id, p_challan_date, p_customer_id,
    p_vehicle_id, p_trip_labour_wage, p_items, p_flexible_lines,
    p_flexible_lines is not null
  );
$$;

revoke all on function public.find_or_create_vehicle(uuid, text, boolean)
  from public, anon;
grant execute on function public.find_or_create_vehicle(uuid, text, boolean)
  to authenticated;
revoke all on function public.set_vehicle_delivery_wage_tracking(uuid, uuid, boolean)
  from public, anon;
grant execute on function public.set_vehicle_delivery_wage_tracking(uuid, uuid, boolean)
  to authenticated;
revoke all on function public.archive_vehicle(uuid, uuid)
  from public, anon;
grant execute on function public.archive_vehicle(uuid, uuid)
  to authenticated;
revoke all on function public.restore_vehicle(uuid, uuid)
  from public, anon;
grant execute on function public.restore_vehicle(uuid, uuid)
  to authenticated;

revoke all on function public.resolve_challan_vehicle_snapshot(uuid, uuid, numeric)
  from public, anon, authenticated;
revoke all on function public.create_challan_with_vehicle_snapshot(
  uuid, date, uuid, uuid, numeric, jsonb, jsonb
) from public, anon, authenticated;
revoke all on function public.update_challan_with_vehicle_snapshot(
  uuid, uuid, date, uuid, uuid, numeric, jsonb, jsonb, boolean
) from public, anon, authenticated;

revoke all on function public.create_challan(
  uuid, date, uuid, uuid, numeric, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.create_challan(
  uuid, date, uuid, uuid, numeric, jsonb, jsonb
) to authenticated;
revoke all on function public.update_challan(
  uuid, uuid, date, uuid, uuid, numeric, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.update_challan(
  uuid, uuid, date, uuid, uuid, numeric, jsonb, jsonb
) to authenticated;

-- Retain the historical functions for old schema/test compatibility, but remove
-- authenticated execution so C2 has one authoritative new-write path.
revoke all on function public.create_challan(uuid, date, uuid, text, numeric, jsonb)
  from authenticated;
revoke all on function public.create_challan(
  uuid, date, uuid, text, numeric, jsonb, jsonb
) from authenticated;
revoke all on function public.update_challan(
  uuid, uuid, date, uuid, text, numeric, jsonb
) from authenticated;
revoke all on function public.update_challan(
  uuid, uuid, date, uuid, text, numeric, jsonb, jsonb
) from authenticated;

comment on table public.vehicles is
  'Factory-scoped operational Vehicle identities used by new Challan delivery snapshots.';
comment on column public.vehicles.vehicle_number is
  'Uppercase display number with whitespace normalized for Office presentation.';
comment on column public.vehicles.normalized_vehicle_number is
  'Whitespace-free uppercase Vehicle identity key, unique within one factory.';
comment on column public.vehicles.delivery_wage_tracking_enabled is
  'Live setting for future Challan saves; changing it never rewrites saved Challan snapshots.';
comment on column public.vehicles.is_active is
  'Active Vehicles can be selected for new saves; archived Vehicles remain historical references.';
comment on column public.challans.vehicle_id is
  'C2 Vehicle master reference. NULL is valid for legacy rows and no-Vehicle Challans.';
comment on column public.challans.vehicle_number_snapshot is
  'C2 historical display Vehicle number captured from the selected Vehicle at final save.';
comment on column public.challans.delivery_wage_applicable_snapshot is
  'C2 historical result of the selected Vehicle live Delivery Wage Tracking setting at final save.';
comment on column public.challans.trip_labour_wage is
  'Internal historical trip labour expense; never contributes to customer revenue, payments, or outstanding.';
comment on column public.challans.vehicle_number is
  'Legacy print/report compatibility mirror. C2 writes derive it from vehicle_number_snapshot; it is not a new-write authority.';
comment on column public.challans.tractor_labour_rate_snapshot is
  'Legacy compatibility mirror of C2 trip_labour_wage; it is not a new-write authority.';
comment on function public.find_or_create_vehicle(uuid, text, boolean) is
  'Concurrency-safe C2 Vehicle identity resolver using the factory-normalized unique key.';
comment on function public.set_vehicle_delivery_wage_tracking(uuid, uuid, boolean) is
  'Changes live Delivery Wage Tracking for future saves without mutating historical Challans.';
comment on function public.archive_vehicle(uuid, uuid) is
  'Archives a Vehicle from future selection while preserving historical references.';
comment on function public.restore_vehicle(uuid, uuid) is
  'Restores an archived Vehicle to future selection.';
comment on function public.resolve_challan_vehicle_snapshot(uuid, uuid, numeric) is
  'Private C2 authority that locks and resolves the selected active Vehicle current configuration into strict trip snapshots.';
comment on function public.create_challan_with_vehicle_snapshot(
  uuid, date, uuid, uuid, numeric, jsonb, jsonb
) is
  'Private C2 atomic creator for authoritative Vehicle, wage, customer, company, brick, flexible-line, and total state.';
comment on function public.update_challan_with_vehicle_snapshot(
  uuid, uuid, date, uuid, uuid, numeric, jsonb, jsonb, boolean
) is
  'Private C2 atomic updater that re-resolves current Vehicle configuration while preserving all existing lock and void rules.';
comment on function public.create_challan(
  uuid, date, uuid, uuid, numeric, jsonb, jsonb
) is
  'C2 authoritative create entry point. Vehicle is optional; applicability is server-derived and Trip Labour Wage is internal only.';
comment on function public.update_challan(
  uuid, uuid, date, uuid, uuid, numeric, jsonb, jsonb
) is
  'C2 authoritative update entry point. Final Vehicle configuration is re-snapshotted atomically under existing Challan locks.';

commit;
