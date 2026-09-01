-- TEST ATLAS ONLY: data-preserving reconciliation through 20260828000025.
-- This is a standalone operational script, not a Supabase migration.
-- It does not change migration history and does not alter or recreate any table.
--
-- Final supersessions used:
--   create_customer_payment                 = migration 00023
--   get_cash_book_source_movements          = migration 00024
--   list_expense_records                    = migration 00025

begin;

set local lock_timeout = '15s';
set local statement_timeout = '5min';

-- Replace only the four failed policy sets. The final post-00025 state has
-- exactly one SELECT policy on each of these tables.
do $policy_cleanup$
declare
  existing_policy record;
begin
  for existing_policy in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'customer_payment_allocations',
        'cash_book_initializations',
        'cash_book_manual_entries',
        'expense_payment_allocations'
      )
  loop
    execute format(
      'drop policy %I on %I.%I',
      existing_policy.policyname,
      existing_policy.schemaname,
      existing_policy.tablename
    );
  end loop;
end;
$policy_cleanup$;

create policy "Authenticated users can read their factory customer payment allocations"
  on public.customer_payment_allocations
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = customer_payment_allocations.factory_id
        and factory_users.is_active = true
    )
  );

create policy "Authenticated users can read their factory Cash Book initialization"
  on public.cash_book_initializations for select to authenticated
  using (exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = cash_book_initializations.factory_id
      and factory_users.is_active = true
  ));

create policy "Authenticated users can read their factory manual Cash Book entries"
  on public.cash_book_manual_entries for select to authenticated
  using (exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = cash_book_manual_entries.factory_id
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

-- Replace failed functions in dependency-safe order. Bodies below are copied
-- verbatim from their final owning migration.
create or replace function public.prevent_customer_payment_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'Customer payment history is immutable.' using errcode = 'P3106';
end;
$$;

create or replace function public.get_challan_payment_state(
  p_factory_id uuid,
  p_challan_id uuid
)
returns table (
  challan_id uuid,
  challan_status text,
  sale_total numeric,
  total_paid numeric,
  outstanding_amount numeric,
  payment_state text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
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

  select
    challans.id,
    challans.status,
    challans.challan_total,
    coalesce(sum(allocations.allocated_amount), 0)
  into challan_id, challan_status, sale_total, total_paid
  from public.challans
  left join public.customer_payment_allocations as allocations
    on allocations.factory_id = challans.factory_id
    and allocations.challan_id = challans.id
  where challans.id = p_challan_id
    and challans.factory_id = p_factory_id
  group by challans.id;

  if not found then
    raise exception 'Challan does not belong to this factory.' using errcode = 'P3102';
  end if;

  outstanding_amount := case
    when challan_status = 'active' then sale_total - total_paid
    else 0
  end;
  payment_state := case
    when total_paid = 0 then 'unpaid'
    when total_paid < sale_total then 'partially_paid'
    else 'paid'
  end;
  return next;
end;
$$;

create or replace function public.get_customer_sales_summary(
  p_factory_id uuid,
  p_customer_id uuid
)
returns table (
  customer_id uuid,
  total_active_sales numeric,
  total_payments_allocated numeric,
  total_outstanding numeric
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
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

  if p_customer_id is null or not exists (
    select 1
    from public.customers
    where customers.id = p_customer_id
      and customers.factory_id = p_factory_id
  ) then
    raise exception 'Customer does not belong to this factory.' using errcode = 'P3002';
  end if;

  customer_id := p_customer_id;
  select
    coalesce(sum(challans.challan_total), 0),
    coalesce(sum(challan_paid.total_paid), 0)
  into total_active_sales, total_payments_allocated
  from public.challans
  left join lateral (
    select coalesce(sum(allocations.allocated_amount), 0) as total_paid
    from public.customer_payment_allocations as allocations
    where allocations.factory_id = challans.factory_id
      and allocations.challan_id = challans.id
  ) as challan_paid on true
  where challans.factory_id = p_factory_id
    and challans.customer_id = p_customer_id
    and challans.status = 'active';

  total_outstanding := total_active_sales - total_payments_allocated;
  return next;
end;
$$;

create or replace function public.snapshot_customer_payment_receipt()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  customer_profile public.customers%rowtype;
  factory_profile public.factories%rowtype;
begin
  select *
  into customer_profile
  from public.customers
  where customers.id = new.customer_id
    and customers.factory_id = new.factory_id;

  if not found then
    raise exception 'Customer does not belong to this factory.' using errcode = 'P3002';
  end if;

  select *
  into factory_profile
  from public.factories
  where factories.id = new.factory_id;

  if not found
    or factory_profile.name = ''
    or factory_profile.business_description = ''
    or factory_profile.address = ''
    or factory_profile.mobile = '' then
    raise exception 'Complete the printable factory profile before recording a customer payment.'
      using errcode = 'P3010';
  end if;

  new.customer_name_snapshot := customer_profile.name;
  new.customer_address_snapshot := customer_profile.address;
  new.customer_mobile_snapshot := customer_profile.mobile;
  new.company_name_snapshot := factory_profile.name;
  new.company_business_description_snapshot := factory_profile.business_description;
  new.company_address_snapshot := factory_profile.address;
  new.company_mobile_snapshot := factory_profile.mobile;
  return new;
end;
$$;

create or replace function public.create_customer_payment(
  p_factory_id uuid,
  p_customer_id uuid,
  p_payment_date date,
  p_amount numeric,
  p_payment_mode text,
  p_note text,
  p_allocations jsonb
)
returns public.customer_payments
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  allocation_value jsonb;
  allocation_position integer;
  allocation_challan_id uuid;
  allocation_amount numeric;
  allocation_challan_ids uuid[] := array[]::uuid[];
  allocation_amounts numeric[] := array[]::numeric[];
  allocation_total numeric := 0;
  allocation_index integer;
  existing_paid numeric;
  normalized_payment_mode text := lower(btrim(coalesce(p_payment_mode, '')));
  normalized_note text := nullif(
    btrim(regexp_replace(coalesce(p_note, ''), '[[:space:]]+', ' ', 'g')),
    ''
  );
  target_challan public.challans%rowtype;
  new_payment public.customer_payments%rowtype;
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

  if p_customer_id is null or not exists (
    select 1
    from public.customers
    where customers.id = p_customer_id
      and customers.factory_id = p_factory_id
  ) then
    raise exception 'Customer does not belong to this factory.' using errcode = 'P3002';
  end if;

  if p_payment_date is null or not isfinite(p_payment_date) then
    raise exception 'Payment date must be a finite calendar date.' using errcode = '22023';
  end if;

  if p_amount is null
    or p_amount <= 0
    or p_amount = 'NaN'::numeric
    or p_amount = 'Infinity'::numeric
    or p_amount >= 10000000000000000
    or p_amount <> round(p_amount, 2) then
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

  if p_allocations is null
    or jsonb_typeof(p_allocations) <> 'array'
    or jsonb_array_length(p_allocations) = 0
    or jsonb_array_length(p_allocations) > 100 then
    raise exception 'A payment requires between 1 and 100 allocations.'
      using errcode = '22023';
  end if;

  for allocation_value, allocation_position in
    select allocation, ordinality::integer
    from jsonb_array_elements(p_allocations)
      with ordinality as supplied(allocation, ordinality)
  loop
    if jsonb_typeof(allocation_value) <> 'object'
      or not allocation_value ? 'challan_id'
      or not allocation_value ? 'amount'
      or exists (
        select 1
        from jsonb_object_keys(allocation_value) as supplied_keys(key)
        where supplied_keys.key not in ('challan_id', 'amount')
      ) then
      raise exception 'Allocation % must contain only challan_id and amount.',
        allocation_position using errcode = '22023';
    end if;

    begin
      allocation_challan_id := (allocation_value ->> 'challan_id')::uuid;
      allocation_amount := (allocation_value ->> 'amount')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Allocation % contains an invalid Challan or amount.',
        allocation_position using errcode = '22023';
    end;

    if allocation_amount is null
      or allocation_amount <= 0
      or allocation_amount = 'NaN'::numeric
      or allocation_amount = 'Infinity'::numeric
      or allocation_amount >= 10000000000000000
      or allocation_amount <> round(allocation_amount, 2) then
      raise exception 'Allocation % amount must be positive and use at most two decimal places.',
        allocation_position using errcode = '22023';
    end if;

    if allocation_challan_id = any(allocation_challan_ids) then
      raise exception 'The same Challan cannot appear twice in one payment.'
        using errcode = '22023';
    end if;

    allocation_challan_ids := array_append(allocation_challan_ids, allocation_challan_id);
    allocation_amounts := array_append(allocation_amounts, allocation_amount);
    allocation_total := allocation_total + allocation_amount;
  end loop;

  if allocation_total <> p_amount then
    raise exception 'Allocation total % must equal payment amount %.', allocation_total, p_amount
      using errcode = 'P3101';
  end if;

  -- Keep the proven S5A lock order and post-wait outstanding recomputation unchanged.
  perform target.id
  from public.challans as target
  where target.factory_id = p_factory_id
    and target.id = any(allocation_challan_ids)
  order by target.id
  for update;

  for allocation_index in 1..array_length(allocation_challan_ids, 1)
  loop
    select *
    into target_challan
    from public.challans
    where challans.id = allocation_challan_ids[allocation_index]
      and challans.factory_id = p_factory_id;

    if not found then
      raise exception 'Challan does not belong to this factory.' using errcode = 'P3102';
    end if;
    if target_challan.customer_id <> p_customer_id then
      raise exception 'Challan does not belong to this customer.' using errcode = 'P3103';
    end if;
    if target_challan.status <> 'active' then
      raise exception 'A void Challan cannot receive a payment.' using errcode = 'P3104';
    end if;

    select coalesce(sum(allocations.allocated_amount), 0)
    into existing_paid
    from public.customer_payment_allocations as allocations
    where allocations.factory_id = p_factory_id
      and allocations.challan_id = target_challan.id;

    if existing_paid > target_challan.challan_total then
      raise exception 'Stored Challan allocations exceed its sale total.' using errcode = 'P3107';
    end if;
    if allocation_amounts[allocation_index]
      > target_challan.challan_total - existing_paid then
      raise exception 'Allocation exceeds the Challan outstanding amount.'
        using errcode = 'P3105';
    end if;
  end loop;

  insert into public.customer_payments(
    factory_id,
    customer_id,
    payment_date,
    amount,
    payment_mode,
    note
  ) values (
    p_factory_id,
    p_customer_id,
    p_payment_date,
    p_amount,
    normalized_payment_mode,
    normalized_note
  )
  returning * into new_payment;

  for allocation_index in 1..array_length(allocation_challan_ids, 1)
  loop
    insert into public.customer_payment_allocations(
      factory_id,
      payment_id,
      challan_id,
      allocated_amount
    ) values (
      p_factory_id,
      new_payment.id,
      allocation_challan_ids[allocation_index],
      allocation_amounts[allocation_index]
    );
  end loop;

  update public.challans
  set is_locked = true
  where factory_id = p_factory_id
    and id = any(allocation_challan_ids)
    and not is_locked;

  return new_payment;
end;
$$;

create or replace function public.prevent_cash_book_initialization_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'Cash Book initialization is permanent.' using errcode = 'P3206';
end;
$$;

create or replace function public.protect_cash_book_manual_entry()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Manual Cash Book entries cannot be deleted.' using errcode = 'P3206';
  end if;

  if old.status <> 'active'
    or new.status <> 'void'
    or new.id <> old.id
    or new.factory_id <> old.factory_id
    or new.business_date <> old.business_date
    or new.direction <> old.direction
    or new.amount <> old.amount
    or new.payment_mode <> old.payment_mode
    or new.party_details <> old.party_details
    or new.note is distinct from old.note
    or new.created_at <> old.created_at
    or new.created_by <> old.created_by
    or old.voided_at is not null
    or old.voided_by is not null
    or new.voided_at is null
    or new.voided_by is null then
    raise exception 'Manual Cash Book history is immutable except for one active-to-void transition.'
      using errcode = 'P3206';
  end if;

  return new;
end;
$$;

create or replace function public.initialize_cash_book(
  p_factory_id uuid,
  p_start_date date,
  p_opening_balance numeric
)
returns public.cash_book_initializations
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  existing_initialization public.cash_book_initializations%rowtype;
  new_initialization public.cash_book_initializations%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;

  if p_start_date is null or not isfinite(p_start_date) then
    raise exception 'Cash Book start date must be a finite calendar date.' using errcode = '22023';
  end if;
  if p_opening_balance is null
    or p_opening_balance = 'NaN'::numeric
    or p_opening_balance = 'Infinity'::numeric
    or abs(p_opening_balance) >= 10000000000000000
    or p_opening_balance <> round(p_opening_balance, 2) then
    raise exception 'Opening balance must be finite and use at most two decimal places.'
      using errcode = '22023';
  end if;

  insert into public.cash_book_initializations(
    factory_id, start_date, opening_balance, created_by
  ) values (
    p_factory_id, p_start_date, p_opening_balance, auth.uid()
  )
  on conflict (factory_id) do nothing
  returning * into new_initialization;

  if found then
    return new_initialization;
  end if;

  select * into existing_initialization
  from public.cash_book_initializations
  where factory_id = p_factory_id;

  if existing_initialization.start_date = p_start_date
    and existing_initialization.opening_balance = p_opening_balance then
    return existing_initialization;
  end if;

  raise exception 'Cash Book is already initialized and cannot be rewritten.'
    using errcode = 'P3202';
end;
$$;

create or replace function public.create_cash_book_manual_entry(
  p_factory_id uuid,
  p_entry_id uuid,
  p_business_date date,
  p_direction text,
  p_amount numeric,
  p_payment_mode text,
  p_party_details text,
  p_note text
)
returns public.cash_book_manual_entries
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  initialization public.cash_book_initializations%rowtype;
  existing_entry public.cash_book_manual_entries%rowtype;
  new_entry public.cash_book_manual_entries%rowtype;
  normalized_direction text := lower(btrim(coalesce(p_direction, '')));
  normalized_payment_mode text := lower(btrim(coalesce(p_payment_mode, '')));
  normalized_party text := btrim(regexp_replace(coalesce(p_party_details, ''), '[[:space:]]+', ' ', 'g'));
  normalized_note text := nullif(
    btrim(regexp_replace(coalesce(p_note, ''), '[[:space:]]+', ' ', 'g')),
    ''
  );
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;

  select * into initialization
  from public.cash_book_initializations
  where factory_id = p_factory_id;
  if not found then
    raise exception 'Initialize the Cash Book before recording manual entries.'
      using errcode = 'P3201';
  end if;

  if p_entry_id is null then
    raise exception 'Manual Cash Book request ID is required.' using errcode = '22023';
  end if;
  if p_business_date is null or not isfinite(p_business_date)
    or p_business_date < initialization.start_date then
    raise exception 'Manual entry date must be on or after the Cash Book start date.'
      using errcode = '22023';
  end if;
  if normalized_direction not in ('in', 'out') then
    raise exception 'Direction must be in or out.' using errcode = 'P3204';
  end if;
  if p_amount is null
    or p_amount <= 0
    or p_amount = 'NaN'::numeric
    or p_amount = 'Infinity'::numeric
    or p_amount >= 10000000000000000
    or p_amount <> round(p_amount, 2) then
    raise exception 'Manual entry amount must be positive and use at most two decimal places.'
      using errcode = '22023';
  end if;
  if normalized_payment_mode not in ('cash', 'upi', 'bank_transfer', 'cheque', 'other') then
    raise exception 'Choose a supported payment mode.' using errcode = 'P3200';
  end if;
  if normalized_party = ''
    or length(normalized_party) > 200
    or normalized_party ~ '[[:cntrl:]]' then
    raise exception 'Party/details is required and must be at most 200 characters.'
      using errcode = '22023';
  end if;
  if normalized_note is not null
    and (length(normalized_note) > 500 or normalized_note ~ '[[:cntrl:]]') then
    raise exception 'Note must be at most 500 characters.' using errcode = '22023';
  end if;

  insert into public.cash_book_manual_entries(
    id, factory_id, business_date, direction, amount, payment_mode,
    party_details, note, created_by
  ) values (
    p_entry_id, p_factory_id, p_business_date, normalized_direction, p_amount,
    normalized_payment_mode, normalized_party, normalized_note, auth.uid()
  )
  on conflict (id) do nothing
  returning * into new_entry;

  if found then
    return new_entry;
  end if;

  select * into existing_entry
  from public.cash_book_manual_entries
  where id = p_entry_id;

  if existing_entry.factory_id = p_factory_id
    and existing_entry.business_date = p_business_date
    and existing_entry.direction = normalized_direction
    and existing_entry.amount = p_amount
    and existing_entry.payment_mode = normalized_payment_mode
    and existing_entry.party_details = normalized_party
    and existing_entry.note is not distinct from normalized_note then
    return existing_entry;
  end if;

  raise exception 'Manual Cash Book request ID was already used for different data.'
    using errcode = 'P3205';
end;
$$;

create or replace function public.void_cash_book_manual_entry(
  p_factory_id uuid,
  p_entry_id uuid
)
returns public.cash_book_manual_entries
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_entry public.cash_book_manual_entries%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;

  select * into target_entry
  from public.cash_book_manual_entries
  where id = p_entry_id
    and factory_id = p_factory_id
  for update;
  if not found then
    raise exception 'Manual Cash Book entry does not belong to this factory.'
      using errcode = 'P3203';
  end if;
  if target_entry.status = 'void' then
    return target_entry;
  end if;

  update public.cash_book_manual_entries
  set status = 'void', voided_at = now(), voided_by = auth.uid()
  where id = p_entry_id and factory_id = p_factory_id
  returning * into target_entry;
  return target_entry;
end;
$$;

create or replace function public.get_cash_book_day_summary(
  p_factory_id uuid,
  p_business_date date
)
returns table (
  business_date date,
  opening_balance numeric,
  total_money_in numeric,
  total_money_out numeric,
  closing_balance numeric
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  initialization public.cash_book_initializations%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;

  select * into initialization
  from public.cash_book_initializations
  where factory_id = p_factory_id;
  if not found then
    raise exception 'Cash Book is not initialized for this factory.' using errcode = 'P3201';
  end if;
  if p_business_date is null or not isfinite(p_business_date)
    or p_business_date < initialization.start_date then
    raise exception 'Cash Book date must be on or after its start date.' using errcode = '22023';
  end if;

  return query
  with movements as (
    select * from public.get_cash_book_source_movements(p_factory_id)
    where source_status = 'active'
      and get_cash_book_source_movements.business_date >= initialization.start_date
      and get_cash_book_source_movements.business_date <= p_business_date
  ), totals as (
    select
      coalesce(sum(case
        when movements.business_date < p_business_date and movements.direction = 'in'
          then movements.amount
        when movements.business_date < p_business_date and movements.direction = 'out'
          then -movements.amount
        else 0
      end), 0) as prior_net,
      coalesce(sum(case
        when movements.business_date = p_business_date and movements.direction = 'in'
          then movements.amount else 0
      end), 0) as day_in,
      coalesce(sum(case
        when movements.business_date = p_business_date and movements.direction = 'out'
          then movements.amount else 0
      end), 0) as day_out
    from movements
  )
  select
    p_business_date,
    initialization.opening_balance + totals.prior_net,
    totals.day_in,
    totals.day_out,
    initialization.opening_balance + totals.prior_net + totals.day_in - totals.day_out
  from totals;
end;
$$;

create or replace function public.list_cash_book_day_entries(
  p_factory_id uuid,
  p_business_date date
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
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  initialization public.cash_book_initializations%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;

  select * into initialization
  from public.cash_book_initializations
  where factory_id = p_factory_id;
  if not found then
    raise exception 'Cash Book is not initialized for this factory.' using errcode = 'P3201';
  end if;
  if p_business_date is null or not isfinite(p_business_date)
    or p_business_date < initialization.start_date then
    raise exception 'Cash Book date must be on or after its start date.' using errcode = '22023';
  end if;

  return query
  select movements.*
  from public.get_cash_book_source_movements(p_factory_id) as movements
  where movements.business_date = p_business_date
  order by movements.created_at, movements.source_type, movements.source_id;
end;
$$;

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
    select 1
    from public.factory_users as authorized_user
    where authorized_user.user_id = auth.uid()
      and authorized_user.factory_id = p_factory_id
      and authorized_user.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;
  if p_supplier_id is not null and not exists (
    select 1
    from public.suppliers as requested_supplier
    where requested_supplier.id = p_supplier_id
      and requested_supplier.factory_id = p_factory_id
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

-- Restore the exact final function ACLs.

revoke all on function public.prevent_customer_payment_mutation()
  from public, anon, authenticated;
revoke all on function public.snapshot_customer_payment_receipt()
  from public, anon, authenticated;
revoke all on function public.prevent_cash_book_initialization_mutation()
  from public, anon, authenticated;
revoke all on function public.protect_cash_book_manual_entry()
  from public, anon, authenticated;
revoke all on function public.get_cash_book_source_movements(uuid)
  from public, anon, authenticated;
revoke all on function public.reject_supplier_delete()
  from public, anon, authenticated;
revoke all on function public.guard_expense_record_mutation()
  from public, anon, authenticated;
revoke all on function public.prevent_expense_payment_mutation()
  from public, anon, authenticated;

revoke all on function public.create_customer_payment(
  uuid, uuid, date, numeric, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.create_customer_payment(
  uuid, uuid, date, numeric, text, text, jsonb
) to authenticated;

revoke all on function public.get_challan_payment_state(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_challan_payment_state(uuid, uuid)
  to authenticated;

revoke all on function public.get_customer_sales_summary(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_customer_sales_summary(uuid, uuid)
  to authenticated;

revoke all on function public.initialize_cash_book(uuid, date, numeric)
  from public, anon, authenticated;
grant execute on function public.initialize_cash_book(uuid, date, numeric)
  to authenticated;

revoke all on function public.create_cash_book_manual_entry(
  uuid, uuid, date, text, numeric, text, text, text
) from public, anon, authenticated;
grant execute on function public.create_cash_book_manual_entry(
  uuid, uuid, date, text, numeric, text, text, text
) to authenticated;

revoke all on function public.void_cash_book_manual_entry(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.void_cash_book_manual_entry(uuid, uuid)
  to authenticated;

revoke all on function public.get_cash_book_day_summary(uuid, date)
  from public, anon, authenticated;
grant execute on function public.get_cash_book_day_summary(uuid, date)
  to authenticated;

revoke all on function public.list_cash_book_day_entries(uuid, date)
  from public, anon, authenticated;
grant execute on function public.list_cash_book_day_entries(uuid, date)
  to authenticated;

revoke all on function public.create_supplier(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.create_supplier(uuid, text, text, text)
  to authenticated;

revoke all on function public.update_supplier(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.update_supplier(uuid, uuid, text, text, text)
  to authenticated;

revoke all on function public.create_expense_record(
  uuid, date, text, uuid, text, text, numeric, text
) from public, anon, authenticated;
grant execute on function public.create_expense_record(
  uuid, date, text, uuid, text, text, numeric, text
) to authenticated;

revoke all on function public.update_expense_record(
  uuid, uuid, date, text, uuid, text, text, numeric, text
) from public, anon, authenticated;
grant execute on function public.update_expense_record(
  uuid, uuid, date, text, uuid, text, text, numeric, text
) to authenticated;

revoke all on function public.void_expense_record(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.void_expense_record(uuid, uuid)
  to authenticated;

revoke all on function public.create_expense_payment(
  uuid, date, numeric, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.create_expense_payment(
  uuid, date, numeric, text, text, jsonb
) to authenticated;

revoke all on function public.list_expense_records(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.list_expense_records(uuid, uuid)
  to authenticated;

revoke all on function public.get_expense_record_payment_state(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_expense_record_payment_state(uuid, uuid)
  to authenticated;

revoke all on function public.get_supplier_expense_summary(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_supplier_expense_summary(uuid, uuid)
  to authenticated;

-- Restore the three 00021 comments to the exact migration text.
comment on table public.customer_payments is
  'Immutable S5A source record for money received from a customer. One row is one real payment event.';
comment on table public.customer_payment_allocations is
  'Immutable explicit distribution of one customer payment across one or more active Challans.';
comment on column public.challans.is_locked is
  'One-way financial lock set atomically when the Challan receives its first positive customer-payment allocation.';

commit;

