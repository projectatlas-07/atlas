-- Atlas dedicated Coal Purchase module. Structured coal operations reuse the
-- supplier, expense-payment allocation, and derived Cash Book foundations.

begin;

create table public.coal_reference_values (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  kind text not null,
  display_value text not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  constraint coal_reference_values_id_factory_key unique (id, factory_id),
  constraint coal_reference_values_kind_check
    check (kind in ('coal_name', 'source_location')),
  constraint coal_reference_values_display_check check (
    display_value <> ''
    and display_value = btrim(display_value)
    and display_value = regexp_replace(display_value, '[[:space:]]+', ' ', 'g')
    and length(display_value) <= 120
    and display_value !~ '[[:cntrl:]]'
  )
);

create unique index coal_reference_values_factory_kind_value_key
  on public.coal_reference_values(factory_id, kind, lower(display_value));
create index coal_reference_values_factory_kind_history_idx
  on public.coal_reference_values(factory_id, kind, display_value, id);

create table public.coal_purchases (
  id uuid primary key,
  factory_id uuid not null references public.factories(id) on delete restrict,
  coal_name_reference_id uuid not null,
  source_reference_id uuid not null,
  coal_name_snapshot text not null,
  source_location_snapshot text not null,
  coal_challan_number text,
  vehicle_number_snapshot text not null,
  quantity numeric(18, 6) not null,
  rate numeric(18, 6) not null,
  coal_amount numeric(18, 2) not null,
  separate_freight_amount numeric(18, 2) not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  constraint coal_purchases_id_factory_key unique (id, factory_id),
  constraint coal_purchases_expense_record_factory_fkey
    foreign key (id, factory_id)
    references public.expense_records(id, factory_id) on delete restrict,
  constraint coal_purchases_name_reference_factory_fkey
    foreign key (coal_name_reference_id, factory_id)
    references public.coal_reference_values(id, factory_id) on delete restrict,
  constraint coal_purchases_source_reference_factory_fkey
    foreign key (source_reference_id, factory_id)
    references public.coal_reference_values(id, factory_id) on delete restrict,
  constraint coal_purchases_name_snapshot_check check (
    coal_name_snapshot <> '' and coal_name_snapshot = btrim(coal_name_snapshot)
    and length(coal_name_snapshot) <= 120 and coal_name_snapshot !~ '[[:cntrl:]]'
  ),
  constraint coal_purchases_source_snapshot_check check (
    source_location_snapshot <> '' and source_location_snapshot = btrim(source_location_snapshot)
    and length(source_location_snapshot) <= 120
    and source_location_snapshot !~ '[[:cntrl:]]'
  ),
  constraint coal_purchases_challan_number_check check (
    coal_challan_number is null or (
      coal_challan_number <> '' and coal_challan_number = btrim(coal_challan_number)
      and length(coal_challan_number) <= 100 and coal_challan_number !~ '[[:cntrl:]]'
    )
  ),
  constraint coal_purchases_vehicle_check check (
    vehicle_number_snapshot <> '' and vehicle_number_snapshot = btrim(vehicle_number_snapshot)
    and vehicle_number_snapshot = upper(vehicle_number_snapshot)
    and length(vehicle_number_snapshot) <= 100
    and vehicle_number_snapshot !~ '[[:cntrl:]]'
  ),
  constraint coal_purchases_quantity_check check (
    quantity > 0 and quantity <> 'NaN'::numeric and quantity <> 'Infinity'::numeric
    and quantity < 1000000000000 and quantity = round(quantity, 6)
  ),
  constraint coal_purchases_rate_check check (
    rate > 0 and rate <> 'NaN'::numeric and rate <> 'Infinity'::numeric
    and rate < 1000000000000 and rate = round(rate, 6)
  ),
  constraint coal_purchases_amount_check check (
    coal_amount > 0 and coal_amount <> 'NaN'::numeric
    and coal_amount <> 'Infinity'::numeric and coal_amount < 10000000000000000
    and coal_amount = round(coal_amount, 2)
    and separate_freight_amount >= 0
    and separate_freight_amount <> 'NaN'::numeric
    and separate_freight_amount <> 'Infinity'::numeric
    and separate_freight_amount < 10000000000000000
    and separate_freight_amount = round(separate_freight_amount, 2)
  )
);

create index coal_purchases_factory_history_idx
  on public.coal_purchases(factory_id, created_at desc, id desc);
create index coal_purchases_factory_name_idx
  on public.coal_purchases(factory_id, coal_name_reference_id, id);
create index coal_purchases_factory_source_idx
  on public.coal_purchases(factory_id, source_reference_id, id);

alter table public.coal_reference_values enable row level security;
alter table public.coal_purchases enable row level security;
revoke all on public.coal_reference_values from public, anon, authenticated;
revoke all on public.coal_purchases from public, anon, authenticated;
grant select on public.coal_reference_values to authenticated;
grant select on public.coal_purchases to authenticated;

create policy "Authenticated users can read their factory coal references"
  on public.coal_reference_values for select to authenticated
  using (exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = coal_reference_values.factory_id
      and factory_users.is_active = true
  ));

create policy "Authenticated users can read their factory coal purchases"
  on public.coal_purchases for select to authenticated
  using (exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = coal_purchases.factory_id
      and factory_users.is_active = true
  ));

create type public.coal_purchase_detail as (
  id uuid,
  factory_id uuid,
  purchase_date date,
  seller_id uuid,
  seller_name_snapshot text,
  seller_address_snapshot text,
  seller_mobile_snapshot text,
  coal_name_reference_id uuid,
  coal_name_snapshot text,
  source_reference_id uuid,
  source_location_snapshot text,
  coal_challan_number text,
  vehicle_number_snapshot text,
  quantity numeric,
  rate numeric,
  coal_amount numeric,
  separate_freight_amount numeric,
  final_total numeric,
  status text,
  is_locked boolean,
  total_paid numeric,
  outstanding_amount numeric,
  payment_state text,
  voided_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
);

create or replace function public.resolve_coal_measurements(
  p_quantity numeric,
  p_rate numeric,
  p_coal_amount numeric
)
returns table (resolved_quantity numeric, resolved_rate numeric, resolved_coal_amount numeric)
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  supplied_count integer := (p_quantity is not null)::integer
    + (p_rate is not null)::integer + (p_coal_amount is not null)::integer;
begin
  if supplied_count <> 2 then
    raise exception 'Supply exactly two of Quantity, Rate, and Coal Amount.'
      using errcode = 'P4201';
  end if;
  if p_quantity is not null and (
    p_quantity <= 0 or p_quantity = 'NaN'::numeric or p_quantity = 'Infinity'::numeric
    or p_quantity >= 1000000000000 or p_quantity <> round(p_quantity, 6)
  ) then
    raise exception 'Coal quantity must be positive and use at most six decimal places.'
      using errcode = 'P4202';
  end if;
  if p_rate is not null and (
    p_rate <= 0 or p_rate = 'NaN'::numeric or p_rate = 'Infinity'::numeric
    or p_rate >= 1000000000000 or p_rate <> round(p_rate, 6)
  ) then
    raise exception 'Coal rate must be positive and use at most six decimal places.'
      using errcode = 'P4202';
  end if;
  if p_coal_amount is not null and (
    p_coal_amount <= 0 or p_coal_amount = 'NaN'::numeric
    or p_coal_amount = 'Infinity'::numeric or p_coal_amount >= 10000000000000000
    or p_coal_amount <> round(p_coal_amount, 2)
  ) then
    raise exception 'Coal amount must be positive and use at most two decimal places.'
      using errcode = 'P4202';
  end if;

  resolved_quantity := coalesce(p_quantity, round(p_coal_amount / p_rate, 6));
  resolved_rate := coalesce(p_rate, round(p_coal_amount / p_quantity, 6));
  resolved_coal_amount := coalesce(p_coal_amount, round(p_quantity * p_rate, 2));
  if resolved_quantity <= 0 or resolved_rate <= 0 or resolved_coal_amount <= 0
    or resolved_quantity >= 1000000000000 or resolved_rate >= 1000000000000
    or resolved_coal_amount >= 10000000000000000 then
    raise exception 'Derived Coal quantity, rate, or amount is outside the supported range.'
      using errcode = 'P4202';
  end if;
  return next;
end;
$$;

create or replace function public.get_coal_purchase_details(
  p_factory_id uuid,
  p_purchase_id uuid,
  p_seller_id uuid
)
returns setof public.coal_purchase_detail
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select row(
    coal.id, coal.factory_id, records.business_date, records.supplier_id,
    records.counterparty_name_snapshot, records.counterparty_address_snapshot,
    records.counterparty_mobile_snapshot, coal.coal_name_reference_id,
    coal.coal_name_snapshot, coal.source_reference_id, coal.source_location_snapshot,
    coal.coal_challan_number, coal.vehicle_number_snapshot, coal.quantity, coal.rate,
    coal.coal_amount, coal.separate_freight_amount, records.total_amount,
    records.status, records.is_locked, coalesce(paid.total_paid, 0),
    case when records.status = 'active'
      then records.total_amount - coalesce(paid.total_paid, 0) else 0 end,
    case
      when coalesce(paid.total_paid, 0) = 0 then 'unpaid'
      when coalesce(paid.total_paid, 0) < records.total_amount then 'partially_paid'
      else 'paid'
    end,
    records.voided_at, records.created_at, records.updated_at
  )::public.coal_purchase_detail
  from public.coal_purchases as coal
  join public.expense_records as records
    on records.id = coal.id and records.factory_id = coal.factory_id
  left join lateral (
    select coalesce(sum(allocations.allocated_amount), 0) as total_paid
    from public.expense_payment_allocations as allocations
    where allocations.factory_id = coal.factory_id
      and allocations.expense_record_id = coal.id
  ) as paid on true
  where coal.factory_id = p_factory_id
    and (p_purchase_id is null or coal.id = p_purchase_id)
    and (p_seller_id is null or records.supplier_id = p_seller_id)
  order by records.business_date desc, records.created_at desc, coal.id desc;
$$;

create or replace function public.guard_coal_purchase_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Coal Purchase history cannot be deleted.' using errcode = 'P4207';
  end if;
  if current_setting('atlas.internal_coal_purchase_write', true) is distinct from 'on' then
    raise exception 'Coal Purchases can only be changed through controlled Coal RPCs.'
      using errcode = 'P4207';
  end if;
  if new.id <> old.id or new.factory_id <> old.factory_id
    or new.created_at <> old.created_at or new.created_by <> old.created_by then
    raise exception 'Permanent Coal Purchase identity cannot be changed.' using errcode = 'P4207';
  end if;
  return new;
end;
$$;

create or replace function public.guard_coal_expense_record_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if exists (
    select 1 from public.coal_purchases
    where coal_purchases.id = old.id and coal_purchases.factory_id = old.factory_id
  ) and current_setting('atlas.internal_coal_purchase_write', true) is distinct from 'on' then
    raise exception 'Coal Purchase financial sources can only change through controlled Coal RPCs.'
      using errcode = 'P4207';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.guard_coal_payment_allocation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if exists (
    select 1 from public.coal_purchases
    where coal_purchases.id = new.expense_record_id
      and coal_purchases.factory_id = new.factory_id
  ) and current_setting('atlas.internal_coal_purchase_write', true) is distinct from 'on' then
    raise exception 'Coal Purchase payments must use the controlled Coal payment RPC.'
      using errcode = 'P4207';
  end if;
  return new;
end;
$$;

create trigger coal_purchases_guard_update_delete
before update or delete on public.coal_purchases
for each row execute function public.guard_coal_purchase_mutation();
create trigger coal_expense_records_guard_update_delete
before update or delete on public.expense_records
for each row execute function public.guard_coal_expense_record_mutation();
create trigger coal_payment_allocations_guard_insert
before insert on public.expense_payment_allocations
for each row execute function public.guard_coal_payment_allocation();

create or replace function public.create_coal_reference_value(
  p_factory_id uuid,
  p_kind text,
  p_display_value text
)
returns public.coal_reference_values
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_kind text := lower(btrim(coalesce(p_kind, '')));
  normalized_value text := btrim(regexp_replace(coalesce(p_display_value, ''), '[[:space:]]+', ' ', 'g'));
  saved_reference public.coal_reference_values%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;
  if normalized_kind not in ('coal_name', 'source_location') then
    raise exception 'Coal reference kind is invalid.' using errcode = '22023';
  end if;
  if normalized_value = '' or length(normalized_value) > 120
    or normalized_value ~ '[[:cntrl:]]' then
    raise exception 'Coal reference value is required and must be at most 120 characters.'
      using errcode = '22023';
  end if;
  begin
    insert into public.coal_reference_values(
      factory_id, kind, display_value, created_by
    ) values (
      p_factory_id, normalized_kind, normalized_value, auth.uid()
    ) returning * into saved_reference;
  exception when unique_violation then
    select * into saved_reference
    from public.coal_reference_values
    where factory_id = p_factory_id and kind = normalized_kind
      and lower(display_value) = lower(normalized_value);
  end;
  return saved_reference;
end;
$$;

create or replace function public.list_coal_purchases(
  p_factory_id uuid,
  p_seller_id uuid
)
returns setof public.coal_purchase_detail
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;
  if p_seller_id is not null and not exists (
    select 1 from public.suppliers
    where suppliers.id = p_seller_id and suppliers.factory_id = p_factory_id
  ) then
    raise exception 'Seller does not belong to this factory.' using errcode = 'P4002';
  end if;
  return query select *
  from public.get_coal_purchase_details(p_factory_id, null, p_seller_id);
end;
$$;

create or replace function public.create_coal_purchase(
  p_factory_id uuid,
  p_purchase_date date,
  p_seller_id uuid,
  p_coal_name_reference_id uuid,
  p_source_reference_id uuid,
  p_coal_challan_number text,
  p_vehicle_number text,
  p_quantity numeric,
  p_rate numeric,
  p_coal_amount numeric,
  p_separate_freight_amount numeric,
  p_initial_paid_amount numeric,
  p_initial_payment_mode text
)
returns setof public.coal_purchase_detail
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_challan text := nullif(btrim(regexp_replace(coalesce(p_coal_challan_number, ''), '[[:space:]]+', ' ', 'g')), '');
  normalized_vehicle text := upper(btrim(regexp_replace(coalesce(p_vehicle_number, ''), '[[:space:]]+', ' ', 'g')));
  normalized_mode text := nullif(lower(btrim(coalesce(p_initial_payment_mode, ''))), '');
  name_snapshot text;
  source_snapshot text;
  seller_snapshot public.suppliers%rowtype;
  measurements record;
  final_total numeric;
  purchase_id uuid := gen_random_uuid();
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;
  if p_purchase_date is null or not isfinite(p_purchase_date) then
    raise exception 'Coal Purchase date must be a finite calendar date.' using errcode = '22023';
  end if;
  select * into seller_snapshot from public.suppliers
  where id = p_seller_id and factory_id = p_factory_id;
  if not found then
    raise exception 'Seller does not belong to this factory.' using errcode = 'P4002';
  end if;
  select display_value into name_snapshot from public.coal_reference_values
  where id = p_coal_name_reference_id and factory_id = p_factory_id and kind = 'coal_name';
  if not found then raise exception 'Coal Name does not belong to this factory.' using errcode = 'P4203'; end if;
  select display_value into source_snapshot from public.coal_reference_values
  where id = p_source_reference_id and factory_id = p_factory_id and kind = 'source_location';
  if not found then raise exception 'Coal Source does not belong to this factory.' using errcode = 'P4203'; end if;
  if normalized_challan is not null and (
    length(normalized_challan) > 100 or normalized_challan ~ '[[:cntrl:]]'
  ) then raise exception 'Coal Challan Number must be at most 100 characters.' using errcode = '22023'; end if;
  if normalized_vehicle = '' or length(normalized_vehicle) > 100
    or normalized_vehicle ~ '[[:cntrl:]]' then
    raise exception 'Vehicle Number is required and must be at most 100 characters.' using errcode = '22023';
  end if;
  select * into measurements
  from public.resolve_coal_measurements(p_quantity, p_rate, p_coal_amount);
  if p_separate_freight_amount is null or p_separate_freight_amount < 0
    or p_separate_freight_amount = 'NaN'::numeric
    or p_separate_freight_amount = 'Infinity'::numeric
    or p_separate_freight_amount >= 10000000000000000
    or p_separate_freight_amount <> round(p_separate_freight_amount, 2) then
    raise exception 'Separate freight must be non-negative and use at most two decimal places.'
      using errcode = 'P4204';
  end if;
  final_total := measurements.resolved_coal_amount + p_separate_freight_amount;
  if final_total >= 10000000000000000 then
    raise exception 'Final Coal Purchase total is outside the supported range.' using errcode = 'P4204';
  end if;
  if p_initial_paid_amount is null or p_initial_paid_amount < 0
    or p_initial_paid_amount = 'NaN'::numeric or p_initial_paid_amount = 'Infinity'::numeric
    or p_initial_paid_amount > final_total or p_initial_paid_amount <> round(p_initial_paid_amount, 2) then
    raise exception 'Initial Paid must be between zero and Final Total.' using errcode = 'P4205';
  end if;
  if (p_initial_paid_amount > 0 and normalized_mode not in ('cash', 'upi', 'bank_transfer', 'cheque', 'other'))
    or (p_initial_paid_amount = 0 and normalized_mode is not null) then
    raise exception 'Choose a payment mode only when Initial Paid is greater than zero.'
      using errcode = 'P3200';
  end if;

  insert into public.expense_records(
    id, factory_id, business_date, kind, supplier_id,
    counterparty_name_snapshot, counterparty_address_snapshot,
    counterparty_mobile_snapshot, description, total_amount, note, created_by
  ) values (
    purchase_id, p_factory_id, p_purchase_date, 'purchase', p_seller_id,
    seller_snapshot.name, seller_snapshot.address, seller_snapshot.mobile,
    format('Coal purchase · %s · %s', name_snapshot, source_snapshot),
    final_total, null, auth.uid()
  );
  insert into public.coal_purchases(
    id, factory_id, coal_name_reference_id, source_reference_id,
    coal_name_snapshot, source_location_snapshot, coal_challan_number,
    vehicle_number_snapshot, quantity, rate, coal_amount,
    separate_freight_amount, created_by
  ) values (
    purchase_id, p_factory_id, p_coal_name_reference_id, p_source_reference_id,
    name_snapshot, source_snapshot, normalized_challan, normalized_vehicle,
    measurements.resolved_quantity, measurements.resolved_rate,
    measurements.resolved_coal_amount, p_separate_freight_amount, auth.uid()
  );
  if p_initial_paid_amount > 0 then
    perform set_config('atlas.internal_coal_purchase_write', 'on', true);
    perform public.create_expense_payment(
      p_factory_id, p_purchase_date, p_initial_paid_amount, normalized_mode,
      'Initial Coal Purchase payment',
      jsonb_build_array(jsonb_build_object(
        'expense_record_id', purchase_id, 'amount', p_initial_paid_amount
      ))
    );
    perform set_config('atlas.internal_coal_purchase_write', 'off', true);
  end if;
  return query select * from public.get_coal_purchase_details(
    p_factory_id, purchase_id, null
  );
end;
$$;

create or replace function public.update_coal_purchase(
  p_factory_id uuid,
  p_purchase_id uuid,
  p_purchase_date date,
  p_seller_id uuid,
  p_coal_name_reference_id uuid,
  p_source_reference_id uuid,
  p_coal_challan_number text,
  p_vehicle_number text,
  p_quantity numeric,
  p_rate numeric,
  p_coal_amount numeric,
  p_separate_freight_amount numeric
)
returns setof public.coal_purchase_detail
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_record public.expense_records%rowtype;
  normalized_challan text := nullif(btrim(regexp_replace(coalesce(p_coal_challan_number, ''), '[[:space:]]+', ' ', 'g')), '');
  normalized_vehicle text := upper(btrim(regexp_replace(coalesce(p_vehicle_number, ''), '[[:space:]]+', ' ', 'g')));
  name_snapshot text;
  source_snapshot text;
  measurements record;
  final_total numeric;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then raise exception 'You do not have access to this factory.' using errcode = '42501'; end if;
  select records.* into target_record
  from public.expense_records as records
  join public.coal_purchases as coal
    on coal.id = records.id and coal.factory_id = records.factory_id
  where records.id = p_purchase_id and records.factory_id = p_factory_id
  for update of records;
  if not found then raise exception 'Coal Purchase does not belong to this factory.' using errcode = 'P4206'; end if;
  if target_record.status <> 'active' or target_record.is_locked then
    raise exception 'A paid or void Coal Purchase cannot be changed.' using errcode = 'P4104';
  end if;
  if p_purchase_date is null or not isfinite(p_purchase_date) then
    raise exception 'Coal Purchase date must be a finite calendar date.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.suppliers where id = p_seller_id and factory_id = p_factory_id) then
    raise exception 'Seller does not belong to this factory.' using errcode = 'P4002';
  end if;
  select display_value into name_snapshot from public.coal_reference_values
  where id = p_coal_name_reference_id and factory_id = p_factory_id and kind = 'coal_name';
  if not found then raise exception 'Coal Name does not belong to this factory.' using errcode = 'P4203'; end if;
  select display_value into source_snapshot from public.coal_reference_values
  where id = p_source_reference_id and factory_id = p_factory_id and kind = 'source_location';
  if not found then raise exception 'Coal Source does not belong to this factory.' using errcode = 'P4203'; end if;
  if normalized_challan is not null and (length(normalized_challan) > 100 or normalized_challan ~ '[[:cntrl:]]') then
    raise exception 'Coal Challan Number must be at most 100 characters.' using errcode = '22023';
  end if;
  if normalized_vehicle = '' or length(normalized_vehicle) > 100 or normalized_vehicle ~ '[[:cntrl:]]' then
    raise exception 'Vehicle Number is required and must be at most 100 characters.' using errcode = '22023';
  end if;
  select * into measurements from public.resolve_coal_measurements(p_quantity, p_rate, p_coal_amount);
  if p_separate_freight_amount is null or p_separate_freight_amount < 0
    or p_separate_freight_amount = 'NaN'::numeric or p_separate_freight_amount = 'Infinity'::numeric
    or p_separate_freight_amount >= 10000000000000000
    or p_separate_freight_amount <> round(p_separate_freight_amount, 2) then
    raise exception 'Separate freight must be non-negative and use at most two decimal places.' using errcode = 'P4204';
  end if;
  final_total := measurements.resolved_coal_amount + p_separate_freight_amount;
  if final_total >= 10000000000000000 then
    raise exception 'Final Coal Purchase total is outside the supported range.' using errcode = 'P4204';
  end if;

  perform set_config('atlas.internal_coal_purchase_write', 'on', true);
  perform public.update_expense_record(
    p_factory_id, p_purchase_id, p_purchase_date, 'purchase', p_seller_id,
    null, format('Coal purchase · %s · %s', name_snapshot, source_snapshot),
    final_total, null
  );
  update public.coal_purchases
  set coal_name_reference_id = p_coal_name_reference_id,
      source_reference_id = p_source_reference_id,
      coal_name_snapshot = name_snapshot,
      source_location_snapshot = source_snapshot,
      coal_challan_number = normalized_challan,
      vehicle_number_snapshot = normalized_vehicle,
      quantity = measurements.resolved_quantity,
      rate = measurements.resolved_rate,
      coal_amount = measurements.resolved_coal_amount,
      separate_freight_amount = p_separate_freight_amount
  where id = p_purchase_id and factory_id = p_factory_id;
  perform set_config('atlas.internal_coal_purchase_write', 'off', true);
  return query select * from public.get_coal_purchase_details(
    p_factory_id, p_purchase_id, null
  );
end;
$$;

create or replace function public.void_coal_purchase(
  p_factory_id uuid,
  p_purchase_id uuid
)
returns setof public.coal_purchase_detail
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then raise exception 'You do not have access to this factory.' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.coal_purchases
    where id = p_purchase_id and factory_id = p_factory_id
  ) then raise exception 'Coal Purchase does not belong to this factory.' using errcode = 'P4206'; end if;
  perform set_config('atlas.internal_coal_purchase_write', 'on', true);
  perform public.void_expense_record(p_factory_id, p_purchase_id);
  perform set_config('atlas.internal_coal_purchase_write', 'off', true);
  return query select * from public.get_coal_purchase_details(
    p_factory_id, p_purchase_id, null
  );
end;
$$;

create or replace function public.create_coal_payment(
  p_factory_id uuid,
  p_purchase_id uuid,
  p_payment_date date,
  p_amount numeric,
  p_payment_mode text,
  p_note text
)
returns public.expense_payments
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  saved_payment public.expense_payments%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then raise exception 'You do not have access to this factory.' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.coal_purchases
    where id = p_purchase_id and factory_id = p_factory_id
  ) then raise exception 'Coal Purchase does not belong to this factory.' using errcode = 'P4206'; end if;
  perform set_config('atlas.internal_coal_purchase_write', 'on', true);
  select * into saved_payment from public.create_expense_payment(
    p_factory_id, p_payment_date, p_amount, p_payment_mode, p_note,
    jsonb_build_array(jsonb_build_object(
      'expense_record_id', p_purchase_id, 'amount', p_amount
    ))
  );
  perform set_config('atlas.internal_coal_purchase_write', 'off', true);
  return saved_payment;
end;
$$;

create or replace function public.list_coal_payments(
  p_factory_id uuid,
  p_seller_id uuid
)
returns table (
  payment_id uuid,
  factory_id uuid,
  purchase_id uuid,
  seller_id uuid,
  seller_name_snapshot text,
  payment_date date,
  amount numeric,
  payment_mode text,
  note text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then raise exception 'You do not have access to this factory.' using errcode = '42501'; end if;
  if p_seller_id is not null and not exists (
    select 1 from public.suppliers
    where suppliers.id = p_seller_id and suppliers.factory_id = p_factory_id
  ) then raise exception 'Seller does not belong to this factory.' using errcode = 'P4002'; end if;
  return query
  select payments.id, payments.factory_id, coal.id, records.supplier_id,
    records.counterparty_name_snapshot, payments.payment_date,
    allocations.allocated_amount, payments.payment_mode, payments.note,
    payments.created_at
  from public.expense_payment_allocations as allocations
  join public.expense_payments as payments
    on payments.id = allocations.payment_id
    and payments.factory_id = allocations.factory_id
  join public.coal_purchases as coal
    on coal.id = allocations.expense_record_id
    and coal.factory_id = allocations.factory_id
  join public.expense_records as records
    on records.id = coal.id and records.factory_id = coal.factory_id
  where coal.factory_id = p_factory_id
    and (p_seller_id is null or records.supplier_id = p_seller_id)
  order by payments.payment_date desc, payments.created_at desc, payments.id desc;
end;
$$;

-- Coal owns its structured correction lifecycle. Keep these rows out of the
-- generic editor, which cannot safely update Coal-specific fields atomically.
create or replace function public.list_expense_records(
  p_factory_id uuid,
  p_supplier_id uuid
)
returns table (
  expense_record_id uuid, factory_id uuid, business_date date, kind text,
  supplier_id uuid, counterparty_name_snapshot text,
  counterparty_address_snapshot text, counterparty_mobile_snapshot text,
  description text, total_amount numeric, note text, status text,
  is_locked boolean, total_paid numeric, outstanding_amount numeric,
  payment_state text, voided_at timestamptz, created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users as authorized_user
    where authorized_user.user_id = auth.uid()
      and authorized_user.factory_id = p_factory_id
      and authorized_user.is_active = true
  ) then raise exception 'You do not have access to this factory.' using errcode = '42501'; end if;
  if p_supplier_id is not null and not exists (
    select 1 from public.suppliers as requested_supplier
    where requested_supplier.id = p_supplier_id
      and requested_supplier.factory_id = p_factory_id
  ) then raise exception 'Supplier does not belong to this factory.' using errcode = 'P4002'; end if;
  return query
  select records.id, records.factory_id, records.business_date, records.kind,
    records.supplier_id, records.counterparty_name_snapshot,
    records.counterparty_address_snapshot, records.counterparty_mobile_snapshot,
    records.description, records.total_amount, records.note, records.status,
    records.is_locked, coalesce(paid.total_paid, 0),
    case when records.status = 'active'
      then records.total_amount - coalesce(paid.total_paid, 0) else 0 end,
    case
      when coalesce(paid.total_paid, 0) = 0 then 'unpaid'
      when coalesce(paid.total_paid, 0) < records.total_amount then 'partially_paid'
      else 'paid'
    end,
    records.voided_at, records.created_at, records.updated_at
  from public.expense_records as records
  left join lateral (
    select coalesce(sum(allocations.allocated_amount), 0) as total_paid
    from public.expense_payment_allocations as allocations
    where allocations.factory_id = records.factory_id
      and allocations.expense_record_id = records.id
  ) as paid on true
  where records.factory_id = p_factory_id
    and (p_supplier_id is null or records.supplier_id = p_supplier_id)
    and not exists (
      select 1 from public.coal_purchases
      where coal_purchases.id = records.id
        and coal_purchases.factory_id = records.factory_id
    )
  order by records.business_date desc, records.created_at desc, records.id desc;
end;
$$;

revoke all on function public.resolve_coal_measurements(numeric, numeric, numeric)
  from public, anon, authenticated;
revoke all on function public.get_coal_purchase_details(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.guard_coal_purchase_mutation()
  from public, anon, authenticated;
revoke all on function public.guard_coal_expense_record_mutation()
  from public, anon, authenticated;
revoke all on function public.guard_coal_payment_allocation()
  from public, anon, authenticated;

revoke all on function public.create_coal_reference_value(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.create_coal_reference_value(uuid, text, text)
  to authenticated;
revoke all on function public.list_coal_purchases(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.list_coal_purchases(uuid, uuid) to authenticated;
revoke all on function public.create_coal_purchase(
  uuid, date, uuid, uuid, uuid, text, text, numeric, numeric, numeric,
  numeric, numeric, text
) from public, anon, authenticated;
grant execute on function public.create_coal_purchase(
  uuid, date, uuid, uuid, uuid, text, text, numeric, numeric, numeric,
  numeric, numeric, text
) to authenticated;
revoke all on function public.update_coal_purchase(
  uuid, uuid, date, uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric
) from public, anon, authenticated;
grant execute on function public.update_coal_purchase(
  uuid, uuid, date, uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric
) to authenticated;
revoke all on function public.void_coal_purchase(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.void_coal_purchase(uuid, uuid) to authenticated;
revoke all on function public.create_coal_payment(uuid, uuid, date, numeric, text, text)
  from public, anon, authenticated;
grant execute on function public.create_coal_payment(uuid, uuid, date, numeric, text, text)
  to authenticated;
revoke all on function public.list_coal_payments(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.list_coal_payments(uuid, uuid) to authenticated;
revoke all on function public.list_expense_records(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.list_expense_records(uuid, uuid) to authenticated;

comment on table public.coal_reference_values is
  'Factory-scoped remembered Coal Names and Source/Location values.';
comment on table public.coal_purchases is
  'Structured Coal Purchase extension keyed one-to-one by its shared expense-record UUID.';
comment on function public.create_coal_purchase(
  uuid, date, uuid, uuid, uuid, text, text, numeric, numeric, numeric,
  numeric, numeric, text
) is
  'Atomically creates structured Coal data, its seller obligation, and optional initial payment.';
comment on function public.create_coal_payment(uuid, uuid, date, numeric, text, text) is
  'Routes one later Coal payment through the shared immutable expense-payment and Cash Book authority.';
comment on function public.list_expense_records(uuid, uuid) is
  'Lists generic Expense/Purchase records only; dedicated Coal records remain in their purpose-built module.';

commit;
