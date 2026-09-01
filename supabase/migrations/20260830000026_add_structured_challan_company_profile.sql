-- Atlas Sales correction A1: structured printable company profiles and immutable Challan snapshots.

alter table public.factories
  add column village text not null default '',
  add column post_office text not null default '',
  add column police_station text not null default '',
  add column district text not null default '',
  add column state text not null default '',
  add constraint factories_structured_printable_profile_check check (
    village = btrim(village)
    and post_office = btrim(post_office)
    and police_station = btrim(police_station)
    and district = btrim(district)
    and state = btrim(state)
    and village !~ '[[:cntrl:]]'
    and post_office !~ '[[:cntrl:]]'
    and police_station !~ '[[:cntrl:]]'
    and district !~ '[[:cntrl:]]'
    and state !~ '[[:cntrl:]]'
    and length(village) <= 200
    and length(post_office) <= 200
    and length(police_station) <= 200
    and length(district) <= 200
    and length(state) <= 200
  );

alter table public.challans
  add column company_village_snapshot text,
  add column company_post_office_snapshot text,
  add column company_police_station_snapshot text,
  add column company_district_snapshot text,
  add column company_state_snapshot text,
  add constraint challans_structured_company_snapshots_check check (
    (
      company_village_snapshot is null
      and company_post_office_snapshot is null
      and company_police_station_snapshot is null
      and company_district_snapshot is null
      and company_state_snapshot is null
    )
    or
    (
      company_village_snapshot is not null
      and company_post_office_snapshot is not null
      and company_police_station_snapshot is not null
      and company_district_snapshot is not null
      and company_state_snapshot is not null
      and company_village_snapshot <> ''
      and company_post_office_snapshot <> ''
      and company_police_station_snapshot <> ''
      and company_district_snapshot <> ''
      and company_state_snapshot <> ''
      and company_village_snapshot = btrim(company_village_snapshot)
      and company_post_office_snapshot = btrim(company_post_office_snapshot)
      and company_police_station_snapshot = btrim(company_police_station_snapshot)
      and company_district_snapshot = btrim(company_district_snapshot)
      and company_state_snapshot = btrim(company_state_snapshot)
      and company_village_snapshot !~ '[[:cntrl:]]'
      and company_post_office_snapshot !~ '[[:cntrl:]]'
      and company_police_station_snapshot !~ '[[:cntrl:]]'
      and company_district_snapshot !~ '[[:cntrl:]]'
      and company_state_snapshot !~ '[[:cntrl:]]'
    )
  );

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
    or new.challan_number <> old.challan_number
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

  if new.challan_total is distinct from old.challan_total
    and current_setting('atlas.internal_challan_total_write', true) is distinct from 'on' then
    raise exception 'Challan totals can only be derived from Challan items.'
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

create or replace function public.update_factory_printable_profile(
  p_factory_id uuid,
  p_name text,
  p_business_description text,
  p_village text,
  p_post_office text,
  p_police_station text,
  p_district text,
  p_state text,
  p_mobile text
)
returns public.factories
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_name text := btrim(regexp_replace(coalesce(p_name, ''), '[[:space:]]+', ' ', 'g'));
  normalized_description text := btrim(regexp_replace(coalesce(p_business_description, ''), '[[:space:]]+', ' ', 'g'));
  normalized_village text := btrim(regexp_replace(coalesce(p_village, ''), '[[:space:]]+', ' ', 'g'));
  normalized_post_office text := btrim(regexp_replace(coalesce(p_post_office, ''), '[[:space:]]+', ' ', 'g'));
  normalized_police_station text := btrim(regexp_replace(coalesce(p_police_station, ''), '[[:space:]]+', ' ', 'g'));
  normalized_district text := btrim(regexp_replace(coalesce(p_district, ''), '[[:space:]]+', ' ', 'g'));
  normalized_state text := btrim(regexp_replace(coalesce(p_state, ''), '[[:space:]]+', ' ', 'g'));
  normalized_mobile text := btrim(regexp_replace(coalesce(p_mobile, ''), '[[:space:]]+', ' ', 'g'));
  updated_factory public.factories%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;

  if normalized_name = ''
    or normalized_description = ''
    or normalized_village = ''
    or normalized_post_office = ''
    or normalized_police_station = ''
    or normalized_district = ''
    or normalized_state = ''
    or normalized_mobile = '' then
    raise exception 'All structured printable factory fields are required.' using errcode = '22023';
  end if;

  if greatest(
    length(normalized_village),
    length(normalized_post_office),
    length(normalized_police_station),
    length(normalized_district),
    length(normalized_state)
  ) > 200 then
    raise exception 'Structured printable factory fields must be at most 200 characters.'
      using errcode = '22023';
  end if;

  update public.factories
  set name = normalized_name,
      business_description = normalized_description,
      village = normalized_village,
      post_office = normalized_post_office,
      police_station = normalized_police_station,
      district = normalized_district,
      state = normalized_state,
      mobile = normalized_mobile
  where id = p_factory_id
  returning * into updated_factory;

  return updated_factory;
end;
$$;

revoke all on function public.update_factory_printable_profile(
  uuid, text, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.update_factory_printable_profile(
  uuid, text, text, text, text, text, text, text, text
) to authenticated;

create or replace function public.create_challan(
  p_factory_id uuid,
  p_challan_date date,
  p_customer_id uuid,
  p_vehicle_number text,
  p_tractor_labour_rate numeric,
  p_items jsonb
)
returns public.challans
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  factory_profile public.factories%rowtype;
  customer_profile public.customers%rowtype;
  allocated_number bigint;
  normalized_vehicle_number text := upper(regexp_replace(
    btrim(coalesce(p_vehicle_number, '')), '[[:space:]]+', '', 'g'
  ));
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
  if normalized_vehicle_number = '' or normalized_vehicle_number !~ '^[A-Z0-9-]+$' then
    raise exception 'Vehicle number must contain only letters, numbers, or hyphens.'
      using errcode = '22023';
  end if;
  if p_tractor_labour_rate is null
    or p_tractor_labour_rate = 'NaN'::numeric
    or p_tractor_labour_rate = 'Infinity'::numeric
    or p_tractor_labour_rate < 0
    or p_tractor_labour_rate >= 1000000000
    or p_tractor_labour_rate <> round(p_tractor_labour_rate, 2) then
    raise exception 'Tractor labour rate must be non-negative and use at most two decimal places.'
      using errcode = '22023';
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

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'A Challan requires at least one item.' using errcode = '22023';
  end if;

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
    factory_id,
    challan_number,
    challan_date,
    customer_id,
    customer_name_snapshot,
    customer_address_snapshot,
    customer_mobile_snapshot,
    company_name_snapshot,
    company_business_description_snapshot,
    company_address_snapshot,
    company_mobile_snapshot,
    company_village_snapshot,
    company_post_office_snapshot,
    company_police_station_snapshot,
    company_district_snapshot,
    company_state_snapshot,
    vehicle_number,
    tractor_labour_rate_snapshot
  ) values (
    p_factory_id,
    allocated_number,
    p_challan_date,
    p_customer_id,
    customer_profile.name,
    customer_profile.address,
    customer_profile.mobile,
    factory_profile.name,
    factory_profile.business_description,
    legacy_compatible_address_snapshot,
    factory_profile.mobile,
    factory_profile.village,
    factory_profile.post_office,
    factory_profile.police_station,
    factory_profile.district,
    factory_profile.state,
    normalized_vehicle_number,
    p_tractor_labour_rate
  ) returning * into new_challan;

  perform public.insert_challan_items(p_factory_id, new_challan.id, p_items);
  select * into new_challan from public.challans where id = new_challan.id;
  return new_challan;
end;
$$;

comment on column public.factories.address is
  'Legacy generic printable address retained for historical compatibility; structured location fields are authoritative for new Challans.';
comment on column public.challans.company_address_snapshot is
  'Legacy printable company address. Existing rows retain their original value; new rows receive a structured compatibility rendering.';
comment on column public.challans.company_village_snapshot is
  'Nullable only for Challans created before structured company snapshots were introduced.';
comment on constraint challans_structured_company_snapshots_check on public.challans is
  'Structured location snapshots are either all absent for legacy Challans or all present and normalized.';
