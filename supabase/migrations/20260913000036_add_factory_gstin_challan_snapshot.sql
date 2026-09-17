-- Atlas Factory GSTIN: optional Factory Profile value and immutable Challan snapshot.

begin;

alter table public.factories
  add column gstin text,
  add constraint factories_gstin_check check (
    gstin is null
    or (
      gstin <> ''
      and gstin = btrim(gstin)
      and gstin = upper(gstin)
      and gstin !~ '[[:space:][:cntrl:]]'
      and char_length(gstin) <= 50
    )
  );

alter table public.challans
  add column company_gstin_snapshot text,
  add constraint challans_company_gstin_snapshot_check check (
    company_gstin_snapshot is null
    or (
      company_gstin_snapshot <> ''
      and company_gstin_snapshot = btrim(company_gstin_snapshot)
      and company_gstin_snapshot = upper(company_gstin_snapshot)
      and company_gstin_snapshot !~ '[[:space:][:cntrl:]]'
      and char_length(company_gstin_snapshot) <= 50
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
    or new.company_gstin_snapshot is distinct from old.company_gstin_snapshot
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
    raise exception 'A Challan financial lock cannot be removed.' using errcode = 'P3005';
  end if;

  return new;
end;
$$;

drop function public.update_factory_printable_profile(
  uuid, text, text, text, text, text, text, text, text
);

create function public.update_factory_printable_profile(
  p_factory_id uuid,
  p_name text,
  p_business_description text,
  p_village text,
  p_post_office text,
  p_police_station text,
  p_district text,
  p_state text,
  p_mobile text,
  p_gstin text
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
  normalized_gstin text := nullif(upper(btrim(coalesce(p_gstin, ''))), '');
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

  if normalized_gstin is not null and (
    char_length(normalized_gstin) > 50
    or normalized_gstin ~ '[[:space:][:cntrl:]]'
  ) then
    raise exception 'GSTIN must be at most 50 characters and contain no spaces.'
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
      mobile = normalized_mobile,
      gstin = normalized_gstin
  where id = p_factory_id
  returning * into updated_factory;

  return updated_factory;
end;
$$;

revoke all on function public.update_factory_printable_profile(
  uuid, text, text, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.update_factory_printable_profile(
  uuid, text, text, text, text, text, text, text, text, text
) to authenticated;

create or replace function public.create_challan_with_vehicle_snapshot(
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
    company_state_snapshot, company_gstin_snapshot,
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
    factory_profile.state, factory_profile.gstin,
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

comment on column public.factories.gstin is
  'Optional current Factory GSTIN, normalized for future company snapshots.';
comment on column public.challans.company_gstin_snapshot is
  'Immutable Factory GSTIN captured when the Challan is created; NULL for legacy or GSTIN-less Challans.';

commit;
