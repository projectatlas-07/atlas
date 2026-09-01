-- Atlas Sales S6A: Cash Book source foundation and customer-payment integration.

alter table public.customer_payments
  add column payment_mode text not null default 'unspecified',
  add constraint customer_payments_payment_mode_check check (
    payment_mode in ('cash', 'upi', 'bank_transfer', 'cheque', 'other', 'unspecified')
  );

comment on column public.customer_payments.payment_mode is
  'Recorded payment mode. unspecified is reserved for immutable payments created before S6A.';

drop function public.create_customer_payment(uuid, uuid, date, numeric, text, jsonb);

create function public.create_customer_payment(
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

revoke all on function public.create_customer_payment(
  uuid, uuid, date, numeric, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.create_customer_payment(
  uuid, uuid, date, numeric, text, text, jsonb
) to authenticated;

comment on function public.create_customer_payment(
  uuid, uuid, date, numeric, text, text, jsonb
) is 'S5 atomic customer payment writer with required S6A payment-mode classification.';

create table public.cash_book_initializations (
  factory_id uuid primary key references public.factories(id) on delete restrict,
  start_date date not null,
  opening_balance numeric(18, 2) not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  constraint cash_book_initializations_date_check check (isfinite(start_date)),
  constraint cash_book_initializations_opening_check check (
    opening_balance <> 'NaN'::numeric
    and opening_balance <> 'Infinity'::numeric
    and abs(opening_balance) < 10000000000000000
    and opening_balance = round(opening_balance, 2)
  )
);

create table public.cash_book_manual_entries (
  id uuid primary key,
  factory_id uuid not null references public.factories(id) on delete restrict,
  business_date date not null,
  direction text not null,
  amount numeric(18, 2) not null,
  payment_mode text not null,
  party_details text not null,
  note text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  created_by uuid not null,
  voided_at timestamptz,
  voided_by uuid,
  constraint cash_book_manual_entries_id_factory_key unique (id, factory_id),
  constraint cash_book_manual_entries_date_check check (isfinite(business_date)),
  constraint cash_book_manual_entries_direction_check check (direction in ('in', 'out')),
  constraint cash_book_manual_entries_amount_check check (
    amount > 0
    and amount <> 'NaN'::numeric
    and amount <> 'Infinity'::numeric
    and amount < 10000000000000000
    and amount = round(amount, 2)
  ),
  constraint cash_book_manual_entries_payment_mode_check check (
    payment_mode in ('cash', 'upi', 'bank_transfer', 'cheque', 'other')
  ),
  constraint cash_book_manual_entries_party_check check (
    party_details <> ''
    and party_details = btrim(party_details)
    and party_details = regexp_replace(party_details, '[[:space:]]+', ' ', 'g')
    and length(party_details) <= 200
    and party_details !~ '[[:cntrl:]]'
  ),
  constraint cash_book_manual_entries_note_check check (
    note is null
    or (
      note <> ''
      and note = btrim(note)
      and length(note) <= 500
      and note !~ '[[:cntrl:]]'
    )
  ),
  constraint cash_book_manual_entries_status_check check (status in ('active', 'void')),
  constraint cash_book_manual_entries_void_audit_check check (
    (status = 'active' and voided_at is null and voided_by is null)
    or (status = 'void' and voided_at is not null and voided_by is not null)
  )
);

create index cash_book_manual_entries_factory_date_idx
  on public.cash_book_manual_entries(factory_id, business_date, created_at, id);

alter table public.cash_book_initializations enable row level security;
alter table public.cash_book_manual_entries enable row level security;

revoke all on public.cash_book_initializations from public, anon, authenticated;
revoke all on public.cash_book_manual_entries from public, anon, authenticated;
grant select on public.cash_book_initializations to authenticated;
grant select on public.cash_book_manual_entries to authenticated;

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

create or replace function public.prevent_cash_book_initialization_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'Cash Book initialization is permanent.' using errcode = 'P3206';
end;
$$;

create trigger cash_book_initializations_are_immutable
before update or delete on public.cash_book_initializations
for each row execute function public.prevent_cash_book_initialization_mutation();

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

create trigger cash_book_manual_entries_protect_history
before update or delete on public.cash_book_manual_entries
for each row execute function public.protect_cash_book_manual_entry();

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
    'customer_payment'::text,
    payments.id,
    payments.payment_date,
    'in'::text,
    payments.amount,
    payments.payment_mode,
    payments.customer_name_snapshot,
    coalesce(
      (
        select 'Challans ' || string_agg(
          '#' || challans.challan_number::text,
          ', ' order by challans.challan_number
        )
        from public.customer_payment_allocations as allocations
        join public.challans
          on challans.id = allocations.challan_id
          and challans.factory_id = allocations.factory_id
        where allocations.factory_id = payments.factory_id
          and allocations.payment_id = payments.id
      ),
      'Customer payment'
    ),
    payments.note,
    'active'::text,
    payments.created_at
  from public.customer_payments as payments
  where payments.factory_id = p_factory_id

  union all

  select
    'manual_cash_entry'::text,
    entries.id,
    entries.business_date,
    entries.direction,
    entries.amount,
    entries.payment_mode,
    entries.party_details,
    case entries.direction
      when 'in' then 'Manual Money In'
      else 'Manual Money Out'
    end,
    entries.note,
    entries.status,
    entries.created_at
  from public.cash_book_manual_entries as entries
  where entries.factory_id = p_factory_id;
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

revoke all on function public.prevent_cash_book_initialization_mutation()
  from public, anon, authenticated;
revoke all on function public.protect_cash_book_manual_entry()
  from public, anon, authenticated;
revoke all on function public.get_cash_book_source_movements(uuid)
  from public, anon, authenticated;

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

comment on table public.cash_book_initializations is
  'One immutable factory-level Cash Book start date and opening balance.';
comment on table public.cash_book_manual_entries is
  'Manual operational Money In/Out events. Corrections use void plus a new entry; rows are never deleted.';
comment on function public.get_cash_book_source_movements(uuid) is
  'Private extensible Cash Book source union. Customer payments remain authoritative and appear once per payment header.';
comment on function public.get_cash_book_day_summary(uuid, date) is
  'Derives opening, Money In, Money Out, and closing from initialization plus active source movements.';
