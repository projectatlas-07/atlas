-- Atlas Challan correction #3: the operator's optional paper/reference number
-- replaces automatic public numbering. The UUID remains the internal identity.

begin;

lock table public.challans,
  public.challan_items,
  public.challan_flexible_lines,
  public.customer_payment_allocations,
  public.challan_number_counters
in exclusive mode;

-- Remove every callable automatic-number path before removing its counter.
drop function if exists public.create_challan(uuid, date, uuid, uuid, numeric, jsonb, jsonb);
drop function if exists public.update_challan(uuid, uuid, date, uuid, uuid, numeric, jsonb, jsonb);
drop function if exists public.create_challan_with_vehicle_snapshot(uuid, date, uuid, uuid, numeric, jsonb, jsonb);
drop function if exists public.update_challan_with_vehicle_snapshot(uuid, uuid, date, uuid, uuid, numeric, jsonb, jsonb, boolean);

drop function if exists public.create_challan(uuid, date, uuid, text, numeric, jsonb);
drop function if exists public.create_challan(uuid, date, uuid, text, numeric, jsonb, jsonb);
drop function if exists public.update_challan(uuid, uuid, date, uuid, text, numeric, jsonb);
drop function if exists public.update_challan(uuid, uuid, date, uuid, text, numeric, jsonb, jsonb);
drop function if exists public.create_challan_with_final_content(uuid, date, uuid, text, numeric, jsonb, jsonb);
drop function if exists public.update_challan_with_final_content(uuid, uuid, date, uuid, text, numeric, jsonb, jsonb, boolean);

drop index public.challans_factory_date_number_idx;
drop index public.challans_factory_customer_date_idx;
drop index public.challans_factory_vehicle_date_idx;

alter table public.challans
  drop constraint challans_number_positive_check,
  alter column challan_number drop not null,
  alter column challan_number type text using challan_number::text;

alter table public.challans
  add constraint challans_number_optional_manual_check check (
    challan_number is null
    or (
      challan_number <> ''
      and challan_number = btrim(challan_number)
      and char_length(challan_number) <= 100
      and challan_number !~ '[[:cntrl:]]'
    )
  );

create index challans_factory_date_created_idx
  on public.challans(factory_id, challan_date desc, created_at desc, id desc);
create index challans_factory_customer_date_created_idx
  on public.challans(factory_id, customer_id, challan_date desc, created_at desc, id desc);
create index challans_factory_vehicle_date_created_idx
  on public.challans(factory_id, vehicle_id, challan_date desc, created_at desc, id desc)
  where vehicle_id is not null;

create or replace function public.guard_challan_header_update()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.status = 'void' then
    raise exception 'A void Challan cannot be changed.' using errcode = 'P3006';
  end if;

  if old.is_locked then
    raise exception 'A locked Challan cannot be changed.' using errcode = 'P3005';
  end if;

  if new.id <> old.id
    or new.factory_id <> old.factory_id
    or new.company_name_snapshot <> old.company_name_snapshot
    or new.company_business_description_snapshot
      <> old.company_business_description_snapshot
    or new.company_address_snapshot <> old.company_address_snapshot
    or new.company_mobile_snapshot <> old.company_mobile_snapshot
    or new.company_village_snapshot is distinct from old.company_village_snapshot
    or new.company_post_office_snapshot is distinct from old.company_post_office_snapshot
    or new.company_police_station_snapshot is distinct from old.company_police_station_snapshot
    or new.company_district_snapshot is distinct from old.company_district_snapshot
    or new.company_state_snapshot is distinct from old.company_state_snapshot
    or new.created_at <> old.created_at then
    raise exception 'Permanent Challan identity and company snapshots cannot be changed.'
      using errcode = 'P3007';
  end if;

  if new.challan_number is distinct from old.challan_number
    and current_setting('atlas.internal_challan_number_write', true) is distinct from 'on' then
    raise exception 'Challan No. can only be changed through the unlocked Challan editor.'
      using errcode = 'P3007';
  end if;

  if new.challan_total is distinct from old.challan_total
    and current_setting('atlas.internal_challan_total_write', true) is distinct from 'on' then
    raise exception 'Challan totals can only be derived from persisted Challan lines.'
      using errcode = 'P3008';
  end if;

  if new.status <> old.status and new.status <> 'void' then
    raise exception 'A Challan can only transition from active to void.'
      using errcode = 'P3009';
  end if;

  if old.is_locked and not new.is_locked then
    raise exception 'A Challan financial lock cannot be removed.'
      using errcode = 'P3005';
  end if;

  return new;
end;
$$;

create function public.create_challan_with_vehicle_snapshot(
  p_factory_id uuid,
  p_challan_number text,
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
  normalized_challan_number text := nullif(btrim(coalesce(p_challan_number, '')), '');
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
  if normalized_challan_number is not null and (
    char_length(normalized_challan_number) > 100
    or normalized_challan_number ~ '[[:cntrl:]]'
  ) then
    raise exception 'Challan No. must be at most 100 characters and stay on one line.'
      using errcode = '22023';
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
    p_factory_id, normalized_challan_number, p_challan_date, p_customer_id,
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

create function public.update_challan_with_vehicle_snapshot(
  p_factory_id uuid,
  p_challan_id uuid,
  p_challan_number text,
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
  normalized_challan_number text := nullif(btrim(coalesce(p_challan_number, '')), '');
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
  if normalized_challan_number is not null and (
    char_length(normalized_challan_number) > 100
    or normalized_challan_number ~ '[[:cntrl:]]'
  ) then
    raise exception 'Challan No. must be at most 100 characters and stay on one line.'
      using errcode = '22023';
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

  perform set_config('atlas.internal_challan_number_write', 'on', true);
  update public.challans
  set challan_number = normalized_challan_number,
      challan_date = p_challan_date,
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
  perform set_config('atlas.internal_challan_number_write', 'off', true);

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

create function public.create_challan(
  p_factory_id uuid,
  p_challan_number text,
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
    p_factory_id, p_challan_number, p_challan_date, p_customer_id,
    p_vehicle_id, p_trip_labour_wage, p_items,
    coalesce(p_flexible_lines, '[]'::jsonb)
  );
$$;

create function public.update_challan(
  p_factory_id uuid,
  p_challan_id uuid,
  p_challan_number text,
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
    p_factory_id, p_challan_id, p_challan_number, p_challan_date,
    p_customer_id, p_vehicle_id, p_trip_labour_wage, p_items,
    p_flexible_lines, p_flexible_lines is not null
  );
$$;

revoke all on function public.create_challan_with_vehicle_snapshot(
  uuid, text, date, uuid, uuid, numeric, jsonb, jsonb
) from public, anon, authenticated;
revoke all on function public.update_challan_with_vehicle_snapshot(
  uuid, uuid, text, date, uuid, uuid, numeric, jsonb, jsonb, boolean
) from public, anon, authenticated;
revoke all on function public.guard_challan_header_update()
  from public, anon, authenticated;

revoke all on function public.create_challan(
  uuid, text, date, uuid, uuid, numeric, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.create_challan(
  uuid, text, date, uuid, uuid, numeric, jsonb, jsonb
) to authenticated;
revoke all on function public.update_challan(
  uuid, uuid, text, date, uuid, uuid, numeric, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.update_challan(
  uuid, uuid, text, date, uuid, uuid, numeric, jsonb, jsonb
) to authenticated;

drop table public.challan_number_counters;

comment on column public.challans.challan_number is
  'Optional operator-entered paper/reference number. NULL means no public reference; the Challan UUID remains authoritative.';
comment on constraint challans_factory_number_key on public.challans is
  'Non-NULL operator references remain unique within a factory; PostgreSQL permits multiple NULL references.';
comment on function public.create_challan(
  uuid, text, date, uuid, uuid, numeric, jsonb, jsonb
) is
  'Creates a Challan with an optional trimmed manual reference and no generated public fallback.';
comment on function public.update_challan(
  uuid, uuid, text, date, uuid, uuid, numeric, jsonb, jsonb
) is
  'Updates an unlocked active Challan, including its optional manual reference, while preserving UUID identity and financial locks.';

commit;
