-- Atlas Sales S5A: immutable customer payments with explicit Challan allocations.

create table public.customer_payments (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  customer_id uuid not null,
  payment_date date not null,
  amount numeric(18, 2) not null,
  note text,
  created_at timestamptz not null default now(),
  constraint customer_payments_id_factory_key unique (id, factory_id),
  constraint customer_payments_customer_factory_fkey
    foreign key (customer_id, factory_id)
    references public.customers(id, factory_id) on delete restrict,
  constraint customer_payments_date_finite_check check (isfinite(payment_date)),
  constraint customer_payments_amount_check check (
    amount > 0
    and amount <> 'NaN'::numeric
    and amount <> 'Infinity'::numeric
  ),
  constraint customer_payments_note_check check (
    note is null
    or (
      note <> ''
      and note = btrim(note)
      and length(note) <= 500
      and note !~ '[[:cntrl:]]'
    )
  )
);

create table public.customer_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  payment_id uuid not null,
  challan_id uuid not null,
  allocated_amount numeric(18, 2) not null,
  created_at timestamptz not null default now(),
  constraint customer_payment_allocations_id_factory_key unique (id, factory_id),
  constraint customer_payment_allocations_payment_challan_key
    unique (payment_id, challan_id),
  constraint customer_payment_allocations_payment_factory_fkey
    foreign key (payment_id, factory_id)
    references public.customer_payments(id, factory_id) on delete restrict,
  constraint customer_payment_allocations_challan_factory_fkey
    foreign key (challan_id, factory_id)
    references public.challans(id, factory_id) on delete restrict,
  constraint customer_payment_allocations_amount_check check (
    allocated_amount > 0
    and allocated_amount <> 'NaN'::numeric
    and allocated_amount <> 'Infinity'::numeric
  )
);

create index customer_payments_factory_customer_history_idx
  on public.customer_payments(
    factory_id,
    customer_id,
    payment_date desc,
    created_at desc,
    id desc
  );

create index customer_payment_allocations_factory_challan_idx
  on public.customer_payment_allocations(factory_id, challan_id, created_at, id);

create index customer_payment_allocations_factory_payment_idx
  on public.customer_payment_allocations(factory_id, payment_id, created_at, id);

alter table public.customer_payments enable row level security;
alter table public.customer_payment_allocations enable row level security;

revoke all on public.customer_payments from public, anon, authenticated;
revoke all on public.customer_payment_allocations from public, anon, authenticated;
grant select on public.customer_payments to authenticated;
grant select on public.customer_payment_allocations to authenticated;

create policy "Authenticated users can read their factory customer payments"
  on public.customer_payments
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = customer_payments.factory_id
        and factory_users.is_active = true
    )
  );

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

create or replace function public.prevent_customer_payment_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'Customer payment history is immutable.' using errcode = 'P3106';
end;
$$;

create trigger customer_payments_prevent_update_delete
before update or delete on public.customer_payments
for each row execute function public.prevent_customer_payment_mutation();

create trigger customer_payment_allocations_prevent_update_delete
before update or delete on public.customer_payment_allocations
for each row execute function public.prevent_customer_payment_mutation();

create or replace function public.create_customer_payment(
  p_factory_id uuid,
  p_customer_id uuid,
  p_payment_date date,
  p_amount numeric,
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

  -- Every payment writer locks touched Challans in the same UUID order. A concurrent
  -- writer must wait, then recompute paid/outstanding from committed allocations.
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
    note
  ) values (
    p_factory_id,
    p_customer_id,
    p_payment_date,
    p_amount,
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

revoke all on function public.prevent_customer_payment_mutation()
  from public, anon, authenticated;

revoke all on function public.create_customer_payment(uuid, uuid, date, numeric, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_customer_payment(uuid, uuid, date, numeric, text, jsonb)
  to authenticated;

revoke all on function public.get_challan_payment_state(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_challan_payment_state(uuid, uuid)
  to authenticated;

revoke all on function public.get_customer_sales_summary(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_customer_sales_summary(uuid, uuid)
  to authenticated;

comment on table public.customer_payments is
  'Immutable S5A source record for money received from a customer. One row is one real payment event.';
comment on table public.customer_payment_allocations is
  'Immutable explicit distribution of one customer payment across one or more active Challans.';
comment on column public.challans.is_locked is
  'One-way financial lock set atomically when the Challan receives its first positive customer-payment allocation.';
comment on function public.create_customer_payment(uuid, uuid, date, numeric, text, jsonb) is
  'Atomically validates explicit allocations, prevents overpayment under row locks, writes one payment plus children, and locks only touched Challans.';
