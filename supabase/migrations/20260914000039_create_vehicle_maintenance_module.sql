-- Atlas dedicated Vehicle Maintenance Book. Structured maintenance operations
-- reuse Vehicle Master, suppliers, expense obligations, payments, and Cash Book.

begin;

create table public.vehicle_maintenance_records (
  id uuid primary key,
  factory_id uuid not null references public.factories(id) on delete restrict,
  vehicle_id uuid not null,
  vehicle_number_snapshot text not null,
  work_description text not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  constraint vehicle_maintenance_records_id_factory_key unique (id, factory_id),
  constraint vehicle_maintenance_records_expense_factory_fkey
    foreign key (id, factory_id)
    references public.expense_records(id, factory_id) on delete restrict,
  constraint vehicle_maintenance_records_vehicle_factory_fkey
    foreign key (vehicle_id, factory_id)
    references public.vehicles(id, factory_id) on delete restrict,
  constraint vehicle_maintenance_records_vehicle_snapshot_check check (
    vehicle_number_snapshot <> ''
    and vehicle_number_snapshot = upper(vehicle_number_snapshot)
    and vehicle_number_snapshot = btrim(vehicle_number_snapshot)
    and vehicle_number_snapshot = regexp_replace(vehicle_number_snapshot, '[[:space:]]+', ' ', 'g')
    and length(vehicle_number_snapshot) <= 100
    and vehicle_number_snapshot !~ '[[:cntrl:]]'
  ),
  constraint vehicle_maintenance_records_work_check check (
    work_description <> ''
    and work_description = btrim(work_description)
    and work_description = regexp_replace(work_description, '[[:space:]]+', ' ', 'g')
    and length(work_description) <= 300
    and work_description !~ '[[:cntrl:]]'
  )
);

create index vehicle_maintenance_factory_date_idx
  on public.vehicle_maintenance_records(factory_id, created_at desc, id desc);
create index vehicle_maintenance_factory_vehicle_idx
  on public.vehicle_maintenance_records(factory_id, vehicle_id, created_at desc, id desc);

alter table public.vehicle_maintenance_records enable row level security;
revoke all on public.vehicle_maintenance_records from public, anon, authenticated;
grant select on public.vehicle_maintenance_records to authenticated;

create policy "Authenticated users can read their factory Vehicle Maintenance"
  on public.vehicle_maintenance_records for select to authenticated
  using (exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = vehicle_maintenance_records.factory_id
      and factory_users.is_active = true
  ));

create type public.vehicle_maintenance_detail as (
  id uuid,
  factory_id uuid,
  maintenance_date date,
  vehicle_id uuid,
  vehicle_number_snapshot text,
  garage_id uuid,
  garage_name_snapshot text,
  garage_address_snapshot text,
  garage_mobile_snapshot text,
  work_description text,
  total_amount numeric,
  status text,
  is_locked boolean,
  total_paid numeric,
  outstanding_amount numeric,
  payment_state text,
  voided_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
);

create or replace function public.get_vehicle_maintenance_details(
  p_factory_id uuid,
  p_maintenance_id uuid,
  p_vehicle_id uuid,
  p_garage_id uuid
)
returns setof public.vehicle_maintenance_detail
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select row(
    maintenance.id, maintenance.factory_id, records.business_date,
    maintenance.vehicle_id, maintenance.vehicle_number_snapshot,
    records.supplier_id, records.counterparty_name_snapshot,
    records.counterparty_address_snapshot, records.counterparty_mobile_snapshot,
    maintenance.work_description, records.total_amount,
    records.status, records.is_locked, coalesce(paid.total_paid, 0),
    case when records.status = 'active'
      then records.total_amount - coalesce(paid.total_paid, 0) else 0 end,
    case
      when coalesce(paid.total_paid, 0) = 0 then 'unpaid'
      when coalesce(paid.total_paid, 0) < records.total_amount then 'partially_paid'
      else 'paid'
    end,
    records.voided_at, records.created_at, records.updated_at
  )::public.vehicle_maintenance_detail
  from public.vehicle_maintenance_records as maintenance
  join public.expense_records as records
    on records.id = maintenance.id and records.factory_id = maintenance.factory_id
  left join lateral (
    select coalesce(sum(allocations.allocated_amount), 0) as total_paid
    from public.expense_payment_allocations as allocations
    where allocations.factory_id = maintenance.factory_id
      and allocations.expense_record_id = maintenance.id
  ) as paid on true
  where maintenance.factory_id = p_factory_id
    and (p_maintenance_id is null or maintenance.id = p_maintenance_id)
    and (p_vehicle_id is null or maintenance.vehicle_id = p_vehicle_id)
    and (p_garage_id is null or records.supplier_id = p_garage_id)
  order by records.business_date desc, records.created_at desc, maintenance.id desc;
$$;

create or replace function public.guard_vehicle_maintenance_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Vehicle Maintenance history cannot be deleted.' using errcode = 'P4305';
  end if;
  if current_setting('atlas.internal_vehicle_maintenance_write', true) is distinct from 'on' then
    raise exception 'Vehicle Maintenance can only change through its dedicated controls.'
      using errcode = 'P4305';
  end if;
  if new.id <> old.id or new.factory_id <> old.factory_id
    or new.created_at <> old.created_at or new.created_by <> old.created_by then
    raise exception 'Permanent Vehicle Maintenance identity cannot be changed.' using errcode = 'P4305';
  end if;
  return new;
end;
$$;

create or replace function public.guard_vehicle_maintenance_expense_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if exists (
    select 1 from public.vehicle_maintenance_records
    where vehicle_maintenance_records.id = old.id
      and vehicle_maintenance_records.factory_id = old.factory_id
  ) and current_setting('atlas.internal_vehicle_maintenance_write', true) is distinct from 'on' then
    raise exception 'Vehicle Maintenance financial sources can only change through dedicated controls.'
      using errcode = 'P4305';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.guard_vehicle_maintenance_payment_allocation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if exists (
    select 1 from public.vehicle_maintenance_records
    where vehicle_maintenance_records.id = new.expense_record_id
      and vehicle_maintenance_records.factory_id = new.factory_id
  ) and current_setting('atlas.internal_vehicle_maintenance_write', true) is distinct from 'on' then
    raise exception 'Vehicle Maintenance payments must use the dedicated payment control.'
      using errcode = 'P4305';
  end if;
  return new;
end;
$$;

create trigger vehicle_maintenance_guard_update_delete
before update or delete on public.vehicle_maintenance_records
for each row execute function public.guard_vehicle_maintenance_mutation();
create trigger vehicle_maintenance_expense_guard_update_delete
before update or delete on public.expense_records
for each row execute function public.guard_vehicle_maintenance_expense_mutation();
create trigger vehicle_maintenance_allocation_guard_insert
before insert on public.expense_payment_allocations
for each row execute function public.guard_vehicle_maintenance_payment_allocation();

create or replace function public.list_vehicle_maintenance_records(
  p_factory_id uuid,
  p_vehicle_id uuid,
  p_garage_id uuid
)
returns setof public.vehicle_maintenance_detail
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
  if p_vehicle_id is not null and not exists (
    select 1 from public.vehicles where id = p_vehicle_id and factory_id = p_factory_id
  ) then raise exception 'Vehicle does not belong to this factory.' using errcode = 'P4301'; end if;
  if p_garage_id is not null and not exists (
    select 1 from public.suppliers where id = p_garage_id and factory_id = p_factory_id
  ) then raise exception 'Garage does not belong to this factory.' using errcode = 'P4303'; end if;
  return query select * from public.get_vehicle_maintenance_details(
    p_factory_id, null, p_vehicle_id, p_garage_id
  );
end;
$$;

create or replace function public.create_vehicle_maintenance(
  p_factory_id uuid,
  p_maintenance_date date,
  p_vehicle_id uuid,
  p_garage_id uuid,
  p_work_description text,
  p_total_amount numeric,
  p_initial_paid_amount numeric,
  p_initial_payment_mode text
)
returns setof public.vehicle_maintenance_detail
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  vehicle_row public.vehicles%rowtype;
  garage_row public.suppliers%rowtype;
  normalized_work text := btrim(regexp_replace(coalesce(p_work_description, ''), '[[:space:]]+', ' ', 'g'));
  normalized_mode text := nullif(lower(btrim(coalesce(p_initial_payment_mode, ''))), '');
  maintenance_id uuid := gen_random_uuid();
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then raise exception 'You do not have access to this factory.' using errcode = '42501'; end if;
  if p_maintenance_date is null or not isfinite(p_maintenance_date) then
    raise exception 'Maintenance date must be a finite calendar date.' using errcode = '22023';
  end if;
  select * into vehicle_row from public.vehicles
  where id = p_vehicle_id and factory_id = p_factory_id for share;
  if not found then raise exception 'Vehicle does not belong to this factory.' using errcode = 'P4301'; end if;
  if not vehicle_row.is_active then
    raise exception 'Archived Vehicles cannot receive new Maintenance.' using errcode = 'P4302';
  end if;
  select * into garage_row from public.suppliers
  where id = p_garage_id and factory_id = p_factory_id;
  if not found then raise exception 'Garage does not belong to this factory.' using errcode = 'P4303'; end if;
  if normalized_work = '' or length(normalized_work) > 300 or normalized_work ~ '[[:cntrl:]]' then
    raise exception 'Work / Repair is required and must be at most 300 characters.' using errcode = '22023';
  end if;
  if p_total_amount is null or p_total_amount <= 0
    or p_total_amount = 'NaN'::numeric or p_total_amount = 'Infinity'::numeric
    or p_total_amount >= 10000000000000000 or p_total_amount <> round(p_total_amount, 2) then
    raise exception 'Maintenance amount must be positive and use at most two decimal places.' using errcode = '22023';
  end if;
  if p_initial_paid_amount is null or p_initial_paid_amount < 0
    or p_initial_paid_amount = 'NaN'::numeric or p_initial_paid_amount = 'Infinity'::numeric
    or p_initial_paid_amount > p_total_amount
    or p_initial_paid_amount <> round(p_initial_paid_amount, 2) then
    raise exception 'Initial Paid must be between zero and Maintenance amount.' using errcode = '22023';
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
    maintenance_id, p_factory_id, p_maintenance_date, 'expense', p_garage_id,
    garage_row.name, garage_row.address, garage_row.mobile,
    normalized_work, p_total_amount, auth.uid()
  );
  insert into public.vehicle_maintenance_records(
    id, factory_id, vehicle_id, vehicle_number_snapshot,
    work_description, created_by
  ) values (
    maintenance_id, p_factory_id, p_vehicle_id, vehicle_row.vehicle_number,
    normalized_work, auth.uid()
  );
  if p_initial_paid_amount > 0 then
    perform set_config('atlas.internal_vehicle_maintenance_write', 'on', true);
    perform public.create_expense_payment(
      p_factory_id, p_maintenance_date, p_initial_paid_amount, normalized_mode,
      'Initial Vehicle Maintenance payment',
      jsonb_build_array(jsonb_build_object(
        'expense_record_id', maintenance_id, 'amount', p_initial_paid_amount
      ))
    );
    perform set_config('atlas.internal_vehicle_maintenance_write', 'off', true);
  end if;
  return query select * from public.get_vehicle_maintenance_details(
    p_factory_id, maintenance_id, null, null
  );
end;
$$;

create or replace function public.update_vehicle_maintenance(
  p_factory_id uuid,
  p_maintenance_id uuid,
  p_maintenance_date date,
  p_vehicle_id uuid,
  p_garage_id uuid,
  p_work_description text,
  p_total_amount numeric
)
returns setof public.vehicle_maintenance_detail
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_record public.expense_records%rowtype;
  maintenance_row public.vehicle_maintenance_records%rowtype;
  vehicle_row public.vehicles%rowtype;
  normalized_work text := btrim(regexp_replace(coalesce(p_work_description, ''), '[[:space:]]+', ' ', 'g'));
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then raise exception 'You do not have access to this factory.' using errcode = '42501'; end if;
  select records.* into target_record
  from public.expense_records as records
  join public.vehicle_maintenance_records as maintenance
    on maintenance.id = records.id and maintenance.factory_id = records.factory_id
  where records.id = p_maintenance_id and records.factory_id = p_factory_id
  for update of records;
  if not found then raise exception 'Vehicle Maintenance does not belong to this factory.' using errcode = 'P4304'; end if;
  select * into maintenance_row
  from public.vehicle_maintenance_records
  where id = p_maintenance_id and factory_id = p_factory_id
  for update;
  if target_record.status <> 'active' or target_record.is_locked then
    raise exception 'Paid or void Vehicle Maintenance cannot be changed.' using errcode = 'P4104';
  end if;
  if p_maintenance_date is null or not isfinite(p_maintenance_date) then
    raise exception 'Maintenance date must be a finite calendar date.' using errcode = '22023';
  end if;
  if p_vehicle_id = maintenance_row.vehicle_id then
    vehicle_row.id := maintenance_row.vehicle_id;
    vehicle_row.vehicle_number := maintenance_row.vehicle_number_snapshot;
  else
    select * into vehicle_row from public.vehicles
    where id = p_vehicle_id and factory_id = p_factory_id for share;
    if not found then raise exception 'Vehicle does not belong to this factory.' using errcode = 'P4301'; end if;
    if not vehicle_row.is_active then
      raise exception 'Archived Vehicles cannot receive new Maintenance.' using errcode = 'P4302';
    end if;
  end if;
  if not exists (select 1 from public.suppliers where id = p_garage_id and factory_id = p_factory_id) then
    raise exception 'Garage does not belong to this factory.' using errcode = 'P4303';
  end if;
  if normalized_work = '' or length(normalized_work) > 300 or normalized_work ~ '[[:cntrl:]]' then
    raise exception 'Work / Repair is required and must be at most 300 characters.' using errcode = '22023';
  end if;
  if p_total_amount is null or p_total_amount <= 0
    or p_total_amount = 'NaN'::numeric or p_total_amount = 'Infinity'::numeric
    or p_total_amount >= 10000000000000000 or p_total_amount <> round(p_total_amount, 2) then
    raise exception 'Maintenance amount must be positive and use at most two decimal places.' using errcode = '22023';
  end if;

  perform set_config('atlas.internal_vehicle_maintenance_write', 'on', true);
  perform public.update_expense_record(
    p_factory_id, p_maintenance_id, p_maintenance_date, 'expense', p_garage_id,
    null, normalized_work, p_total_amount, null
  );
  update public.vehicle_maintenance_records
  set vehicle_id = p_vehicle_id,
      vehicle_number_snapshot = vehicle_row.vehicle_number,
      work_description = normalized_work
  where id = p_maintenance_id and factory_id = p_factory_id;
  perform set_config('atlas.internal_vehicle_maintenance_write', 'off', true);
  return query select * from public.get_vehicle_maintenance_details(
    p_factory_id, p_maintenance_id, null, null
  );
end;
$$;

create or replace function public.void_vehicle_maintenance(
  p_factory_id uuid,
  p_maintenance_id uuid
)
returns setof public.vehicle_maintenance_detail
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
    select 1 from public.vehicle_maintenance_records
    where id = p_maintenance_id and factory_id = p_factory_id
  ) then raise exception 'Vehicle Maintenance does not belong to this factory.' using errcode = 'P4304'; end if;
  perform set_config('atlas.internal_vehicle_maintenance_write', 'on', true);
  perform public.void_expense_record(p_factory_id, p_maintenance_id);
  perform set_config('atlas.internal_vehicle_maintenance_write', 'off', true);
  return query select * from public.get_vehicle_maintenance_details(
    p_factory_id, p_maintenance_id, null, null
  );
end;
$$;

create or replace function public.create_vehicle_maintenance_payment(
  p_factory_id uuid,
  p_maintenance_id uuid,
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
    select 1 from public.vehicle_maintenance_records
    where id = p_maintenance_id and factory_id = p_factory_id
  ) then raise exception 'Vehicle Maintenance does not belong to this factory.' using errcode = 'P4304'; end if;
  perform set_config('atlas.internal_vehicle_maintenance_write', 'on', true);
  select * into saved_payment from public.create_expense_payment(
    p_factory_id, p_payment_date, p_amount, p_payment_mode, p_note,
    jsonb_build_array(jsonb_build_object(
      'expense_record_id', p_maintenance_id, 'amount', p_amount
    ))
  );
  perform set_config('atlas.internal_vehicle_maintenance_write', 'off', true);
  return saved_payment;
end;
$$;

create or replace function public.list_vehicle_maintenance_payments(
  p_factory_id uuid,
  p_vehicle_id uuid,
  p_garage_id uuid
)
returns table (
  payment_id uuid,
  factory_id uuid,
  maintenance_id uuid,
  vehicle_id uuid,
  vehicle_number_snapshot text,
  garage_id uuid,
  garage_name_snapshot text,
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
  if p_vehicle_id is not null and not exists (
    select 1 from public.vehicles where id = p_vehicle_id and factory_id = p_factory_id
  ) then raise exception 'Vehicle does not belong to this factory.' using errcode = 'P4301'; end if;
  if p_garage_id is not null and not exists (
    select 1 from public.suppliers where id = p_garage_id and factory_id = p_factory_id
  ) then raise exception 'Garage does not belong to this factory.' using errcode = 'P4303'; end if;
  return query
  select payments.id, payments.factory_id, maintenance.id,
    maintenance.vehicle_id, maintenance.vehicle_number_snapshot,
    records.supplier_id, records.counterparty_name_snapshot,
    payments.payment_date, allocations.allocated_amount,
    payments.payment_mode, payments.note, payments.created_at
  from public.expense_payment_allocations as allocations
  join public.expense_payments as payments
    on payments.id = allocations.payment_id
    and payments.factory_id = allocations.factory_id
  join public.vehicle_maintenance_records as maintenance
    on maintenance.id = allocations.expense_record_id
    and maintenance.factory_id = allocations.factory_id
  join public.expense_records as records
    on records.id = maintenance.id and records.factory_id = maintenance.factory_id
  where maintenance.factory_id = p_factory_id
    and (p_vehicle_id is null or maintenance.vehicle_id = p_vehicle_id)
    and (p_garage_id is null or records.supplier_id = p_garage_id)
  order by payments.payment_date desc, payments.created_at desc, payments.id desc;
end;
$$;

-- Keep structured Coal and Vehicle Maintenance obligations out of the generic editor.
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
    and not exists (
      select 1 from public.vehicle_maintenance_records
      where vehicle_maintenance_records.id = records.id
        and vehicle_maintenance_records.factory_id = records.factory_id
    )
  order by records.business_date desc, records.created_at desc, records.id desc;
end;
$$;

revoke all on function public.get_vehicle_maintenance_details(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.guard_vehicle_maintenance_mutation()
  from public, anon, authenticated;
revoke all on function public.guard_vehicle_maintenance_expense_mutation()
  from public, anon, authenticated;
revoke all on function public.guard_vehicle_maintenance_payment_allocation()
  from public, anon, authenticated;

revoke all on function public.list_vehicle_maintenance_records(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.list_vehicle_maintenance_records(uuid, uuid, uuid)
  to authenticated;
revoke all on function public.create_vehicle_maintenance(
  uuid, date, uuid, uuid, text, numeric, numeric, text
) from public, anon, authenticated;
grant execute on function public.create_vehicle_maintenance(
  uuid, date, uuid, uuid, text, numeric, numeric, text
) to authenticated;
revoke all on function public.update_vehicle_maintenance(
  uuid, uuid, date, uuid, uuid, text, numeric
) from public, anon, authenticated;
grant execute on function public.update_vehicle_maintenance(
  uuid, uuid, date, uuid, uuid, text, numeric
) to authenticated;
revoke all on function public.void_vehicle_maintenance(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.void_vehicle_maintenance(uuid, uuid) to authenticated;
revoke all on function public.create_vehicle_maintenance_payment(
  uuid, uuid, date, numeric, text, text
) from public, anon, authenticated;
grant execute on function public.create_vehicle_maintenance_payment(
  uuid, uuid, date, numeric, text, text
) to authenticated;
revoke all on function public.list_vehicle_maintenance_payments(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.list_vehicle_maintenance_payments(uuid, uuid, uuid)
  to authenticated;
revoke all on function public.list_expense_records(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.list_expense_records(uuid, uuid) to authenticated;

comment on table public.vehicle_maintenance_records is
  'Structured Vehicle Maintenance extension keyed one-to-one by its shared expense-record UUID.';
comment on function public.create_vehicle_maintenance(
  uuid, date, uuid, uuid, text, numeric, numeric, text
) is
  'Atomically creates a Vehicle Maintenance job, Garage obligation, and optional initial payment.';
comment on function public.create_vehicle_maintenance_payment(
  uuid, uuid, date, numeric, text, text
) is
  'Routes one Garage payment through shared immutable expense-payment and Cash Book authority.';
comment on function public.list_expense_records(uuid, uuid) is
  'Lists generic Expense/Purchase records only; Coal and Vehicle Maintenance remain dedicated.';

commit;
