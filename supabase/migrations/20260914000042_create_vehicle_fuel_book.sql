-- Atlas dedicated Vehicle Fuel Book. Fuel operations reuse Vehicle Master,
-- supplier roles, shared expense obligations/payments, and Cash Book.

begin;

alter table public.supplier_roles
  drop constraint supplier_roles_role_check;
alter table public.supplier_roles
  add constraint supplier_roles_role_check
  check (role in ('COAL_SELLER', 'GARAGE', 'FUEL_PUMP'));

create table public.vehicle_fuel_records (
  id uuid primary key,
  factory_id uuid not null references public.factories(id) on delete restrict,
  vehicle_id uuid not null,
  vehicle_number_snapshot text not null,
  fuel_time time(0) without time zone not null,
  fuel_type text not null,
  litres numeric(18, 6) not null,
  rate_per_litre numeric(18, 6) not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  constraint vehicle_fuel_records_id_factory_key unique (id, factory_id),
  constraint vehicle_fuel_records_expense_factory_fkey
    foreign key (id, factory_id)
    references public.expense_records(id, factory_id) on delete restrict,
  constraint vehicle_fuel_records_vehicle_factory_fkey
    foreign key (vehicle_id, factory_id)
    references public.vehicles(id, factory_id) on delete restrict,
  constraint vehicle_fuel_records_vehicle_snapshot_check check (
    vehicle_number_snapshot <> ''
    and vehicle_number_snapshot = upper(vehicle_number_snapshot)
    and vehicle_number_snapshot = btrim(vehicle_number_snapshot)
    and vehicle_number_snapshot = regexp_replace(vehicle_number_snapshot, '[[:space:]]+', ' ', 'g')
    and length(vehicle_number_snapshot) <= 100
    and vehicle_number_snapshot !~ '[[:cntrl:]]'
  ),
  constraint vehicle_fuel_records_type_check check (fuel_type in ('DIESEL', 'PETROL')),
  constraint vehicle_fuel_records_litres_check check (
    litres > 0 and litres <> 'NaN'::numeric and litres <> 'Infinity'::numeric
    and litres < 1000000000000 and litres = round(litres, 6)
  ),
  constraint vehicle_fuel_records_rate_check check (
    rate_per_litre > 0 and rate_per_litre <> 'NaN'::numeric
    and rate_per_litre <> 'Infinity'::numeric and rate_per_litre < 1000000000000
    and rate_per_litre = round(rate_per_litre, 6)
  )
);

create index vehicle_fuel_factory_vehicle_time_idx
  on public.vehicle_fuel_records(factory_id, vehicle_id, fuel_time desc, created_at desc, id desc);
create index vehicle_fuel_factory_time_idx
  on public.vehicle_fuel_records(factory_id, fuel_time desc, created_at desc, id desc);

alter table public.vehicle_fuel_records enable row level security;
revoke all on public.vehicle_fuel_records from public, anon, authenticated;
grant select on public.vehicle_fuel_records to authenticated;

create policy "Authenticated users can read their factory Vehicle Fuel"
  on public.vehicle_fuel_records for select to authenticated
  using (exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = vehicle_fuel_records.factory_id
      and factory_users.is_active = true
  ));

create type public.vehicle_fuel_detail as (
  id uuid,
  factory_id uuid,
  fuel_date date,
  fuel_time time without time zone,
  vehicle_id uuid,
  vehicle_number_snapshot text,
  pump_id uuid,
  pump_name_snapshot text,
  pump_address_snapshot text,
  pump_mobile_snapshot text,
  fuel_type text,
  litres numeric,
  rate_per_litre numeric,
  fuel_amount numeric,
  status text,
  is_locked boolean,
  total_paid numeric,
  outstanding_amount numeric,
  payment_state text,
  voided_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
);

create type public.vehicle_fuel_measurements as (
  litres numeric,
  rate_per_litre numeric,
  fuel_amount numeric
);

create or replace function public.resolve_vehicle_fuel_measurements(
  p_litres numeric,
  p_rate_per_litre numeric,
  p_fuel_amount numeric
)
returns public.vehicle_fuel_measurements
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  result public.vehicle_fuel_measurements;
begin
  if num_nonnulls(p_litres, p_rate_per_litre, p_fuel_amount) <> 2 then
    raise exception 'Supply exactly two of Litres, Rate, and Fuel Amount.' using errcode = '22023';
  end if;
  if p_litres is not null and (
    p_litres <= 0 or p_litres = 'NaN'::numeric or p_litres = 'Infinity'::numeric
    or p_litres >= 1000000000000 or p_litres <> round(p_litres, 6)
  ) then raise exception 'Litres must be positive and use at most six decimal places.' using errcode = '22023'; end if;
  if p_rate_per_litre is not null and (
    p_rate_per_litre <= 0 or p_rate_per_litre = 'NaN'::numeric
    or p_rate_per_litre = 'Infinity'::numeric or p_rate_per_litre >= 1000000000000
    or p_rate_per_litre <> round(p_rate_per_litre, 6)
  ) then raise exception 'Rate must be positive and use at most six decimal places.' using errcode = '22023'; end if;
  if p_fuel_amount is not null and (
    p_fuel_amount <= 0 or p_fuel_amount = 'NaN'::numeric
    or p_fuel_amount = 'Infinity'::numeric or p_fuel_amount >= 10000000000000000
    or p_fuel_amount <> round(p_fuel_amount, 2)
  ) then raise exception 'Fuel Amount must be positive and use at most two decimal places.' using errcode = '22023'; end if;

  result.litres := coalesce(p_litres, round(p_fuel_amount / p_rate_per_litre, 6));
  result.rate_per_litre := coalesce(p_rate_per_litre, round(p_fuel_amount / p_litres, 6));
  result.fuel_amount := coalesce(p_fuel_amount, round(p_litres * p_rate_per_litre, 2));
  if result.litres <= 0 or result.rate_per_litre <= 0 or result.fuel_amount <= 0 then
    raise exception 'Fuel measurements must resolve to positive values.' using errcode = '22023';
  end if;
  return result;
end;
$$;

create or replace function public.get_vehicle_fuel_details(
  p_factory_id uuid,
  p_fuel_record_id uuid,
  p_vehicle_id uuid,
  p_pump_id uuid
)
returns setof public.vehicle_fuel_detail
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select row(
    fuel.id, fuel.factory_id, records.business_date, fuel.fuel_time,
    fuel.vehicle_id, fuel.vehicle_number_snapshot,
    records.supplier_id, records.counterparty_name_snapshot,
    records.counterparty_address_snapshot, records.counterparty_mobile_snapshot,
    fuel.fuel_type, fuel.litres, fuel.rate_per_litre, records.total_amount,
    records.status, records.is_locked, coalesce(paid.total_paid, 0),
    case when records.status = 'active'
      then records.total_amount - coalesce(paid.total_paid, 0) else 0 end,
    case
      when coalesce(paid.total_paid, 0) = 0 then 'unpaid'
      when coalesce(paid.total_paid, 0) < records.total_amount then 'partially_paid'
      else 'paid'
    end,
    records.voided_at, records.created_at, records.updated_at
  )::public.vehicle_fuel_detail
  from public.vehicle_fuel_records as fuel
  join public.expense_records as records
    on records.id = fuel.id and records.factory_id = fuel.factory_id
  left join lateral (
    select coalesce(sum(allocations.allocated_amount), 0) as total_paid
    from public.expense_payment_allocations as allocations
    where allocations.factory_id = fuel.factory_id
      and allocations.expense_record_id = fuel.id
  ) as paid on true
  where fuel.factory_id = p_factory_id
    and (p_fuel_record_id is null or fuel.id = p_fuel_record_id)
    and (p_vehicle_id is null or fuel.vehicle_id = p_vehicle_id)
    and (p_pump_id is null or records.supplier_id = p_pump_id)
  order by records.business_date desc, fuel.fuel_time desc, records.created_at desc, fuel.id desc;
$$;

create or replace function public.guard_vehicle_fuel_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Vehicle Fuel history cannot be deleted.' using errcode = 'P4505';
  end if;
  if current_setting('atlas.internal_vehicle_fuel_write', true) is distinct from 'on' then
    raise exception 'Vehicle Fuel can only change through its dedicated controls.' using errcode = 'P4505';
  end if;
  if new.id <> old.id or new.factory_id <> old.factory_id
    or new.created_at <> old.created_at or new.created_by <> old.created_by then
    raise exception 'Permanent Vehicle Fuel identity cannot be changed.' using errcode = 'P4505';
  end if;
  return new;
end;
$$;

create or replace function public.guard_vehicle_fuel_expense_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if exists (
    select 1 from public.vehicle_fuel_records
    where vehicle_fuel_records.id = old.id
      and vehicle_fuel_records.factory_id = old.factory_id
  ) and current_setting('atlas.internal_vehicle_fuel_write', true) is distinct from 'on' then
    raise exception 'Vehicle Fuel financial sources can only change through dedicated controls.'
      using errcode = 'P4505';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.guard_vehicle_fuel_payment_allocation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if exists (
    select 1 from public.vehicle_fuel_records
    where vehicle_fuel_records.id = new.expense_record_id
      and vehicle_fuel_records.factory_id = new.factory_id
  ) and current_setting('atlas.internal_vehicle_fuel_write', true) is distinct from 'on' then
    raise exception 'Vehicle Fuel payments must use the dedicated payment control.' using errcode = 'P4505';
  end if;
  return new;
end;
$$;

create or replace function public.require_fuel_pump_role()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  selected_supplier_id uuid;
begin
  select records.supplier_id into selected_supplier_id
  from public.expense_records as records
  where records.id = new.id and records.factory_id = new.factory_id;
  if not exists (
    select 1 from public.supplier_roles as roles
    where roles.factory_id = new.factory_id
      and roles.supplier_id = selected_supplier_id
      and roles.role = 'FUEL_PUMP'
  ) then raise exception 'Choose a supplier assigned as a Fuel Pump.' using errcode = 'P4503'; end if;
  return new;
end;
$$;

create trigger vehicle_fuel_guard_update_delete
before update or delete on public.vehicle_fuel_records
for each row execute function public.guard_vehicle_fuel_mutation();
create trigger vehicle_fuel_expense_guard_update_delete
before update or delete on public.expense_records
for each row execute function public.guard_vehicle_fuel_expense_mutation();
create trigger vehicle_fuel_allocation_guard_insert
before insert on public.expense_payment_allocations
for each row execute function public.guard_vehicle_fuel_payment_allocation();
create trigger vehicle_fuel_require_pump_role
before insert or update on public.vehicle_fuel_records
for each row execute function public.require_fuel_pump_role();

create or replace function public.list_vehicle_fuel_records(
  p_factory_id uuid,
  p_vehicle_id uuid,
  p_pump_id uuid
)
returns setof public.vehicle_fuel_detail
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
  if p_vehicle_id is not null and not exists (
    select 1 from public.vehicles as requested_vehicle
    where requested_vehicle.id = p_vehicle_id and requested_vehicle.factory_id = p_factory_id
  ) then raise exception 'Vehicle does not belong to this factory.' using errcode = 'P4501'; end if;
  if p_pump_id is not null and not exists (
    select 1 from public.supplier_roles as requested_role
    where requested_role.supplier_id = p_pump_id
      and requested_role.factory_id = p_factory_id and requested_role.role = 'FUEL_PUMP'
  ) then raise exception 'Fuel Pump does not belong to this factory.' using errcode = 'P4503'; end if;
  return query select * from public.get_vehicle_fuel_details(
    p_factory_id, null, p_vehicle_id, p_pump_id
  );
end;
$$;

create or replace function public.get_previous_vehicle_refuel(
  p_factory_id uuid,
  p_vehicle_id uuid,
  p_before_date date,
  p_before_time time without time zone,
  p_exclude_fuel_record_id uuid
)
returns setof public.vehicle_fuel_detail
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
  if p_before_date is null or not isfinite(p_before_date) or p_before_time is null then
    raise exception 'Fuel date and time are required.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.vehicles as requested_vehicle
    where requested_vehicle.id = p_vehicle_id and requested_vehicle.factory_id = p_factory_id
  ) then raise exception 'Vehicle does not belong to this factory.' using errcode = 'P4501'; end if;
  return query
  select details.*
  from public.get_vehicle_fuel_details(p_factory_id, null, p_vehicle_id, null) as details
  where details.status = 'active'
    and details.id is distinct from p_exclude_fuel_record_id
    and (details.fuel_date < p_before_date
      or (details.fuel_date = p_before_date and details.fuel_time <= p_before_time))
  order by details.fuel_date desc, details.fuel_time desc, details.created_at desc, details.id desc
  limit 1;
end;
$$;

create or replace function public.create_vehicle_fuel(
  p_factory_id uuid,
  p_fuel_date date,
  p_fuel_time time without time zone,
  p_vehicle_id uuid,
  p_pump_id uuid,
  p_fuel_type text,
  p_litres numeric,
  p_rate_per_litre numeric,
  p_fuel_amount numeric,
  p_initial_paid_amount numeric,
  p_initial_payment_mode text
)
returns setof public.vehicle_fuel_detail
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  vehicle_row public.vehicles%rowtype;
  pump_row public.suppliers%rowtype;
  measurements public.vehicle_fuel_measurements;
  normalized_fuel_type text := upper(btrim(coalesce(p_fuel_type, '')));
  normalized_mode text := nullif(lower(btrim(coalesce(p_initial_payment_mode, ''))), '');
  fuel_record_id uuid := gen_random_uuid();
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users as authorized_user
    where authorized_user.user_id = auth.uid()
      and authorized_user.factory_id = p_factory_id and authorized_user.is_active = true
  ) then raise exception 'You do not have access to this factory.' using errcode = '42501'; end if;
  if p_fuel_date is null or not isfinite(p_fuel_date) or p_fuel_time is null then
    raise exception 'Fuel date and time are required.' using errcode = '22023';
  end if;
  if normalized_fuel_type not in ('DIESEL', 'PETROL') then
    raise exception 'Fuel Type must be Diesel or Petrol.' using errcode = '22023';
  end if;
  select * into vehicle_row from public.vehicles
  where id = p_vehicle_id and factory_id = p_factory_id for share;
  if not found then raise exception 'Vehicle does not belong to this factory.' using errcode = 'P4501'; end if;
  if not vehicle_row.is_active then
    raise exception 'Archived Vehicles cannot receive new Fuel entries.' using errcode = 'P4502';
  end if;
  select suppliers.* into pump_row
  from public.suppliers as suppliers
  join public.supplier_roles as roles
    on roles.supplier_id = suppliers.id and roles.factory_id = suppliers.factory_id
  where suppliers.id = p_pump_id and suppliers.factory_id = p_factory_id
    and roles.role = 'FUEL_PUMP';
  if not found then raise exception 'Choose a supplier assigned as a Fuel Pump.' using errcode = 'P4503'; end if;
  measurements := public.resolve_vehicle_fuel_measurements(p_litres, p_rate_per_litre, p_fuel_amount);
  if p_initial_paid_amount is null or p_initial_paid_amount < 0
    or p_initial_paid_amount = 'NaN'::numeric or p_initial_paid_amount = 'Infinity'::numeric
    or p_initial_paid_amount > measurements.fuel_amount
    or p_initial_paid_amount <> round(p_initial_paid_amount, 2) then
    raise exception 'Initial Paid must be between zero and Fuel Amount.' using errcode = '22023';
  end if;
  if (p_initial_paid_amount > 0 and normalized_mode not in ('cash', 'upi', 'bank_transfer', 'cheque', 'other'))
    or (p_initial_paid_amount = 0 and normalized_mode is not null) then
    raise exception 'Choose a payment mode only when Initial Paid is greater than zero.' using errcode = 'P3200';
  end if;

  insert into public.expense_records(
    id, factory_id, business_date, kind, supplier_id,
    counterparty_name_snapshot, counterparty_address_snapshot,
    counterparty_mobile_snapshot, description, total_amount, created_by
  ) values (
    fuel_record_id, p_factory_id, p_fuel_date, 'expense', p_pump_id,
    pump_row.name, pump_row.address, pump_row.mobile,
    format('%s fuel for %s', initcap(lower(normalized_fuel_type)), vehicle_row.vehicle_number),
    measurements.fuel_amount, auth.uid()
  );
  insert into public.vehicle_fuel_records(
    id, factory_id, vehicle_id, vehicle_number_snapshot, fuel_time,
    fuel_type, litres, rate_per_litre, created_by
  ) values (
    fuel_record_id, p_factory_id, p_vehicle_id, vehicle_row.vehicle_number,
    p_fuel_time, normalized_fuel_type, measurements.litres,
    measurements.rate_per_litre, auth.uid()
  );
  if p_initial_paid_amount > 0 then
    perform set_config('atlas.internal_vehicle_fuel_write', 'on', true);
    perform public.create_expense_payment(
      p_factory_id, p_fuel_date, p_initial_paid_amount, normalized_mode,
      'Initial Vehicle Fuel payment',
      jsonb_build_array(jsonb_build_object(
        'expense_record_id', fuel_record_id, 'amount', p_initial_paid_amount
      ))
    );
    perform set_config('atlas.internal_vehicle_fuel_write', 'off', true);
  end if;
  return query select * from public.get_vehicle_fuel_details(
    p_factory_id, fuel_record_id, null, null
  );
end;
$$;

create or replace function public.update_vehicle_fuel(
  p_factory_id uuid,
  p_fuel_record_id uuid,
  p_fuel_date date,
  p_fuel_time time without time zone,
  p_vehicle_id uuid,
  p_pump_id uuid,
  p_fuel_type text,
  p_litres numeric,
  p_rate_per_litre numeric,
  p_fuel_amount numeric
)
returns setof public.vehicle_fuel_detail
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_record public.expense_records%rowtype;
  fuel_row public.vehicle_fuel_records%rowtype;
  vehicle_row public.vehicles%rowtype;
  measurements public.vehicle_fuel_measurements;
  normalized_fuel_type text := upper(btrim(coalesce(p_fuel_type, '')));
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users as authorized_user
    where authorized_user.user_id = auth.uid()
      and authorized_user.factory_id = p_factory_id and authorized_user.is_active = true
  ) then raise exception 'You do not have access to this factory.' using errcode = '42501'; end if;
  select records.* into target_record
  from public.expense_records as records
  join public.vehicle_fuel_records as fuel
    on fuel.id = records.id and fuel.factory_id = records.factory_id
  where records.id = p_fuel_record_id and records.factory_id = p_factory_id
  for update of records;
  if not found then raise exception 'Fuel record does not belong to this factory.' using errcode = 'P4504'; end if;
  select * into fuel_row from public.vehicle_fuel_records
  where id = p_fuel_record_id and factory_id = p_factory_id for update;
  if target_record.status <> 'active' or target_record.is_locked then
    raise exception 'Paid or void Fuel records cannot be changed.' using errcode = 'P4104';
  end if;
  if p_fuel_date is null or not isfinite(p_fuel_date) or p_fuel_time is null
    or normalized_fuel_type not in ('DIESEL', 'PETROL') then
    raise exception 'Fuel date, time, and Diesel/Petrol type are required.' using errcode = '22023';
  end if;
  if p_vehicle_id = fuel_row.vehicle_id then
    vehicle_row.id := fuel_row.vehicle_id;
    vehicle_row.vehicle_number := fuel_row.vehicle_number_snapshot;
  else
    select * into vehicle_row from public.vehicles
    where id = p_vehicle_id and factory_id = p_factory_id for share;
    if not found then raise exception 'Vehicle does not belong to this factory.' using errcode = 'P4501'; end if;
    if not vehicle_row.is_active then
      raise exception 'Archived Vehicles cannot receive new Fuel entries.' using errcode = 'P4502';
    end if;
  end if;
  if not exists (
    select 1 from public.supplier_roles
    where supplier_id = p_pump_id and factory_id = p_factory_id and role = 'FUEL_PUMP'
  ) then raise exception 'Choose a supplier assigned as a Fuel Pump.' using errcode = 'P4503'; end if;
  measurements := public.resolve_vehicle_fuel_measurements(p_litres, p_rate_per_litre, p_fuel_amount);

  perform set_config('atlas.internal_vehicle_fuel_write', 'on', true);
  perform public.update_expense_record(
    p_factory_id, p_fuel_record_id, p_fuel_date, 'expense', p_pump_id,
    null, format('%s fuel for %s', initcap(lower(normalized_fuel_type)), vehicle_row.vehicle_number),
    measurements.fuel_amount, null
  );
  update public.vehicle_fuel_records
  set vehicle_id = p_vehicle_id,
      vehicle_number_snapshot = vehicle_row.vehicle_number,
      fuel_time = p_fuel_time,
      fuel_type = normalized_fuel_type,
      litres = measurements.litres,
      rate_per_litre = measurements.rate_per_litre
  where id = p_fuel_record_id and factory_id = p_factory_id;
  perform set_config('atlas.internal_vehicle_fuel_write', 'off', true);
  return query select * from public.get_vehicle_fuel_details(
    p_factory_id, p_fuel_record_id, null, null
  );
end;
$$;

create or replace function public.void_vehicle_fuel(
  p_factory_id uuid,
  p_fuel_record_id uuid
)
returns setof public.vehicle_fuel_detail
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users as authorized_user
    where authorized_user.user_id = auth.uid()
      and authorized_user.factory_id = p_factory_id and authorized_user.is_active = true
  ) then raise exception 'You do not have access to this factory.' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.vehicle_fuel_records
    where id = p_fuel_record_id and factory_id = p_factory_id
  ) then raise exception 'Fuel record does not belong to this factory.' using errcode = 'P4504'; end if;
  perform set_config('atlas.internal_vehicle_fuel_write', 'on', true);
  perform public.void_expense_record(p_factory_id, p_fuel_record_id);
  perform set_config('atlas.internal_vehicle_fuel_write', 'off', true);
  return query select * from public.get_vehicle_fuel_details(
    p_factory_id, p_fuel_record_id, null, null
  );
end;
$$;

create or replace function public.create_vehicle_fuel_payment(
  p_factory_id uuid,
  p_fuel_record_id uuid,
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
    select 1 from public.factory_users as authorized_user
    where authorized_user.user_id = auth.uid()
      and authorized_user.factory_id = p_factory_id and authorized_user.is_active = true
  ) then raise exception 'You do not have access to this factory.' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.vehicle_fuel_records
    where id = p_fuel_record_id and factory_id = p_factory_id
  ) then raise exception 'Fuel record does not belong to this factory.' using errcode = 'P4504'; end if;
  perform set_config('atlas.internal_vehicle_fuel_write', 'on', true);
  select * into saved_payment from public.create_expense_payment(
    p_factory_id, p_payment_date, p_amount, p_payment_mode, p_note,
    jsonb_build_array(jsonb_build_object(
      'expense_record_id', p_fuel_record_id, 'amount', p_amount
    ))
  );
  perform set_config('atlas.internal_vehicle_fuel_write', 'off', true);
  return saved_payment;
end;
$$;

create or replace function public.list_vehicle_fuel_payments(
  p_factory_id uuid,
  p_vehicle_id uuid,
  p_pump_id uuid
)
returns table (
  payment_id uuid,
  factory_id uuid,
  fuel_record_id uuid,
  vehicle_id uuid,
  vehicle_number_snapshot text,
  pump_id uuid,
  pump_name_snapshot text,
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
    select 1 from public.factory_users as authorized_user
    where authorized_user.user_id = auth.uid()
      and authorized_user.factory_id = p_factory_id and authorized_user.is_active = true
  ) then raise exception 'You do not have access to this factory.' using errcode = '42501'; end if;
  if p_vehicle_id is not null and not exists (
    select 1 from public.vehicles as requested_vehicle
    where requested_vehicle.id = p_vehicle_id and requested_vehicle.factory_id = p_factory_id
  ) then raise exception 'Vehicle does not belong to this factory.' using errcode = 'P4501'; end if;
  if p_pump_id is not null and not exists (
    select 1 from public.supplier_roles as requested_pump
    where requested_pump.supplier_id = p_pump_id
      and requested_pump.factory_id = p_factory_id and requested_pump.role = 'FUEL_PUMP'
  ) then raise exception 'Fuel Pump does not belong to this factory.' using errcode = 'P4503'; end if;
  return query
  select payments.id, payments.factory_id, fuel.id,
    fuel.vehicle_id, fuel.vehicle_number_snapshot,
    records.supplier_id, records.counterparty_name_snapshot,
    payments.payment_date, allocations.allocated_amount,
    payments.payment_mode, payments.note, payments.created_at
  from public.expense_payment_allocations as allocations
  join public.expense_payments as payments
    on payments.id = allocations.payment_id and payments.factory_id = allocations.factory_id
  join public.vehicle_fuel_records as fuel
    on fuel.id = allocations.expense_record_id and fuel.factory_id = allocations.factory_id
  join public.expense_records as records
    on records.id = fuel.id and records.factory_id = fuel.factory_id
  where fuel.factory_id = p_factory_id
    and (p_vehicle_id is null or fuel.vehicle_id = p_vehicle_id)
    and (p_pump_id is null or records.supplier_id = p_pump_id)
  order by payments.payment_date desc, payments.created_at desc, payments.id desc;
end;
$$;

create or replace function public.list_suppliers_by_role(
  p_factory_id uuid,
  p_role text
)
returns setof public.suppliers
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_role text := upper(btrim(coalesce(p_role, '')));
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then raise exception 'You do not have access to this factory.' using errcode = '42501'; end if;
  if normalized_role not in ('COAL_SELLER', 'GARAGE', 'FUEL_PUMP') then
    raise exception 'Supplier role is invalid.' using errcode = 'P4401';
  end if;
  return query
  select suppliers.*
  from public.supplier_roles as roles
  join public.suppliers as suppliers
    on suppliers.id = roles.supplier_id and suppliers.factory_id = roles.factory_id
  where roles.factory_id = p_factory_id and roles.role = normalized_role
  order by suppliers.name, suppliers.id;
end;
$$;

create or replace function public.create_or_assign_supplier_role(
  p_factory_id uuid,
  p_role text,
  p_name text,
  p_address text,
  p_mobile text
)
returns public.suppliers
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_role text := upper(btrim(coalesce(p_role, '')));
  normalized_name text := btrim(regexp_replace(coalesce(p_name, ''), '[[:space:]]+', ' ', 'g'));
  normalized_address text := nullif(btrim(regexp_replace(coalesce(p_address, ''), '[[:space:]]+', ' ', 'g')), '');
  normalized_mobile text := nullif(btrim(regexp_replace(coalesce(p_mobile, ''), '[[:space:]]+', ' ', 'g')), '');
  matching_ids uuid[];
  saved_supplier public.suppliers%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then raise exception 'You do not have access to this factory.' using errcode = '42501'; end if;
  if normalized_role not in ('COAL_SELLER', 'GARAGE', 'FUEL_PUMP') then
    raise exception 'Supplier role is invalid.' using errcode = 'P4401';
  end if;
  if normalized_name = '' or length(normalized_name) > 200 or normalized_name ~ '[[:cntrl:]]' then
    raise exception 'Supplier name is required and must be at most 200 characters.' using errcode = '22023';
  end if;
  if normalized_address is not null
    and (length(normalized_address) > 500 or normalized_address ~ '[[:cntrl:]]') then
    raise exception 'Supplier address must be at most 500 characters.' using errcode = '22023';
  end if;
  if normalized_mobile is not null
    and (length(normalized_mobile) > 50 or normalized_mobile ~ '[[:cntrl:]]') then
    raise exception 'Supplier mobile must be at most 50 characters.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_factory_id::text || ':' || lower(normalized_name), 0
  ));
  select array_agg(suppliers.id order by suppliers.created_at, suppliers.id)
  into matching_ids
  from public.suppliers
  where suppliers.factory_id = p_factory_id
    and lower(suppliers.name) = lower(normalized_name);
  if coalesce(cardinality(matching_ids), 0) > 1 then
    raise exception 'Multiple suppliers already use this name. Select an existing supplier before assigning a role.'
      using errcode = 'P4404';
  elsif coalesce(cardinality(matching_ids), 0) = 1 then
    select * into saved_supplier from public.suppliers where id = matching_ids[1];
  else
    insert into public.suppliers(factory_id, name, address, mobile)
    values (p_factory_id, normalized_name, normalized_address, normalized_mobile)
    returning * into saved_supplier;
  end if;
  insert into public.supplier_roles(factory_id, supplier_id, role, created_by)
  values (p_factory_id, saved_supplier.id, normalized_role, auth.uid())
  on conflict (supplier_id, role) do nothing;
  return saved_supplier;
end;
$$;

-- Keep all dedicated operational obligations out of the generic Expense editor.
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
      where coal_purchases.id = records.id and coal_purchases.factory_id = records.factory_id
    )
    and not exists (
      select 1 from public.vehicle_maintenance_records
      where vehicle_maintenance_records.id = records.id
        and vehicle_maintenance_records.factory_id = records.factory_id
    )
    and not exists (
      select 1 from public.vehicle_fuel_records
      where vehicle_fuel_records.id = records.id
        and vehicle_fuel_records.factory_id = records.factory_id
    )
  order by records.business_date desc, records.created_at desc, records.id desc;
end;
$$;

revoke all on function public.resolve_vehicle_fuel_measurements(numeric, numeric, numeric) from public, anon, authenticated;
revoke all on function public.get_vehicle_fuel_details(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.guard_vehicle_fuel_mutation() from public, anon, authenticated;
revoke all on function public.guard_vehicle_fuel_expense_mutation() from public, anon, authenticated;
revoke all on function public.guard_vehicle_fuel_payment_allocation() from public, anon, authenticated;
revoke all on function public.require_fuel_pump_role() from public, anon, authenticated;
revoke all on function public.list_vehicle_fuel_records(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.list_vehicle_fuel_records(uuid, uuid, uuid) to authenticated;
revoke all on function public.get_previous_vehicle_refuel(uuid, uuid, date, time without time zone, uuid) from public, anon, authenticated;
grant execute on function public.get_previous_vehicle_refuel(uuid, uuid, date, time without time zone, uuid) to authenticated;
revoke all on function public.create_vehicle_fuel(uuid, date, time without time zone, uuid, uuid, text, numeric, numeric, numeric, numeric, text) from public, anon, authenticated;
grant execute on function public.create_vehicle_fuel(uuid, date, time without time zone, uuid, uuid, text, numeric, numeric, numeric, numeric, text) to authenticated;
revoke all on function public.update_vehicle_fuel(uuid, uuid, date, time without time zone, uuid, uuid, text, numeric, numeric, numeric) from public, anon, authenticated;
grant execute on function public.update_vehicle_fuel(uuid, uuid, date, time without time zone, uuid, uuid, text, numeric, numeric, numeric) to authenticated;
revoke all on function public.void_vehicle_fuel(uuid, uuid) from public, anon, authenticated;
grant execute on function public.void_vehicle_fuel(uuid, uuid) to authenticated;
revoke all on function public.create_vehicle_fuel_payment(uuid, uuid, date, numeric, text, text) from public, anon, authenticated;
grant execute on function public.create_vehicle_fuel_payment(uuid, uuid, date, numeric, text, text) to authenticated;
revoke all on function public.list_vehicle_fuel_payments(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.list_vehicle_fuel_payments(uuid, uuid, uuid) to authenticated;
revoke all on function public.list_suppliers_by_role(uuid, text) from public, anon, authenticated;
grant execute on function public.list_suppliers_by_role(uuid, text) to authenticated;
revoke all on function public.create_or_assign_supplier_role(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_or_assign_supplier_role(uuid, text, text, text, text) to authenticated;
revoke all on function public.list_expense_records(uuid, uuid) from public, anon, authenticated;
grant execute on function public.list_expense_records(uuid, uuid) to authenticated;

comment on table public.vehicle_fuel_records is
  'Structured Vehicle Fuel extension keyed one-to-one by its shared expense-record UUID.';
comment on column public.vehicle_fuel_records.fuel_time is
  'Factory-local wall-clock refuel time; deliberately stored without timezone conversion.';
comment on function public.create_vehicle_fuel(uuid, date, time without time zone, uuid, uuid, text, numeric, numeric, numeric, numeric, text) is
  'Atomically creates a Fuel Book record, Pump obligation, and optional initial payment.';
comment on function public.get_previous_vehicle_refuel(uuid, uuid, date, time without time zone, uuid) is
  'Returns the latest active persisted refuel for one Vehicle at or before the candidate local date/time.';
comment on function public.list_expense_records(uuid, uuid) is
  'Lists generic Expense/Purchase records only; Coal, Vehicle Maintenance, and Vehicle Fuel remain dedicated.';

commit;
