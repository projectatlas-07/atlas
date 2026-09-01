-- Atlas Sales S1: factory-scoped customers and authoritative numbered Challans.

alter table public.factories
  add column business_description text not null default '',
  add column address text not null default '',
  add column mobile text not null default '';

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  name text not null,
  address text not null default '',
  mobile text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_id_factory_key unique (id, factory_id),
  constraint customers_name_check check (
    name <> ''
    and name = btrim(name)
    and name = regexp_replace(name, '[[:space:]]+', ' ', 'g')
    and name !~ '[[:cntrl:]]'
  ),
  constraint customers_address_check check (
    address = btrim(address)
    and address !~ '[[:cntrl:]]'
  ),
  constraint customers_mobile_check check (
    mobile = btrim(mobile)
    and mobile !~ '[[:cntrl:]]'
  )
);

create table public.challan_number_counters (
  factory_id uuid primary key references public.factories(id) on delete restrict,
  last_challan_number bigint not null,
  updated_at timestamptz not null default now(),
  constraint challan_number_counters_positive_check check (last_challan_number > 0)
);

create table public.challans (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  challan_number bigint not null,
  challan_date date not null,
  customer_id uuid not null,
  customer_name_snapshot text not null,
  customer_address_snapshot text not null,
  customer_mobile_snapshot text not null,
  company_name_snapshot text not null,
  company_business_description_snapshot text not null,
  company_address_snapshot text not null,
  company_mobile_snapshot text not null,
  vehicle_number text not null,
  tractor_labour_rate_snapshot numeric(14, 2) not null,
  challan_total numeric(18, 2) not null default 0,
  status text not null default 'active',
  is_locked boolean not null default false,
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint challans_id_factory_key unique (id, factory_id),
  constraint challans_factory_number_key unique (factory_id, challan_number),
  constraint challans_customer_factory_fkey
    foreign key (customer_id, factory_id)
    references public.customers(id, factory_id) on delete restrict,
  constraint challans_number_positive_check check (challan_number > 0),
  constraint challans_date_finite_check check (isfinite(challan_date)),
  constraint challans_customer_name_snapshot_check check (customer_name_snapshot <> ''),
  constraint challans_company_snapshots_check check (
    company_name_snapshot <> ''
    and company_business_description_snapshot <> ''
    and company_address_snapshot <> ''
    and company_mobile_snapshot <> ''
  ),
  constraint challans_vehicle_number_check check (
    vehicle_number <> ''
    and vehicle_number = upper(vehicle_number)
    and vehicle_number !~ '[[:space:][:cntrl:]]'
    and vehicle_number ~ '^[A-Z0-9-]+$'
  ),
  constraint challans_tractor_labour_rate_check check (
    tractor_labour_rate_snapshot >= 0
    and tractor_labour_rate_snapshot < 1000000000
    and tractor_labour_rate_snapshot <> 'NaN'::numeric
    and tractor_labour_rate_snapshot <> 'Infinity'::numeric
  ),
  constraint challans_total_check check (
    challan_total >= 0
    and challan_total <> 'NaN'::numeric
    and challan_total <> 'Infinity'::numeric
  ),
  constraint challans_status_check check (status in ('active', 'void')),
  constraint challans_void_audit_check check (
    (status = 'active' and voided_at is null)
    or (status = 'void' and voided_at is not null)
  )
);

create table public.challan_items (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  challan_id uuid not null,
  brick_type_id uuid not null,
  brick_particulars_snapshot text not null,
  quantity bigint not null,
  rate_per_1000_bricks numeric(14, 2) not null,
  pricing_unit text not null default 'PER_1000_BRICKS',
  line_amount numeric(18, 2) generated always as (
    round((quantity::numeric * rate_per_1000_bricks) / 1000, 2)
  ) stored,
  line_position integer not null,
  created_at timestamptz not null default now(),
  constraint challan_items_id_factory_key unique (id, factory_id),
  constraint challan_items_challan_factory_fkey
    foreign key (challan_id, factory_id)
    references public.challans(id, factory_id) on delete restrict,
  constraint challan_items_brick_type_factory_fkey
    foreign key (brick_type_id, factory_id)
    references public.brick_types(id, factory_id) on delete restrict,
  constraint challan_items_position_key unique (challan_id, line_position),
  constraint challan_items_particulars_check check (brick_particulars_snapshot <> ''),
  constraint challan_items_quantity_check check (quantity > 0 and quantity <= 1000000000),
  constraint challan_items_rate_check check (
    rate_per_1000_bricks > 0
    and rate_per_1000_bricks < 1000000000
    and rate_per_1000_bricks <> 'NaN'::numeric
    and rate_per_1000_bricks <> 'Infinity'::numeric
  ),
  constraint challan_items_pricing_unit_check check (
    pricing_unit = 'PER_1000_BRICKS'
  ),
  constraint challan_items_line_position_check check (line_position > 0)
);

create index customers_factory_name_idx
  on public.customers(factory_id, name, id);
create index challans_factory_date_number_idx
  on public.challans(factory_id, challan_date desc, challan_number desc);
create index challans_factory_customer_date_idx
  on public.challans(factory_id, customer_id, challan_date desc, challan_number desc);
create index challan_items_factory_challan_position_idx
  on public.challan_items(factory_id, challan_id, line_position);

create trigger customers_set_updated_at
before update on public.customers
for each row execute function public.set_updated_at();

create trigger challans_set_updated_at
before update on public.challans
for each row execute function public.set_updated_at();

alter table public.factories enable row level security;
alter table public.customers enable row level security;
alter table public.challan_number_counters enable row level security;
alter table public.challans enable row level security;
alter table public.challan_items enable row level security;

revoke all on public.factories from anon, authenticated;
revoke all on public.customers from anon, authenticated;
revoke all on public.challan_number_counters from anon, authenticated;
revoke all on public.challans from anon, authenticated;
revoke all on public.challan_items from anon, authenticated;

grant select on public.factories to authenticated;
grant select on public.customers to authenticated;
grant select on public.challans to authenticated;
grant select on public.challan_items to authenticated;

create policy "Authenticated users can read their factory"
  on public.factories
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = factories.id
        and factory_users.is_active = true
    )
  );

create policy "Authenticated users can read their factory Sales customers"
  on public.customers
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = customers.factory_id
        and factory_users.is_active = true
    )
  );

create policy "Authenticated users can read their factory Sales Challans"
  on public.challans
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = challans.factory_id
        and factory_users.is_active = true
    )
  );

create policy "Authenticated users can read their factory Sales Challan items"
  on public.challan_items
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = challan_items.factory_id
        and factory_users.is_active = true
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

create or replace function public.reject_challan_delete()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'A numbered Challan is permanent and cannot be deleted.'
    using errcode = 'P3001';
end;
$$;

create or replace function public.guard_challan_item_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  parent_status text;
  parent_is_locked boolean;
  target_challan_id uuid := case when tg_op = 'DELETE' then old.challan_id else new.challan_id end;
  target_factory_id uuid := case when tg_op = 'DELETE' then old.factory_id else new.factory_id end;
begin
  if tg_op = 'UPDATE' and (
    new.id <> old.id
    or new.factory_id <> old.factory_id
    or new.challan_id <> old.challan_id
    or new.created_at <> old.created_at
  ) then
    raise exception 'A Challan item cannot be moved to a different Challan.'
      using errcode = 'P3007';
  end if;

  select status, is_locked
  into parent_status, parent_is_locked
  from public.challans
  where id = target_challan_id
    and factory_id = target_factory_id
  for update;

  if not found then
    raise exception 'Challan does not belong to this factory.'
      using errcode = 'P3003';
  end if;
  if parent_is_locked then
    raise exception 'A locked Challan cannot be changed.' using errcode = 'P3005';
  end if;
  if parent_status <> 'active' then
    raise exception 'A void Challan cannot be changed.' using errcode = 'P3006';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.recalculate_challan_total()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  target_challan_id uuid := case when tg_op = 'DELETE' then old.challan_id else new.challan_id end;
  target_factory_id uuid := case when tg_op = 'DELETE' then old.factory_id else new.factory_id end;
  previous_internal_flag text := current_setting('atlas.internal_challan_total_write', true);
begin
  perform set_config('atlas.internal_challan_total_write', 'on', true);

  update public.challans
  set challan_total = coalesce((
    select sum(challan_items.line_amount)
    from public.challan_items
    where challan_items.challan_id = target_challan_id
      and challan_items.factory_id = target_factory_id
  ), 0)
  where id = target_challan_id
    and factory_id = target_factory_id;

  perform set_config(
    'atlas.internal_challan_total_write',
    coalesce(previous_internal_flag, ''),
    true
  );
  return null;
end;
$$;

create trigger challans_guard_header_update
before update on public.challans
for each row execute function public.guard_challan_header_update();

create trigger challans_reject_delete
before delete on public.challans
for each row execute function public.reject_challan_delete();

create trigger challan_items_guard_mutation
before insert or update or delete on public.challan_items
for each row execute function public.guard_challan_item_mutation();

create trigger challan_items_recalculate_total
after insert or update or delete on public.challan_items
for each row execute function public.recalculate_challan_total();

create or replace function public.update_factory_printable_profile(
  p_factory_id uuid,
  p_name text,
  p_business_description text,
  p_address text,
  p_mobile text
)
returns public.factories
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_name text := btrim(regexp_replace(p_name, '[[:space:]]+', ' ', 'g'));
  normalized_description text := btrim(regexp_replace(p_business_description, '[[:space:]]+', ' ', 'g'));
  normalized_address text := btrim(regexp_replace(p_address, '[[:space:]]+', ' ', 'g'));
  normalized_mobile text := btrim(regexp_replace(p_mobile, '[[:space:]]+', ' ', 'g'));
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

  if normalized_name is null or normalized_name = ''
    or normalized_description is null or normalized_description = ''
    or normalized_address is null or normalized_address = ''
    or normalized_mobile is null or normalized_mobile = '' then
    raise exception 'All printable factory fields are required.' using errcode = '22023';
  end if;

  update public.factories
  set name = normalized_name,
      business_description = normalized_description,
      address = normalized_address,
      mobile = normalized_mobile
  where id = p_factory_id
  returning * into updated_factory;

  return updated_factory;
end;
$$;

create or replace function public.create_customer(
  p_factory_id uuid,
  p_name text,
  p_address text,
  p_mobile text
)
returns public.customers
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_name text := btrim(regexp_replace(p_name, '[[:space:]]+', ' ', 'g'));
  normalized_address text := btrim(coalesce(p_address, ''));
  normalized_mobile text := btrim(coalesce(p_mobile, ''));
  new_customer public.customers%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;
  if normalized_name is null or normalized_name = '' then
    raise exception 'Customer name is required.' using errcode = '22023';
  end if;

  insert into public.customers(factory_id, name, address, mobile)
  values (p_factory_id, normalized_name, normalized_address, normalized_mobile)
  returning * into new_customer;

  return new_customer;
end;
$$;

create or replace function public.update_customer(
  p_factory_id uuid,
  p_customer_id uuid,
  p_name text,
  p_address text,
  p_mobile text
)
returns public.customers
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_name text := btrim(regexp_replace(p_name, '[[:space:]]+', ' ', 'g'));
  normalized_address text := btrim(coalesce(p_address, ''));
  normalized_mobile text := btrim(coalesce(p_mobile, ''));
  updated_customer public.customers%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;
  if normalized_name is null or normalized_name = '' then
    raise exception 'Customer name is required.' using errcode = '22023';
  end if;

  select * into updated_customer
  from public.customers
  where id = p_customer_id and factory_id = p_factory_id
  for update;
  if not found then
    raise exception 'Customer does not belong to this factory.' using errcode = 'P3002';
  end if;

  update public.customers
  set name = normalized_name,
      address = normalized_address,
      mobile = normalized_mobile
  where id = p_customer_id and factory_id = p_factory_id
  returning * into updated_customer;

  return updated_customer;
end;
$$;

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
    or jsonb_array_length(p_items) = 0
    or jsonb_array_length(p_items) > 100 then
    raise exception 'A Challan requires between 1 and 100 items.' using errcode = '22023';
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

  select * into factory_profile from public.factories where id = p_factory_id;
  if factory_profile.name = ''
    or factory_profile.business_description = ''
    or factory_profile.address = ''
    or factory_profile.mobile = '' then
    raise exception 'Complete the printable factory profile before creating a Challan.'
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
    factory_profile.address,
    factory_profile.mobile,
    normalized_vehicle_number,
    p_tractor_labour_rate
  ) returning * into new_challan;

  perform public.insert_challan_items(p_factory_id, new_challan.id, p_items);
  select * into new_challan from public.challans where id = new_challan.id;
  return new_challan;
end;
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

  select * into customer_profile
  from public.customers
  where id = p_customer_id and factory_id = p_factory_id;
  if not found then
    raise exception 'Customer does not belong to this factory.' using errcode = 'P3002';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'A Challan requires at least one item.' using errcode = '22023';
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

  select * into existing_challan
  from public.challans
  where id = p_challan_id and factory_id = p_factory_id;
  return existing_challan;
end;
$$;

create or replace function public.void_challan(
  p_factory_id uuid,
  p_challan_id uuid
)
returns public.challans
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  existing_challan public.challans%rowtype;
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
    raise exception 'A locked Challan cannot be voided.' using errcode = 'P3005';
  end if;
  if existing_challan.status <> 'active' then
    raise exception 'A void Challan cannot be voided again.' using errcode = 'P3006';
  end if;

  update public.challans
  set status = 'void', voided_at = now()
  where id = p_challan_id and factory_id = p_factory_id
  returning * into existing_challan;

  return existing_challan;
end;
$$;

revoke all on function public.guard_challan_header_update() from public, anon, authenticated;
revoke all on function public.reject_challan_delete() from public, anon, authenticated;
revoke all on function public.guard_challan_item_mutation() from public, anon, authenticated;
revoke all on function public.recalculate_challan_total() from public, anon, authenticated;
revoke all on function public.insert_challan_items(uuid, uuid, jsonb) from public, anon, authenticated;

revoke all on function public.update_factory_printable_profile(uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.update_factory_printable_profile(uuid, text, text, text, text)
  to authenticated;

revoke all on function public.create_customer(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.create_customer(uuid, text, text, text)
  to authenticated;

revoke all on function public.update_customer(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.update_customer(uuid, uuid, text, text, text)
  to authenticated;

revoke all on function public.create_challan(uuid, date, uuid, text, numeric, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_challan(uuid, date, uuid, text, numeric, jsonb)
  to authenticated;

revoke all on function public.update_challan(uuid, uuid, date, uuid, text, numeric, jsonb)
  from public, anon, authenticated;
grant execute on function public.update_challan(uuid, uuid, date, uuid, text, numeric, jsonb)
  to authenticated;

revoke all on function public.void_challan(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.void_challan(uuid, uuid)
  to authenticated;

comment on table public.customers is
  'Reusable factory-scoped Sales customer master data. Challans keep independent printable snapshots.';
comment on table public.challan_number_counters is
  'Private per-factory allocator used transactionally by create_challan.';
comment on table public.challans is
  'Authoritative numbered brick sale/delivery source. Numbered rows are never hard-deleted.';
comment on table public.challan_items is
  'Historically snapshotted Challan lines priced explicitly in rupees per 1,000 bricks.';
comment on column public.challan_items.line_amount is
  'Database-generated round(quantity / 1000 * rate_per_1000_bricks, 2).';
comment on column public.challans.tractor_labour_rate_snapshot is
  'Internal per-trip tractor delivery labour rate; excluded from customer-facing Challan output.';
comment on column public.challans.is_locked is
  'One-way financial lock reserved for the future customer-payment milestone; S1 exposes no lock RPC.';
