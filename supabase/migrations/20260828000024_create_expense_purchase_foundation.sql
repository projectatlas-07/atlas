-- Atlas S7A: Expenses & Purchases source records, outgoing payments, and Cash Book integration.

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  name text not null,
  address text,
  mobile text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint suppliers_id_factory_key unique (id, factory_id),
  constraint suppliers_name_check check (
    name <> '' and name = btrim(name)
    and name = regexp_replace(name, '[[:space:]]+', ' ', 'g')
    and length(name) <= 200 and name !~ '[[:cntrl:]]'
  ),
  constraint suppliers_address_check check (
    address is null or (
      address <> '' and address = btrim(address)
      and address = regexp_replace(address, '[[:space:]]+', ' ', 'g')
      and length(address) <= 500 and address !~ '[[:cntrl:]]'
    )
  ),
  constraint suppliers_mobile_check check (
    mobile is null or (
      mobile <> '' and mobile = btrim(mobile)
      and length(mobile) <= 50 and mobile !~ '[[:cntrl:]]'
    )
  )
);

create table public.expense_records (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  business_date date not null,
  kind text not null,
  supplier_id uuid,
  counterparty_name_snapshot text not null,
  counterparty_address_snapshot text,
  counterparty_mobile_snapshot text,
  description text not null,
  total_amount numeric(18, 2) not null,
  note text,
  status text not null default 'active',
  is_locked boolean not null default false,
  voided_at timestamptz,
  voided_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null,
  constraint expense_records_id_factory_key unique (id, factory_id),
  constraint expense_records_supplier_factory_fkey
    foreign key (supplier_id, factory_id)
    references public.suppliers(id, factory_id) on delete restrict,
  constraint expense_records_date_check check (isfinite(business_date)),
  constraint expense_records_kind_check check (kind in ('purchase', 'expense')),
  constraint expense_records_counterparty_name_check check (
    counterparty_name_snapshot <> ''
    and counterparty_name_snapshot = btrim(counterparty_name_snapshot)
    and counterparty_name_snapshot = regexp_replace(
      counterparty_name_snapshot, '[[:space:]]+', ' ', 'g'
    )
    and length(counterparty_name_snapshot) <= 200
    and counterparty_name_snapshot !~ '[[:cntrl:]]'
  ),
  constraint expense_records_counterparty_address_check check (
    counterparty_address_snapshot is null or (
      counterparty_address_snapshot <> ''
      and counterparty_address_snapshot = btrim(counterparty_address_snapshot)
      and length(counterparty_address_snapshot) <= 500
      and counterparty_address_snapshot !~ '[[:cntrl:]]'
    )
  ),
  constraint expense_records_counterparty_mobile_check check (
    counterparty_mobile_snapshot is null or (
      counterparty_mobile_snapshot <> ''
      and counterparty_mobile_snapshot = btrim(counterparty_mobile_snapshot)
      and length(counterparty_mobile_snapshot) <= 50
      and counterparty_mobile_snapshot !~ '[[:cntrl:]]'
    )
  ),
  constraint expense_records_description_check check (
    description <> '' and description = btrim(description)
    and description = regexp_replace(description, '[[:space:]]+', ' ', 'g')
    and length(description) <= 300 and description !~ '[[:cntrl:]]'
  ),
  constraint expense_records_amount_check check (
    total_amount > 0
    and total_amount <> 'NaN'::numeric
    and total_amount <> 'Infinity'::numeric
    and total_amount < 10000000000000000
    and total_amount = round(total_amount, 2)
  ),
  constraint expense_records_note_check check (
    note is null or (
      note <> '' and note = btrim(note)
      and length(note) <= 500 and note !~ '[[:cntrl:]]'
    )
  ),
  constraint expense_records_status_check check (status in ('active', 'void')),
  constraint expense_records_void_audit_check check (
    (status = 'active' and voided_at is null and voided_by is null)
    or (status = 'void' and voided_at is not null and voided_by is not null)
  )
);

create table public.expense_payments (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  payment_date date not null,
  amount numeric(18, 2) not null,
  payment_mode text not null,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  constraint expense_payments_id_factory_key unique (id, factory_id),
  constraint expense_payments_date_check check (isfinite(payment_date)),
  constraint expense_payments_amount_check check (
    amount > 0
    and amount <> 'NaN'::numeric
    and amount <> 'Infinity'::numeric
    and amount < 10000000000000000
    and amount = round(amount, 2)
  ),
  constraint expense_payments_mode_check check (
    payment_mode in ('cash', 'upi', 'bank_transfer', 'cheque', 'other')
  ),
  constraint expense_payments_note_check check (
    note is null or (
      note <> '' and note = btrim(note)
      and length(note) <= 500 and note !~ '[[:cntrl:]]'
    )
  )
);

create table public.expense_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  payment_id uuid not null,
  expense_record_id uuid not null,
  allocated_amount numeric(18, 2) not null,
  created_at timestamptz not null default now(),
  constraint expense_payment_allocations_id_factory_key unique (id, factory_id),
  constraint expense_payment_allocations_payment_record_key
    unique (payment_id, expense_record_id),
  constraint expense_payment_allocations_payment_factory_fkey
    foreign key (payment_id, factory_id)
    references public.expense_payments(id, factory_id) on delete restrict,
  constraint expense_payment_allocations_record_factory_fkey
    foreign key (expense_record_id, factory_id)
    references public.expense_records(id, factory_id) on delete restrict,
  constraint expense_payment_allocations_amount_check check (
    allocated_amount > 0
    and allocated_amount <> 'NaN'::numeric
    and allocated_amount <> 'Infinity'::numeric
    and allocated_amount < 10000000000000000
    and allocated_amount = round(allocated_amount, 2)
  )
);

create index suppliers_factory_name_idx
  on public.suppliers(factory_id, name, id);
create index expense_records_factory_date_idx
  on public.expense_records(factory_id, business_date desc, created_at desc, id desc);
create index expense_records_factory_supplier_idx
  on public.expense_records(factory_id, supplier_id, business_date desc, id desc);
create index expense_payments_factory_history_idx
  on public.expense_payments(factory_id, payment_date desc, created_at desc, id desc);
create index expense_payment_allocations_factory_record_idx
  on public.expense_payment_allocations(factory_id, expense_record_id, created_at, id);
create index expense_payment_allocations_factory_payment_idx
  on public.expense_payment_allocations(factory_id, payment_id, created_at, id);

alter table public.suppliers enable row level security;
alter table public.expense_records enable row level security;
alter table public.expense_payments enable row level security;
alter table public.expense_payment_allocations enable row level security;

revoke all on public.suppliers from public, anon, authenticated;
revoke all on public.expense_records from public, anon, authenticated;
revoke all on public.expense_payments from public, anon, authenticated;
revoke all on public.expense_payment_allocations from public, anon, authenticated;
grant select on public.suppliers to authenticated;
grant select on public.expense_records to authenticated;
grant select on public.expense_payments to authenticated;
grant select on public.expense_payment_allocations to authenticated;

create policy "Authenticated users can read their factory suppliers"
  on public.suppliers for select to authenticated
  using (exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = suppliers.factory_id
      and factory_users.is_active = true
  ));

create policy "Authenticated users can read their factory expense records"
  on public.expense_records for select to authenticated
  using (exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = expense_records.factory_id
      and factory_users.is_active = true
  ));

create policy "Authenticated users can read their factory expense payments"
  on public.expense_payments for select to authenticated
  using (exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = expense_payments.factory_id
      and factory_users.is_active = true
  ));

create policy "Authenticated users can read their factory expense payment allocations"
  on public.expense_payment_allocations for select to authenticated
  using (exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = expense_payment_allocations.factory_id
      and factory_users.is_active = true
  ));

create or replace function public.reject_supplier_delete()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'Suppliers cannot be deleted while preserving purchase history.'
    using errcode = 'P4003';
end;
$$;

create trigger suppliers_reject_delete
before delete on public.suppliers
for each row execute function public.reject_supplier_delete();

create or replace function public.guard_expense_record_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Expense/Purchase records cannot be deleted.' using errcode = 'P4106';
  end if;
  if old.status = 'void' then
    raise exception 'A void Expense/Purchase cannot be changed.' using errcode = 'P4103';
  end if;
  if old.is_locked then
    raise exception 'A financially locked Expense/Purchase cannot be changed.'
      using errcode = 'P4104';
  end if;
  if new.id <> old.id
    or new.factory_id <> old.factory_id
    or new.created_at <> old.created_at
    or new.created_by <> old.created_by then
    raise exception 'Permanent Expense/Purchase identity cannot be changed.'
      using errcode = 'P4106';
  end if;

  if new.is_locked then
    if new.status <> 'active'
      or new.business_date <> old.business_date
      or new.kind <> old.kind
      or new.supplier_id is distinct from old.supplier_id
      or new.counterparty_name_snapshot <> old.counterparty_name_snapshot
      or new.counterparty_address_snapshot is distinct from old.counterparty_address_snapshot
      or new.counterparty_mobile_snapshot is distinct from old.counterparty_mobile_snapshot
      or new.description <> old.description
      or new.total_amount <> old.total_amount
      or new.note is distinct from old.note
      or new.voided_at is not null
      or new.voided_by is not null then
      raise exception 'Financial locking cannot rewrite Expense/Purchase history.'
        using errcode = 'P4106';
    end if;
    return new;
  end if;

  if new.status = 'void' then
    if new.business_date <> old.business_date
      or new.kind <> old.kind
      or new.supplier_id is distinct from old.supplier_id
      or new.counterparty_name_snapshot <> old.counterparty_name_snapshot
      or new.counterparty_address_snapshot is distinct from old.counterparty_address_snapshot
      or new.counterparty_mobile_snapshot is distinct from old.counterparty_mobile_snapshot
      or new.description <> old.description
      or new.total_amount <> old.total_amount
      or new.note is distinct from old.note
      or new.voided_at is null
      or new.voided_by is null then
      raise exception 'Voiding cannot rewrite Expense/Purchase history.' using errcode = 'P4106';
    end if;
    return new;
  end if;

  if new.status <> 'active' or new.voided_at is not null or new.voided_by is not null then
    raise exception 'Invalid Expense/Purchase lifecycle transition.' using errcode = 'P4106';
  end if;
  return new;
end;
$$;

create or replace function public.prevent_expense_payment_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'Expense payment history is immutable.' using errcode = 'P4106';
end;
$$;

create trigger expense_records_guard_update_delete
before update or delete on public.expense_records
for each row execute function public.guard_expense_record_mutation();
create trigger expense_payments_prevent_update_delete
before update or delete on public.expense_payments
for each row execute function public.prevent_expense_payment_mutation();
create trigger expense_payment_allocations_prevent_update_delete
before update or delete on public.expense_payment_allocations
for each row execute function public.prevent_expense_payment_mutation();

create or replace function public.create_supplier(
  p_factory_id uuid,
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
  normalized_name text := btrim(regexp_replace(coalesce(p_name, ''), '[[:space:]]+', ' ', 'g'));
  normalized_address text := nullif(btrim(regexp_replace(coalesce(p_address, ''), '[[:space:]]+', ' ', 'g')), '');
  normalized_mobile text := nullif(btrim(regexp_replace(coalesce(p_mobile, ''), '[[:space:]]+', ' ', 'g')), '');
  new_supplier public.suppliers%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;
  if normalized_name = '' or length(normalized_name) > 200 or normalized_name ~ '[[:cntrl:]]' then
    raise exception 'Supplier name is required and must be at most 200 characters.'
      using errcode = '22023';
  end if;
  if normalized_address is not null
    and (length(normalized_address) > 500 or normalized_address ~ '[[:cntrl:]]') then
    raise exception 'Supplier address must be at most 500 characters.' using errcode = '22023';
  end if;
  if normalized_mobile is not null
    and (length(normalized_mobile) > 50 or normalized_mobile ~ '[[:cntrl:]]') then
    raise exception 'Supplier mobile must be at most 50 characters.' using errcode = '22023';
  end if;

  insert into public.suppliers(factory_id, name, address, mobile)
  values (p_factory_id, normalized_name, normalized_address, normalized_mobile)
  returning * into new_supplier;
  return new_supplier;
end;
$$;

create or replace function public.update_supplier(
  p_factory_id uuid,
  p_supplier_id uuid,
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
  normalized_name text := btrim(regexp_replace(coalesce(p_name, ''), '[[:space:]]+', ' ', 'g'));
  normalized_address text := nullif(btrim(regexp_replace(coalesce(p_address, ''), '[[:space:]]+', ' ', 'g')), '');
  normalized_mobile text := nullif(btrim(regexp_replace(coalesce(p_mobile, ''), '[[:space:]]+', ' ', 'g')), '');
  updated_supplier public.suppliers%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;
  if normalized_name = '' or length(normalized_name) > 200 or normalized_name ~ '[[:cntrl:]]' then
    raise exception 'Supplier name is required and must be at most 200 characters.'
      using errcode = '22023';
  end if;
  if normalized_address is not null
    and (length(normalized_address) > 500 or normalized_address ~ '[[:cntrl:]]') then
    raise exception 'Supplier address must be at most 500 characters.' using errcode = '22023';
  end if;
  if normalized_mobile is not null
    and (length(normalized_mobile) > 50 or normalized_mobile ~ '[[:cntrl:]]') then
    raise exception 'Supplier mobile must be at most 50 characters.' using errcode = '22023';
  end if;

  update public.suppliers
  set name = normalized_name,
      address = normalized_address,
      mobile = normalized_mobile,
      updated_at = now()
  where id = p_supplier_id and factory_id = p_factory_id
  returning * into updated_supplier;
  if not found then
    raise exception 'Supplier does not belong to this factory.' using errcode = 'P4002';
  end if;
  return updated_supplier;
end;
$$;

create or replace function public.create_expense_record(
  p_factory_id uuid,
  p_business_date date,
  p_kind text,
  p_supplier_id uuid,
  p_counterparty_name text,
  p_description text,
  p_total_amount numeric,
  p_note text
)
returns public.expense_records
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_kind text := lower(btrim(coalesce(p_kind, '')));
  normalized_counterparty text := btrim(regexp_replace(coalesce(p_counterparty_name, ''), '[[:space:]]+', ' ', 'g'));
  normalized_description text := btrim(regexp_replace(coalesce(p_description, ''), '[[:space:]]+', ' ', 'g'));
  normalized_note text := nullif(btrim(regexp_replace(coalesce(p_note, ''), '[[:space:]]+', ' ', 'g')), '');
  snapshot_name text;
  snapshot_address text;
  snapshot_mobile text;
  new_record public.expense_records%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;
  if p_business_date is null or not isfinite(p_business_date) then
    raise exception 'Expense/Purchase date must be a finite calendar date.' using errcode = '22023';
  end if;
  if normalized_kind not in ('purchase', 'expense') then
    raise exception 'Kind must be purchase or expense.' using errcode = '22023';
  end if;
  if normalized_description = '' or length(normalized_description) > 300
    or normalized_description ~ '[[:cntrl:]]' then
    raise exception 'Description is required and must be at most 300 characters.'
      using errcode = '22023';
  end if;
  if p_total_amount is null or p_total_amount <= 0
    or p_total_amount = 'NaN'::numeric or p_total_amount = 'Infinity'::numeric
    or p_total_amount >= 10000000000000000
    or p_total_amount <> round(p_total_amount, 2) then
    raise exception 'Total amount must be positive and use at most two decimal places.'
      using errcode = '22023';
  end if;
  if normalized_note is not null
    and (length(normalized_note) > 500 or normalized_note ~ '[[:cntrl:]]') then
    raise exception 'Note must be at most 500 characters.' using errcode = '22023';
  end if;

  if p_supplier_id is not null then
    select name, address, mobile
    into snapshot_name, snapshot_address, snapshot_mobile
    from public.suppliers
    where id = p_supplier_id and factory_id = p_factory_id;
    if not found then
      raise exception 'Supplier does not belong to this factory.' using errcode = 'P4002';
    end if;
  else
    if normalized_counterparty = '' or length(normalized_counterparty) > 200
      or normalized_counterparty ~ '[[:cntrl:]]' then
      raise exception 'Counterparty is required when no supplier is selected.'
        using errcode = '22023';
    end if;
    snapshot_name := normalized_counterparty;
    snapshot_address := null;
    snapshot_mobile := null;
  end if;

  insert into public.expense_records(
    factory_id, business_date, kind, supplier_id,
    counterparty_name_snapshot, counterparty_address_snapshot,
    counterparty_mobile_snapshot, description, total_amount, note, created_by
  ) values (
    p_factory_id, p_business_date, normalized_kind, p_supplier_id,
    snapshot_name, snapshot_address, snapshot_mobile,
    normalized_description, p_total_amount, normalized_note, auth.uid()
  ) returning * into new_record;
  return new_record;
end;
$$;

create or replace function public.update_expense_record(
  p_factory_id uuid,
  p_expense_record_id uuid,
  p_business_date date,
  p_kind text,
  p_supplier_id uuid,
  p_counterparty_name text,
  p_description text,
  p_total_amount numeric,
  p_note text
)
returns public.expense_records
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_record public.expense_records%rowtype;
  snapshot_name text;
  snapshot_address text;
  snapshot_mobile text;
  normalized_kind text := lower(btrim(coalesce(p_kind, '')));
  normalized_counterparty text := btrim(regexp_replace(coalesce(p_counterparty_name, ''), '[[:space:]]+', ' ', 'g'));
  normalized_description text := btrim(regexp_replace(coalesce(p_description, ''), '[[:space:]]+', ' ', 'g'));
  normalized_note text := nullif(btrim(regexp_replace(coalesce(p_note, ''), '[[:space:]]+', ' ', 'g')), '');
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;

  select * into target_record
  from public.expense_records
  where id = p_expense_record_id and factory_id = p_factory_id
  for update;
  if not found then
    raise exception 'Expense/Purchase does not belong to this factory.' using errcode = 'P4102';
  end if;
  if target_record.status <> 'active' then
    raise exception 'A void Expense/Purchase cannot be changed.' using errcode = 'P4103';
  end if;
  if target_record.is_locked or exists (
    select 1 from public.expense_payment_allocations
    where factory_id = p_factory_id and expense_record_id = p_expense_record_id
  ) then
    raise exception 'A paid or partially-paid Expense/Purchase cannot be changed.'
      using errcode = 'P4104';
  end if;
  if p_business_date is null or not isfinite(p_business_date) then
    raise exception 'Expense/Purchase date must be a finite calendar date.' using errcode = '22023';
  end if;
  if normalized_kind not in ('purchase', 'expense') then
    raise exception 'Kind must be purchase or expense.' using errcode = '22023';
  end if;
  if normalized_description = '' or length(normalized_description) > 300
    or normalized_description ~ '[[:cntrl:]]' then
    raise exception 'Description is required and must be at most 300 characters.'
      using errcode = '22023';
  end if;
  if p_total_amount is null or p_total_amount <= 0
    or p_total_amount = 'NaN'::numeric or p_total_amount = 'Infinity'::numeric
    or p_total_amount >= 10000000000000000
    or p_total_amount <> round(p_total_amount, 2) then
    raise exception 'Total amount must be positive and use at most two decimal places.'
      using errcode = '22023';
  end if;
  if normalized_note is not null
    and (length(normalized_note) > 500 or normalized_note ~ '[[:cntrl:]]') then
    raise exception 'Note must be at most 500 characters.' using errcode = '22023';
  end if;

  if p_supplier_id is not null then
    select name, address, mobile into snapshot_name, snapshot_address, snapshot_mobile
    from public.suppliers where id = p_supplier_id and factory_id = p_factory_id;
    if not found then
      raise exception 'Supplier does not belong to this factory.' using errcode = 'P4002';
    end if;
  else
    if normalized_counterparty = '' or length(normalized_counterparty) > 200
      or normalized_counterparty ~ '[[:cntrl:]]' then
      raise exception 'Counterparty is required when no supplier is selected.'
        using errcode = '22023';
    end if;
    snapshot_name := normalized_counterparty;
    snapshot_address := null;
    snapshot_mobile := null;
  end if;

  update public.expense_records
  set business_date = p_business_date,
      kind = normalized_kind,
      supplier_id = p_supplier_id,
      counterparty_name_snapshot = snapshot_name,
      counterparty_address_snapshot = snapshot_address,
      counterparty_mobile_snapshot = snapshot_mobile,
      description = normalized_description,
      total_amount = p_total_amount,
      note = normalized_note,
      updated_at = now()
  where id = p_expense_record_id and factory_id = p_factory_id
  returning * into target_record;
  return target_record;
end;
$$;

create or replace function public.void_expense_record(
  p_factory_id uuid,
  p_expense_record_id uuid
)
returns public.expense_records
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_record public.expense_records%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;

  select * into target_record
  from public.expense_records
  where id = p_expense_record_id and factory_id = p_factory_id
  for update;
  if not found then
    raise exception 'Expense/Purchase does not belong to this factory.' using errcode = 'P4102';
  end if;
  if target_record.status = 'void' then return target_record; end if;
  if target_record.is_locked or exists (
    select 1 from public.expense_payment_allocations
    where factory_id = p_factory_id and expense_record_id = p_expense_record_id
  ) then
    raise exception 'A paid or partially-paid Expense/Purchase cannot be voided.'
      using errcode = 'P4104';
  end if;

  update public.expense_records
  set status = 'void', voided_at = now(), voided_by = auth.uid(), updated_at = now()
  where id = p_expense_record_id and factory_id = p_factory_id
  returning * into target_record;
  return target_record;
end;
$$;

create or replace function public.create_expense_payment(
  p_factory_id uuid,
  p_payment_date date,
  p_amount numeric,
  p_payment_mode text,
  p_note text,
  p_allocations jsonb
)
returns public.expense_payments
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  allocation_value jsonb;
  allocation_position integer;
  allocation_record_id uuid;
  allocation_amount numeric;
  allocation_record_ids uuid[] := array[]::uuid[];
  allocation_amounts numeric[] := array[]::numeric[];
  allocation_total numeric := 0;
  allocation_index integer;
  existing_paid numeric;
  normalized_payment_mode text := lower(btrim(coalesce(p_payment_mode, '')));
  normalized_note text := nullif(btrim(regexp_replace(coalesce(p_note, ''), '[[:space:]]+', ' ', 'g')), '');
  target_record public.expense_records%rowtype;
  new_payment public.expense_payments%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;
  if p_payment_date is null or not isfinite(p_payment_date) then
    raise exception 'Payment date must be a finite calendar date.' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0
    or p_amount = 'NaN'::numeric or p_amount = 'Infinity'::numeric
    or p_amount >= 10000000000000000 or p_amount <> round(p_amount, 2) then
    raise exception 'Payment amount must be positive and use at most two decimal places.'
      using errcode = '22023';
  end if;
  if normalized_payment_mode not in ('cash', 'upi', 'bank_transfer', 'cheque', 'other') then
    raise exception 'Choose a supported payment mode.' using errcode = 'P3200';
  end if;
  if normalized_note is not null
    and (length(normalized_note) > 500 or normalized_note ~ '[[:cntrl:]]') then
    raise exception 'Payment note must be at most 500 characters.' using errcode = '22023';
  end if;
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array'
    or jsonb_array_length(p_allocations) = 0
    or jsonb_array_length(p_allocations) > 100 then
    raise exception 'A payment requires between 1 and 100 allocations.' using errcode = '22023';
  end if;

  for allocation_value, allocation_position in
    select allocation, ordinality::integer
    from jsonb_array_elements(p_allocations)
      with ordinality as supplied(allocation, ordinality)
  loop
    if jsonb_typeof(allocation_value) <> 'object'
      or not allocation_value ? 'expense_record_id'
      or not allocation_value ? 'amount'
      or exists (
        select 1 from jsonb_object_keys(allocation_value) as supplied_keys(key)
        where supplied_keys.key not in ('expense_record_id', 'amount')
      ) then
      raise exception 'Allocation % must contain only expense_record_id and amount.',
        allocation_position using errcode = '22023';
    end if;
    begin
      allocation_record_id := (allocation_value ->> 'expense_record_id')::uuid;
      allocation_amount := (allocation_value ->> 'amount')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Allocation % contains an invalid record or amount.',
        allocation_position using errcode = '22023';
    end;
    if allocation_amount is null or allocation_amount <= 0
      or allocation_amount = 'NaN'::numeric or allocation_amount = 'Infinity'::numeric
      or allocation_amount >= 10000000000000000
      or allocation_amount <> round(allocation_amount, 2) then
      raise exception 'Allocation % must be positive and use at most two decimal places.',
        allocation_position using errcode = '22023';
    end if;
    if allocation_record_id = any(allocation_record_ids) then
      raise exception 'The same Expense/Purchase cannot appear twice in one payment.'
        using errcode = '22023';
    end if;
    allocation_record_ids := array_append(allocation_record_ids, allocation_record_id);
    allocation_amounts := array_append(allocation_amounts, allocation_amount);
    allocation_total := allocation_total + allocation_amount;
  end loop;

  if allocation_total <> p_amount then
    raise exception 'Allocation total % must equal payment amount %.', allocation_total, p_amount
      using errcode = 'P4101';
  end if;

  perform target.id
  from public.expense_records as target
  where target.factory_id = p_factory_id
    and target.id = any(allocation_record_ids)
  order by target.id
  for update;

  for allocation_index in 1..array_length(allocation_record_ids, 1)
  loop
    select * into target_record
    from public.expense_records
    where id = allocation_record_ids[allocation_index]
      and factory_id = p_factory_id;
    if not found then
      raise exception 'Expense/Purchase does not belong to this factory.' using errcode = 'P4102';
    end if;
    if target_record.status <> 'active' then
      raise exception 'A void Expense/Purchase cannot receive a payment.' using errcode = 'P4103';
    end if;
    select coalesce(sum(allocated_amount), 0) into existing_paid
    from public.expense_payment_allocations
    where factory_id = p_factory_id
      and expense_record_id = target_record.id;
    if existing_paid > target_record.total_amount then
      raise exception 'Stored allocations exceed the Expense/Purchase total.' using errcode = 'P4107';
    end if;
    if allocation_amounts[allocation_index] > target_record.total_amount - existing_paid then
      raise exception 'Allocation exceeds the Expense/Purchase outstanding amount.'
        using errcode = 'P4105';
    end if;
  end loop;

  insert into public.expense_payments(
    factory_id, payment_date, amount, payment_mode, note, created_by
  ) values (
    p_factory_id, p_payment_date, p_amount, normalized_payment_mode, normalized_note, auth.uid()
  ) returning * into new_payment;

  for allocation_index in 1..array_length(allocation_record_ids, 1)
  loop
    insert into public.expense_payment_allocations(
      factory_id, payment_id, expense_record_id, allocated_amount
    ) values (
      p_factory_id, new_payment.id, allocation_record_ids[allocation_index],
      allocation_amounts[allocation_index]
    );
  end loop;

  update public.expense_records
  set is_locked = true
  where factory_id = p_factory_id
    and id = any(allocation_record_ids)
    and not is_locked;
  return new_payment;
end;
$$;

create or replace function public.list_expense_records(
  p_factory_id uuid,
  p_supplier_id uuid
)
returns table (
  expense_record_id uuid,
  factory_id uuid,
  business_date date,
  kind text,
  supplier_id uuid,
  counterparty_name_snapshot text,
  counterparty_address_snapshot text,
  counterparty_mobile_snapshot text,
  description text,
  total_amount numeric,
  note text,
  status text,
  is_locked boolean,
  total_paid numeric,
  outstanding_amount numeric,
  payment_state text,
  voided_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
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
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;
  if p_supplier_id is not null and not exists (
    select 1 from public.suppliers
    where id = p_supplier_id and factory_id = p_factory_id
  ) then
    raise exception 'Supplier does not belong to this factory.' using errcode = 'P4002';
  end if;

  return query
  select
    records.id, records.factory_id, records.business_date, records.kind, records.supplier_id,
    records.counterparty_name_snapshot, records.counterparty_address_snapshot,
    records.counterparty_mobile_snapshot, records.description, records.total_amount,
    records.note, records.status, records.is_locked,
    coalesce(paid.total_paid, 0),
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
  order by records.business_date desc, records.created_at desc, records.id desc;
end;
$$;

create or replace function public.get_expense_record_payment_state(
  p_factory_id uuid,
  p_expense_record_id uuid
)
returns table (
  expense_record_id uuid,
  status text,
  kind text,
  total_amount numeric,
  total_paid numeric,
  outstanding_amount numeric,
  payment_state text,
  is_locked boolean
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
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;

  return query
  select
    records.id, records.status, records.kind, records.total_amount,
    coalesce(sum(allocations.allocated_amount), 0),
    case when records.status = 'active'
      then records.total_amount - coalesce(sum(allocations.allocated_amount), 0) else 0 end,
    case
      when coalesce(sum(allocations.allocated_amount), 0) = 0 then 'unpaid'
      when coalesce(sum(allocations.allocated_amount), 0) < records.total_amount
        then 'partially_paid'
      else 'paid'
    end,
    records.is_locked
  from public.expense_records as records
  left join public.expense_payment_allocations as allocations
    on allocations.factory_id = records.factory_id
    and allocations.expense_record_id = records.id
  where records.id = p_expense_record_id and records.factory_id = p_factory_id
  group by records.id;
  if not found then
    raise exception 'Expense/Purchase does not belong to this factory.' using errcode = 'P4102';
  end if;
end;
$$;

create or replace function public.get_supplier_expense_summary(
  p_factory_id uuid,
  p_supplier_id uuid
)
returns table (
  supplier_id uuid,
  active_record_count bigint,
  total_cost numeric,
  total_paid numeric,
  total_outstanding numeric
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
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.suppliers
    where id = p_supplier_id and factory_id = p_factory_id
  ) then
    raise exception 'Supplier does not belong to this factory.' using errcode = 'P4002';
  end if;

  supplier_id := p_supplier_id;
  select count(*), coalesce(sum(records.total_amount), 0),
    coalesce(sum(paid.total_paid), 0)
  into active_record_count, total_cost, total_paid
  from public.expense_records as records
  left join lateral (
    select coalesce(sum(allocations.allocated_amount), 0) as total_paid
    from public.expense_payment_allocations as allocations
    where allocations.factory_id = records.factory_id
      and allocations.expense_record_id = records.id
  ) as paid on true
  where records.factory_id = p_factory_id
    and records.supplier_id = p_supplier_id
    and records.status = 'active';
  total_outstanding := total_cost - total_paid;
  return next;
end;
$$;

create or replace function public.get_cash_book_source_movements(
  p_factory_id uuid
)
returns table (
  source_type text,
  source_id uuid,
  business_date date,
  direction text,
  amount numeric,
  payment_mode text,
  counterparty text,
  description text,
  note text,
  source_status text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    'customer_payment'::text, payments.id, payments.payment_date, 'in'::text,
    payments.amount, payments.payment_mode, payments.customer_name_snapshot,
    coalesce((
      select 'Challans ' || string_agg(
        '#' || challans.challan_number::text, ', ' order by challans.challan_number
      )
      from public.customer_payment_allocations as allocations
      join public.challans
        on challans.id = allocations.challan_id
        and challans.factory_id = allocations.factory_id
      where allocations.factory_id = payments.factory_id
        and allocations.payment_id = payments.id
    ), 'Customer payment'),
    payments.note, 'active'::text, payments.created_at
  from public.customer_payments as payments
  where payments.factory_id = p_factory_id

  union all

  select
    'manual_cash_entry'::text, entries.id, entries.business_date, entries.direction,
    entries.amount, entries.payment_mode, entries.party_details,
    case entries.direction when 'in' then 'Manual Money In' else 'Manual Money Out' end,
    entries.note, entries.status, entries.created_at
  from public.cash_book_manual_entries as entries
  where entries.factory_id = p_factory_id

  union all

  select
    'expense_payment'::text, payments.id, payments.payment_date, 'out'::text,
    payments.amount, payments.payment_mode,
    coalesce((
      select string_agg(counterparties.name, ', ' order by counterparties.name)
      from (
        select distinct records.counterparty_name_snapshot as name
        from public.expense_payment_allocations as allocations
        join public.expense_records as records
          on records.id = allocations.expense_record_id
          and records.factory_id = allocations.factory_id
        where allocations.factory_id = payments.factory_id
          and allocations.payment_id = payments.id
      ) as counterparties
    ), 'Expense payment'),
    coalesce((
      select 'Payment for ' || string_agg(
        records.description, ', ' order by records.description, records.id
      )
      from public.expense_payment_allocations as allocations
      join public.expense_records as records
        on records.id = allocations.expense_record_id
        and records.factory_id = allocations.factory_id
      where allocations.factory_id = payments.factory_id
        and allocations.payment_id = payments.id
    ), 'Expense payment'),
    payments.note, 'active'::text, payments.created_at
  from public.expense_payments as payments
  where payments.factory_id = p_factory_id;
$$;

revoke all on function public.reject_supplier_delete() from public, anon, authenticated;
revoke all on function public.guard_expense_record_mutation() from public, anon, authenticated;
revoke all on function public.prevent_expense_payment_mutation() from public, anon, authenticated;
revoke all on function public.get_cash_book_source_movements(uuid) from public, anon, authenticated;

revoke all on function public.create_supplier(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.create_supplier(uuid, text, text, text) to authenticated;
revoke all on function public.update_supplier(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.update_supplier(uuid, uuid, text, text, text) to authenticated;
revoke all on function public.create_expense_record(uuid, date, text, uuid, text, text, numeric, text)
  from public, anon, authenticated;
grant execute on function public.create_expense_record(uuid, date, text, uuid, text, text, numeric, text)
  to authenticated;
revoke all on function public.update_expense_record(uuid, uuid, date, text, uuid, text, text, numeric, text)
  from public, anon, authenticated;
grant execute on function public.update_expense_record(uuid, uuid, date, text, uuid, text, text, numeric, text)
  to authenticated;
revoke all on function public.void_expense_record(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.void_expense_record(uuid, uuid) to authenticated;
revoke all on function public.create_expense_payment(uuid, date, numeric, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_expense_payment(uuid, date, numeric, text, text, jsonb)
  to authenticated;
revoke all on function public.list_expense_records(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.list_expense_records(uuid, uuid) to authenticated;
revoke all on function public.get_expense_record_payment_state(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_expense_record_payment_state(uuid, uuid) to authenticated;
revoke all on function public.get_supplier_expense_summary(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_supplier_expense_summary(uuid, uuid) to authenticated;

comment on table public.suppliers is
  'Minimal factory supplier master. Expense/Purchase records preserve their own identity snapshots.';
comment on table public.expense_records is
  'Authoritative incurred purchase or expense. It is separate from actual outgoing payment events.';
comment on table public.expense_payments is
  'Immutable actual outgoing payment header. One row produces one Cash Book Money Out movement.';
comment on table public.expense_payment_allocations is
  'Immutable explicit distribution of one outgoing payment across active Expense/Purchase records.';
comment on column public.expense_records.is_locked is
  'One-way financial lock set atomically when the record receives its first payment allocation.';
comment on function public.create_expense_payment(uuid, date, numeric, text, text, jsonb) is
  'Atomically validates explicit allocations, prevents concurrent overpayment, writes one payment plus children, and locks touched source records.';
comment on function public.get_cash_book_source_movements(uuid) is
  'Private Cash Book source union. Customer and expense payments each appear once per payment header; manual entries remain separate.';
