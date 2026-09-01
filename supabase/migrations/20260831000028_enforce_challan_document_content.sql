-- Atlas Sales correction A3: validate Challans by their final document content.
-- A3 allows NOTE-only Challans, but temporarily rejects every no-brick document
-- containing EXTRA_CHARGE until A4 includes flexible revenue in challan_total.

create or replace function public.insert_challan_items(
  p_factory_id uuid,
  p_challan_id uuid,
  p_items jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  item_value jsonb;
  item_position integer;
  item_brick_type_id uuid;
  item_quantity_numeric numeric;
  item_quantity bigint;
  item_rate numeric;
  item_particulars text;
begin
  if p_items is null
    or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) > 100 then
    raise exception 'Challan brick items must be an array of at most 100 items.'
      using errcode = '22023';
  end if;

  for item_value, item_position in
    select item, ordinality::integer
    from jsonb_array_elements(p_items) with ordinality as input(item, ordinality)
  loop
    if jsonb_typeof(item_value) <> 'object'
      or not item_value ? 'brick_type_id'
      or not item_value ? 'quantity'
      or not item_value ? 'rate'
      or exists (
        select 1
        from jsonb_object_keys(item_value) as supplied(item_key)
        where supplied.item_key not in ('brick_type_id', 'quantity', 'rate')
      ) then
      raise exception 'Each Challan item must contain only brick_type_id, quantity, and rate.'
        using errcode = '22023';
    end if;

    begin
      item_brick_type_id := (item_value ->> 'brick_type_id')::uuid;
      item_quantity_numeric := (item_value ->> 'quantity')::numeric;
      item_rate := (item_value ->> 'rate')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'A Challan item contains an invalid brick type, quantity, or rate.'
        using errcode = '22023';
    end;

    if item_quantity_numeric is null
      or item_quantity_numeric = 'NaN'::numeric
      or item_quantity_numeric = 'Infinity'::numeric
      or item_quantity_numeric <= 0
      or item_quantity_numeric > 1000000000
      or item_quantity_numeric <> trunc(item_quantity_numeric) then
      raise exception 'Challan item quantity must be a positive whole number.'
        using errcode = '22023';
    end if;
    if item_rate is null
      or item_rate = 'NaN'::numeric
      or item_rate = 'Infinity'::numeric
      or item_rate <= 0
      or item_rate >= 1000000000
      or item_rate <> round(item_rate, 2) then
      raise exception 'Challan item rate must be positive and use at most two decimal places.'
        using errcode = '22023';
    end if;

    select name into item_particulars
    from public.brick_types
    where id = item_brick_type_id and factory_id = p_factory_id;
    if not found then
      raise exception 'Brick type does not belong to this factory.' using errcode = 'P3004';
    end if;

    item_quantity := item_quantity_numeric::bigint;
    insert into public.challan_items(
      factory_id,
      challan_id,
      brick_type_id,
      brick_particulars_snapshot,
      quantity,
      rate_per_1000_bricks,
      pricing_unit,
      line_position
    ) values (
      p_factory_id,
      p_challan_id,
      item_brick_type_id,
      item_particulars,
      item_quantity,
      item_rate,
      'PER_1000_BRICKS',
      item_position
    );
  end loop;
end;
$$;

create or replace function public.assert_challan_final_content(
  p_factory_id uuid,
  p_challan_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  has_brick_items boolean;
  has_flexible_lines boolean;
  has_extra_charge boolean;
begin
  perform 1
  from public.challans
  where id = p_challan_id
    and factory_id = p_factory_id
  for update;
  if not found then
    raise exception 'Challan does not belong to this factory.' using errcode = 'P3003';
  end if;

  select exists (
    select 1
    from public.challan_items
    where challan_id = p_challan_id
      and factory_id = p_factory_id
  ) into has_brick_items;

  select
    count(*) > 0,
    count(*) filter (where line_type = 'EXTRA_CHARGE') > 0
  into has_flexible_lines, has_extra_charge
  from public.challan_flexible_lines
  where challan_id = p_challan_id
    and factory_id = p_factory_id;

  if not has_brick_items and not has_flexible_lines then
    raise exception 'A Challan must contain at least one meaningful document line.'
      using errcode = 'P3011';
  end if;

  -- TEMPORARY A3 GUARD: remove in A4 only when EXTRA_CHARGE participates in the
  -- authoritative Challan total, payment limit, outstanding, and reporting truth.
  if not has_brick_items and has_extra_charge then
    raise exception 'A Challan without brick items cannot contain EXTRA_CHARGE lines until flexible charges are included in the authoritative Challan total.'
      using errcode = 'P3012';
  end if;
end;
$$;

create or replace function public.create_challan_with_final_content(
  p_factory_id uuid,
  p_challan_date date,
  p_customer_id uuid,
  p_vehicle_number text,
  p_tractor_labour_rate numeric,
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

  -- Reject the trivially empty intent before touching the transactional counter.
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
  perform public.replace_challan_flexible_lines(
    p_factory_id,
    new_challan.id,
    p_flexible_lines
  );
  perform public.assert_challan_final_content(p_factory_id, new_challan.id);

  select * into new_challan
  from public.challans
  where id = new_challan.id
    and factory_id = p_factory_id;
  return new_challan;
end;
$$;

create or replace function public.update_challan_with_final_content(
  p_factory_id uuid,
  p_challan_id uuid,
  p_challan_date date,
  p_customer_id uuid,
  p_vehicle_number text,
  p_tractor_labour_rate numeric,
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
  normalized_vehicle_number text := upper(regexp_replace(
    btrim(coalesce(p_vehicle_number, '')), '[[:space:]]+', '', 'g'
  ));
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

  update public.challans
  set challan_date = p_challan_date,
      customer_id = p_customer_id,
      customer_name_snapshot = customer_profile.name,
      customer_address_snapshot = customer_profile.address,
      customer_mobile_snapshot = customer_profile.mobile,
      vehicle_number = normalized_vehicle_number,
      tractor_labour_rate_snapshot = p_tractor_labour_rate
  where id = p_challan_id and factory_id = p_factory_id;

  delete from public.challan_items
  where challan_id = p_challan_id and factory_id = p_factory_id;
  perform public.insert_challan_items(p_factory_id, p_challan_id, p_items);

  if p_replace_flexible_lines then
    perform public.replace_challan_flexible_lines(
      p_factory_id,
      p_challan_id,
      p_flexible_lines
    );
  end if;

  -- This assertion reads the actual post-replacement rows. Any failure rolls back
  -- header, brick, flexible, and total effects as one statement.
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
  p_vehicle_number text,
  p_tractor_labour_rate numeric,
  p_items jsonb
)
returns public.challans
language sql
security definer
set search_path = pg_catalog, public
as $$
  select *
  from public.create_challan_with_final_content(
    p_factory_id,
    p_challan_date,
    p_customer_id,
    p_vehicle_number,
    p_tractor_labour_rate,
    p_items,
    '[]'::jsonb
  );
$$;

create or replace function public.create_challan(
  p_factory_id uuid,
  p_challan_date date,
  p_customer_id uuid,
  p_vehicle_number text,
  p_tractor_labour_rate numeric,
  p_items jsonb,
  p_flexible_lines jsonb
)
returns public.challans
language sql
security definer
set search_path = pg_catalog, public
as $$
  select *
  from public.create_challan_with_final_content(
    p_factory_id,
    p_challan_date,
    p_customer_id,
    p_vehicle_number,
    p_tractor_labour_rate,
    p_items,
    coalesce(p_flexible_lines, '[]'::jsonb)
  );
$$;

create or replace function public.update_challan(
  p_factory_id uuid,
  p_challan_id uuid,
  p_challan_date date,
  p_customer_id uuid,
  p_vehicle_number text,
  p_tractor_labour_rate numeric,
  p_items jsonb
)
returns public.challans
language sql
security definer
set search_path = pg_catalog, public
as $$
  select *
  from public.update_challan_with_final_content(
    p_factory_id,
    p_challan_id,
    p_challan_date,
    p_customer_id,
    p_vehicle_number,
    p_tractor_labour_rate,
    p_items,
    null,
    false
  );
$$;

create or replace function public.update_challan(
  p_factory_id uuid,
  p_challan_id uuid,
  p_challan_date date,
  p_customer_id uuid,
  p_vehicle_number text,
  p_tractor_labour_rate numeric,
  p_items jsonb,
  p_flexible_lines jsonb
)
returns public.challans
language sql
security definer
set search_path = pg_catalog, public
as $$
  select *
  from public.update_challan_with_final_content(
    p_factory_id,
    p_challan_id,
    p_challan_date,
    p_customer_id,
    p_vehicle_number,
    p_tractor_labour_rate,
    p_items,
    p_flexible_lines,
    p_flexible_lines is not null
  );
$$;

revoke all on function public.insert_challan_items(uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.assert_challan_final_content(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.create_challan_with_final_content(
  uuid, date, uuid, text, numeric, jsonb, jsonb
) from public, anon, authenticated;
revoke all on function public.update_challan_with_final_content(
  uuid, uuid, date, uuid, text, numeric, jsonb, jsonb, boolean
) from public, anon, authenticated;

revoke all on function public.create_challan(uuid, date, uuid, text, numeric, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_challan(uuid, date, uuid, text, numeric, jsonb)
  to authenticated;
revoke all on function public.create_challan(
  uuid, date, uuid, text, numeric, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.create_challan(
  uuid, date, uuid, text, numeric, jsonb, jsonb
) to authenticated;

revoke all on function public.update_challan(
  uuid, uuid, date, uuid, text, numeric, jsonb
) from public, anon, authenticated;
grant execute on function public.update_challan(
  uuid, uuid, date, uuid, text, numeric, jsonb
) to authenticated;
revoke all on function public.update_challan(
  uuid, uuid, date, uuid, text, numeric, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.update_challan(
  uuid, uuid, date, uuid, text, numeric, jsonb, jsonb
) to authenticated;

comment on function public.assert_challan_final_content(uuid, uuid) is
  'A3 final-state guard: requires one document line and temporarily blocks no-brick EXTRA_CHARGE documents until A4.';
comment on function public.create_challan_with_final_content(
  uuid, date, uuid, text, numeric, jsonb, jsonb
) is
  'Private A3 creator preserving A1 snapshots and numbering while validating combined final content.';
comment on function public.update_challan_with_final_content(
  uuid, uuid, date, uuid, text, numeric, jsonb, jsonb, boolean
) is
  'Private A3 updater that validates actual persisted rows after brick replacement and optional flexible replacement.';
comment on function public.create_challan(uuid, date, uuid, text, numeric, jsonb) is
  'Backward-compatible brick-only create entry point using the A3 final-content model.';
comment on function public.create_challan(uuid, date, uuid, text, numeric, jsonb, jsonb) is
  'A3 combined-content create entry point. NOTE-only is allowed; no-brick EXTRA_CHARGE is temporarily rejected until A4.';
comment on function public.update_challan(uuid, uuid, date, uuid, text, numeric, jsonb) is
  'Backward-compatible update entry point. Flexible lines are preserved and participate in A3 final-state validation.';
comment on function public.update_challan(uuid, uuid, date, uuid, text, numeric, jsonb, jsonb) is
  'A3 combined-content update entry point. NULL preserves flexible lines; an array replaces them before final-state validation.';
