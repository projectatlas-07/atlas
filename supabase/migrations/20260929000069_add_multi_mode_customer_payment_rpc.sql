-- Atlas multi-mode customer payments Step 3: add a compatibility-safe RPC
-- contract while keeping all current single-mode callers unchanged.

begin;

alter table public.customer_payments
  drop constraint customer_payments_payment_mode_check,
  add constraint customer_payments_payment_mode_check check (
    payment_mode in (
      'cash', 'upi', 'bank_transfer', 'cheque', 'other', 'unspecified', 'multiple'
    )
  );

comment on column public.customer_payments.payment_mode is
  'Temporary compatibility classification. Single-mode payments store their mode; multi-mode payments store multiple; unspecified is reserved for historical records.';

create function public.create_customer_payment_with_methods(
  p_factory_id uuid,
  p_customer_id uuid,
  p_payment_date date,
  p_amount numeric,
  p_payment_methods jsonb,
  p_note text,
  p_allocations jsonb
)
returns public.customer_payments
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  method_value jsonb;
  method_position integer;
  normalized_method_mode text;
  method_amount numeric;
  method_modes text[] := array[]::text[];
  method_amounts numeric[] := array[]::numeric[];
  method_amount_count integer := 0;
  method_amount_total numeric := 0;
  method_index integer;
  legacy_payment_mode text;
  allocation_value jsonb;
  allocation_position integer;
  allocation_challan_id uuid;
  allocation_amount numeric;
  allocation_challan_ids uuid[] := array[]::uuid[];
  allocation_amounts numeric[] := array[]::numeric[];
  allocation_total numeric := 0;
  allocation_index integer;
  existing_paid numeric;
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

  if p_payment_methods is null
    or jsonb_typeof(p_payment_methods) <> 'array'
    or jsonb_array_length(p_payment_methods) = 0
    or jsonb_array_length(p_payment_methods) > 5 then
    raise exception 'A payment requires between 1 and 5 payment methods.'
      using errcode = 'P3201';
  end if;

  for method_value, method_position in
    select method, ordinality::integer
    from jsonb_array_elements(p_payment_methods)
      with ordinality as supplied(method, ordinality)
  loop
    if jsonb_typeof(method_value) <> 'object'
      or not method_value ? 'mode'
      or jsonb_typeof(method_value -> 'mode') <> 'string'
      or exists (
        select 1
        from jsonb_object_keys(method_value) as supplied_keys(key)
        where supplied_keys.key not in ('mode', 'amount')
      )
      or (
        method_value ? 'amount'
        and jsonb_typeof(method_value -> 'amount') not in ('number', 'null')
      ) then
      raise exception 'Payment method % must contain only a mode and optional numeric amount.',
        method_position using errcode = 'P3201';
    end if;

    normalized_method_mode := lower(btrim(method_value ->> 'mode'));
    if normalized_method_mode not in ('cash', 'upi', 'bank_transfer', 'cheque', 'other') then
      raise exception 'Choose a supported payment mode.' using errcode = 'P3200';
    end if;

    if normalized_method_mode = any(method_modes) then
      raise exception 'The same payment mode cannot appear twice.' using errcode = 'P3203';
    end if;

    method_amount := null;
    if method_value ? 'amount' and jsonb_typeof(method_value -> 'amount') = 'number' then
      begin
        method_amount := (method_value ->> 'amount')::numeric;
      exception when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'Payment method % contains an invalid amount.', method_position
          using errcode = 'P3201';
      end;

      if method_amount <= 0
        or method_amount = 'NaN'::numeric
        or method_amount = 'Infinity'::numeric
        or method_amount >= 10000000000000000
        or method_amount <> round(method_amount, 2) then
        raise exception 'Payment method % amount must be positive and use at most two decimal places.',
          method_position using errcode = 'P3201';
      end if;

      method_amount_count := method_amount_count + 1;
      method_amount_total := method_amount_total + method_amount;
    end if;

    method_modes := array_append(method_modes, normalized_method_mode);
    method_amounts := array_append(method_amounts, method_amount);
  end loop;

  if method_amount_count not in (0, array_length(method_modes, 1)) then
    raise exception 'Provide amounts for every payment method or for none of them.'
      using errcode = 'P3201';
  end if;

  if method_amount_count > 0 and method_amount_total <> p_amount then
    raise exception 'Payment method amounts must sum exactly to the payment amount.'
      using errcode = 'P3202';
  end if;

  legacy_payment_mode := case
    when array_length(method_modes, 1) = 1 then method_modes[1]
    else 'multiple'
  end;

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
    legacy_payment_mode,
    normalized_note
  )
  returning * into new_payment;

  for method_index in 1..array_length(method_modes, 1)
  loop
    insert into public.customer_payment_methods(
      factory_id,
      payment_id,
      mode,
      split_amount,
      created_at
    ) values (
      p_factory_id,
      new_payment.id,
      method_modes[method_index],
      method_amounts[method_index],
      new_payment.created_at
    );
  end loop;

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

revoke all on function public.create_customer_payment_with_methods(
  uuid, uuid, date, numeric, jsonb, text, jsonb
) from public, anon, authenticated;
grant execute on function public.create_customer_payment_with_methods(
  uuid, uuid, date, numeric, jsonb, text, jsonb
) to authenticated;

comment on function public.create_customer_payment_with_methods(
  uuid, uuid, date, numeric, jsonb, text, jsonb
) is
  'Atomically creates one customer payment with one or more unique methods, optional all-or-none explicit method splits, one allocation set, and one Challan lock pass.';

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
  normalized_payment_mode text := lower(btrim(coalesce(p_payment_mode, '')));
  new_payment public.customer_payments%rowtype;
begin
  if normalized_payment_mode not in ('cash', 'upi', 'bank_transfer', 'cheque', 'other') then
    raise exception 'Choose a supported payment mode.' using errcode = 'P3200';
  end if;

  select * into new_payment
  from public.create_customer_payment_with_methods(
    p_factory_id,
    p_customer_id,
    p_payment_date,
    p_amount,
    jsonb_build_array(jsonb_build_object(
      'mode', normalized_payment_mode,
      'amount', null
    )),
    p_note,
    p_allocations
  );

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
) is
  'Compatibility RPC for existing single-mode callers; delegates atomically to create_customer_payment_with_methods with one unsplit method.';

commit;
