-- Atlas Sales correction A2: relational NOTE and EXTRA_CHARGE Challan lines.
-- Flexible financial amounts are authoritative per line but intentionally do not
-- contribute to challans.challan_total until the separate A4 milestone.

create table public.challan_flexible_lines (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  challan_id uuid not null,
  line_type text not null,
  line_category text not null,
  order_index integer not null,
  particulars text not null,
  quantity numeric(18, 3),
  rate numeric(18, 2),
  amount numeric(18, 2) not null,
  created_at timestamptz not null default now(),
  constraint challan_flexible_lines_id_factory_key unique (id, factory_id),
  constraint challan_flexible_lines_challan_factory_fkey
    foreign key (challan_id, factory_id)
    references public.challans(id, factory_id) on delete restrict,
  constraint challan_flexible_lines_order_key unique (challan_id, order_index),
  constraint challan_flexible_lines_type_check check (
    line_type in ('NOTE', 'EXTRA_CHARGE')
  ),
  constraint challan_flexible_lines_category_check check (
    line_category in ('OTHER_REVENUE', 'NON_FINANCIAL')
  ),
  constraint challan_flexible_lines_order_check check (order_index >= 0),
  constraint challan_flexible_lines_particulars_check check (
    particulars <> ''
    and particulars = btrim(particulars)
    and particulars = regexp_replace(particulars, '[[:space:]]+', ' ', 'g')
    and particulars !~ '[[:cntrl:]]'
    and length(particulars) <= 500
  ),
  constraint challan_flexible_lines_quantity_check check (
    quantity is null
    or (
      quantity > 0
      and quantity < 1000000000
      and quantity <> 'NaN'::numeric
      and quantity <> 'Infinity'::numeric
    )
  ),
  constraint challan_flexible_lines_rate_check check (
    rate is null
    or (
      rate > 0
      and rate < 1000000000
      and rate <> 'NaN'::numeric
      and rate <> 'Infinity'::numeric
    )
  ),
  constraint challan_flexible_lines_amount_check check (
    amount >= 0
    and amount < 1000000000
    and amount <> 'NaN'::numeric
    and amount <> 'Infinity'::numeric
  ),
  constraint challan_flexible_lines_semantics_check check (
    (
      line_type = 'NOTE'
      and line_category = 'NON_FINANCIAL'
      and quantity is null
      and rate is null
      and amount = 0
    )
    or
    (
      line_type = 'EXTRA_CHARGE'
      and line_category = 'OTHER_REVENUE'
      and amount > 0
      and (
        (quantity is null and rate is null)
        or
        (
          quantity is not null
          and rate is not null
          and amount = round(quantity * rate, 2)
        )
      )
    )
  )
);

create index challan_flexible_lines_factory_challan_order_idx
  on public.challan_flexible_lines(factory_id, challan_id, order_index);

alter table public.challan_flexible_lines enable row level security;

revoke all on public.challan_flexible_lines from anon, authenticated;
grant select on public.challan_flexible_lines to authenticated;

create policy "Authenticated users can read their factory Sales Challan flexible lines"
  on public.challan_flexible_lines
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = challan_flexible_lines.factory_id
        and factory_users.is_active = true
    )
  );

create or replace function public.guard_challan_flexible_line_mutation()
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
    raise exception 'A flexible Challan line cannot be moved to a different Challan.'
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

create trigger challan_flexible_lines_guard_mutation
before insert or update or delete on public.challan_flexible_lines
for each row execute function public.guard_challan_flexible_line_mutation();

create or replace function public.replace_challan_flexible_lines(
  p_factory_id uuid,
  p_challan_id uuid,
  p_lines jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  parent_status text;
  parent_is_locked boolean;
  line_value jsonb;
  parsed_line_type text;
  parsed_order_numeric numeric;
  parsed_order_index integer;
  normalized_particulars text;
  quantity_supplied boolean;
  rate_supplied boolean;
  amount_supplied boolean;
  parsed_quantity numeric;
  parsed_rate numeric;
  parsed_amount numeric;
  calculated_amount numeric;
begin
  select status, is_locked
  into parent_status, parent_is_locked
  from public.challans
  where id = p_challan_id
    and factory_id = p_factory_id
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

  if p_lines is null
    or jsonb_typeof(p_lines) <> 'array'
    or jsonb_array_length(p_lines) > 100 then
    raise exception 'Flexible Challan lines must be an array of at most 100 lines.'
      using errcode = '22023';
  end if;

  delete from public.challan_flexible_lines
  where challan_id = p_challan_id
    and factory_id = p_factory_id;

  for line_value in
    select line from jsonb_array_elements(p_lines) as input(line)
  loop
    if jsonb_typeof(line_value) <> 'object'
      or not line_value ? 'line_type'
      or not line_value ? 'order_index'
      or not line_value ? 'particulars' then
      raise exception 'Each flexible Challan line requires line_type, order_index, and particulars.'
        using errcode = '22023';
    end if;

    parsed_line_type := line_value ->> 'line_type';
    if parsed_line_type is null
      or parsed_line_type not in ('NOTE', 'EXTRA_CHARGE') then
      raise exception 'Flexible Challan line_type must be NOTE or EXTRA_CHARGE.'
        using errcode = '22023';
    end if;

    if jsonb_typeof(line_value -> 'order_index') <> 'number' then
      raise exception 'Flexible Challan order_index must be a non-negative whole number.'
        using errcode = '22023';
    end if;
    begin
      parsed_order_numeric := (line_value ->> 'order_index')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Flexible Challan order_index must be a non-negative whole number.'
        using errcode = '22023';
    end;
    if parsed_order_numeric is null
      or parsed_order_numeric = 'NaN'::numeric
      or parsed_order_numeric = 'Infinity'::numeric
      or parsed_order_numeric < 0
      or parsed_order_numeric > 2147483647
      or parsed_order_numeric <> trunc(parsed_order_numeric) then
      raise exception 'Flexible Challan order_index must be a non-negative whole number.'
        using errcode = '22023';
    end if;
    parsed_order_index := parsed_order_numeric::integer;

    if jsonb_typeof(line_value -> 'particulars') <> 'string' then
      raise exception 'Flexible Challan line particulars must be meaningful text.'
        using errcode = '22023';
    end if;
    normalized_particulars := btrim(regexp_replace(
      coalesce(line_value ->> 'particulars', ''), '[[:space:]]+', ' ', 'g'
    ));
    if normalized_particulars = ''
      or normalized_particulars ~ '[[:cntrl:]]'
      or length(normalized_particulars) > 500 then
      raise exception 'Flexible Challan line particulars must be meaningful text of at most 500 characters.'
        using errcode = '22023';
    end if;

    if parsed_line_type = 'NOTE' then
      if exists (
        select 1
        from jsonb_object_keys(line_value) as supplied(key)
        where supplied.key not in ('line_type', 'order_index', 'particulars')
      ) then
        raise exception 'A NOTE can contain only line_type, order_index, and particulars; its amount is always zero.'
          using errcode = '22023';
      end if;

      insert into public.challan_flexible_lines(
        factory_id, challan_id, line_type, line_category,
        order_index, particulars, quantity, rate, amount
      ) values (
        p_factory_id, p_challan_id, 'NOTE', 'NON_FINANCIAL',
        parsed_order_index, normalized_particulars, null, null, 0
      );
      continue;
    end if;

    if exists (
      select 1
      from jsonb_object_keys(line_value) as supplied(key)
      where supplied.key not in (
        'line_type', 'order_index', 'particulars', 'quantity', 'rate', 'amount'
      )
    ) then
      raise exception 'An EXTRA_CHARGE contains unsupported fields.' using errcode = '22023';
    end if;

    quantity_supplied := line_value ? 'quantity';
    rate_supplied := line_value ? 'rate';
    amount_supplied := line_value ? 'amount';

    if quantity_supplied <> rate_supplied then
      raise exception 'EXTRA_CHARGE quantity and rate must be supplied together.'
        using errcode = '22023';
    end if;

    if quantity_supplied then
      if jsonb_typeof(line_value -> 'quantity') <> 'number'
        or jsonb_typeof(line_value -> 'rate') <> 'number' then
        raise exception 'EXTRA_CHARGE quantity and rate must be valid numbers.'
          using errcode = '22023';
      end if;
      begin
        parsed_quantity := (line_value ->> 'quantity')::numeric;
        parsed_rate := (line_value ->> 'rate')::numeric;
      exception when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'EXTRA_CHARGE quantity and rate must be valid numbers.'
          using errcode = '22023';
      end;

      if parsed_quantity is null
        or parsed_quantity = 'NaN'::numeric
        or parsed_quantity = 'Infinity'::numeric
        or parsed_quantity <= 0
        or parsed_quantity >= 1000000000
        or parsed_quantity <> round(parsed_quantity, 3) then
        raise exception 'EXTRA_CHARGE quantity must be positive and use at most three decimal places.'
          using errcode = '22023';
      end if;
      if parsed_rate is null
        or parsed_rate = 'NaN'::numeric
        or parsed_rate = 'Infinity'::numeric
        or parsed_rate <= 0
        or parsed_rate >= 1000000000
        or parsed_rate <> round(parsed_rate, 2) then
        raise exception 'EXTRA_CHARGE rate must be positive and use at most two decimal places.'
          using errcode = '22023';
      end if;

      calculated_amount := round(parsed_quantity * parsed_rate, 2);
      if calculated_amount <= 0 or calculated_amount >= 1000000000 then
        raise exception 'Calculated EXTRA_CHARGE amount is outside the supported range.'
          using errcode = '22023';
      end if;

      if amount_supplied then
        if jsonb_typeof(line_value -> 'amount') <> 'number' then
          raise exception 'EXTRA_CHARGE amount must be a valid number.' using errcode = '22023';
        end if;
        begin
          parsed_amount := (line_value ->> 'amount')::numeric;
        exception when invalid_text_representation or numeric_value_out_of_range then
          raise exception 'EXTRA_CHARGE amount must be a valid number.' using errcode = '22023';
        end;
        if parsed_amount is null
          or parsed_amount = 'NaN'::numeric
          or parsed_amount = 'Infinity'::numeric
          or parsed_amount <> round(parsed_amount, 2)
          or parsed_amount <> calculated_amount then
          raise exception 'EXTRA_CHARGE amount must equal quantity multiplied by rate.'
            using errcode = '22023';
        end if;
      end if;
      parsed_amount := calculated_amount;
    else
      if not amount_supplied then
        raise exception 'EXTRA_CHARGE requires either an amount or a complete quantity and rate pair.'
          using errcode = '22023';
      end if;
      if jsonb_typeof(line_value -> 'amount') <> 'number' then
        raise exception 'EXTRA_CHARGE amount must be a valid number.' using errcode = '22023';
      end if;
      begin
        parsed_amount := (line_value ->> 'amount')::numeric;
      exception when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'EXTRA_CHARGE amount must be a valid number.' using errcode = '22023';
      end;
      if parsed_amount is null
        or parsed_amount = 'NaN'::numeric
        or parsed_amount = 'Infinity'::numeric
        or parsed_amount <= 0
        or parsed_amount >= 1000000000
        or parsed_amount <> round(parsed_amount, 2) then
        raise exception 'EXTRA_CHARGE amount must be positive and use at most two decimal places.'
          using errcode = '22023';
      end if;
      parsed_quantity := null;
      parsed_rate := null;
    end if;

    insert into public.challan_flexible_lines(
      factory_id, challan_id, line_type, line_category,
      order_index, particulars, quantity, rate, amount
    ) values (
      p_factory_id, p_challan_id, 'EXTRA_CHARGE', 'OTHER_REVENUE',
      parsed_order_index, normalized_particulars,
      parsed_quantity, parsed_rate, parsed_amount
    );
  end loop;
end;
$$;

-- Keep both original RPC signatures unchanged for existing clients. The overloads
-- add atomic flexible-line writes only when the new parameter is supplied.
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
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  new_challan public.challans%rowtype;
begin
  select * into new_challan
  from public.create_challan(
    p_factory_id,
    p_challan_date,
    p_customer_id,
    p_vehicle_number,
    p_tractor_labour_rate,
    p_items
  );

  perform public.replace_challan_flexible_lines(
    p_factory_id,
    new_challan.id,
    coalesce(p_flexible_lines, '[]'::jsonb)
  );

  select * into new_challan
  from public.challans
  where id = new_challan.id
    and factory_id = p_factory_id;
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
  p_items jsonb,
  p_flexible_lines jsonb
)
returns public.challans
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  updated_challan public.challans%rowtype;
begin
  select * into updated_challan
  from public.update_challan(
    p_factory_id,
    p_challan_id,
    p_challan_date,
    p_customer_id,
    p_vehicle_number,
    p_tractor_labour_rate,
    p_items
  );

  -- NULL means an old/update-only-brick client omitted the collection, so preserve it.
  -- An explicit [] means replace the collection with no flexible lines.
  if p_flexible_lines is not null then
    perform public.replace_challan_flexible_lines(
      p_factory_id,
      p_challan_id,
      p_flexible_lines
    );
  end if;

  select * into updated_challan
  from public.challans
  where id = p_challan_id
    and factory_id = p_factory_id;
  return updated_challan;
end;
$$;

revoke all on function public.guard_challan_flexible_line_mutation()
  from public, anon, authenticated;
revoke all on function public.replace_challan_flexible_lines(uuid, uuid, jsonb)
  from public, anon, authenticated;

revoke all on function public.create_challan(
  uuid, date, uuid, text, numeric, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.create_challan(
  uuid, date, uuid, text, numeric, jsonb, jsonb
) to authenticated;

revoke all on function public.update_challan(
  uuid, uuid, date, uuid, text, numeric, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.update_challan(
  uuid, uuid, date, uuid, text, numeric, jsonb, jsonb
) to authenticated;

comment on table public.challan_flexible_lines is
  'Factory-scoped manual Challan lines. A2 supports NOTE and EXTRA_CHARGE only; no rows are backfilled.';
comment on column public.challan_flexible_lines.line_type is
  'A2 values: NOTE or EXTRA_CHARGE. OTHER_GOODS is intentionally unsupported.';
comment on column public.challan_flexible_lines.line_category is
  'Reporting category derived by the database: NON_FINANCIAL for NOTE, OTHER_REVENUE for EXTRA_CHARGE.';
comment on column public.challan_flexible_lines.order_index is
  'Explicit non-negative display order, unique within one Challan.';
comment on column public.challan_flexible_lines.amount is
  'Database-authoritative line amount. NOTE is 0; EXTRA_CHARGE is explicit or round(quantity * rate, 2). Excluded from challan_total until A4.';
comment on function public.replace_challan_flexible_lines(uuid, uuid, jsonb) is
  'Private atomic replacement helper. The parent Challan must be active and unlocked.';
comment on function public.create_challan(uuid, date, uuid, text, numeric, jsonb, jsonb) is
  'A2 overload: creates the existing brick Challan and its optional flexible lines atomically.';
comment on function public.update_challan(uuid, uuid, date, uuid, text, numeric, jsonb, jsonb) is
  'A2 overload: updates brick lines atomically; NULL preserves flexible lines and an array replaces them.';
