-- Atlas Challan exact brick amount entry: each brick row records whether Rate
-- or Amount was the operator's pricing input while keeping one stored amount.

begin;

lock table public.challans,
  public.challan_items,
  public.challan_flexible_lines,
  public.customer_payment_allocations
in exclusive mode;

alter table public.challan_items
  drop constraint challan_items_rate_check;

alter table public.challan_items
  alter column line_amount drop expression,
  alter column rate_per_1000_bricks type numeric(19, 9),
  add column pricing_mode text not null default 'RATE';

alter table public.challan_items
  add constraint challan_items_pricing_mode_check check (
    pricing_mode in ('RATE', 'AMOUNT')
  ),
  add constraint challan_items_rate_check check (
    rate_per_1000_bricks > 0
    and rate_per_1000_bricks < 1000000000
    and rate_per_1000_bricks <> 'NaN'::numeric
    and rate_per_1000_bricks <> 'Infinity'::numeric
  ),
  add constraint challan_items_pricing_values_check check (
    line_amount >= 0
    and line_amount <> 'NaN'::numeric
    and line_amount <> 'Infinity'::numeric
    and line_amount = round(line_amount, 2)
    and (
      (
        pricing_mode = 'RATE'
        and rate_per_1000_bricks = round(rate_per_1000_bricks, 2)
        and line_amount = round(
          (quantity::numeric * rate_per_1000_bricks) / 1000,
          2
        )
      )
      or (
        pricing_mode = 'AMOUNT'
        and line_amount > 0
        and line_amount < 1000000000
        and rate_per_1000_bricks = round(
          (line_amount * 1000) / quantity::numeric,
          9
        )
      )
    )
  );

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
  item_pricing_mode text;
  item_rate numeric;
  item_amount numeric;
  item_particulars text;
begin
  if p_items is null
    or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) > 100 then
    raise exception 'Challan brick items must be an array of at most 100 items.'
      using errcode = '22023';
  end if;

  for item_value, item_position in
    select item, ordinality::integer
    from jsonb_array_elements(p_items) with ordinality as input(item, ordinality)
  loop
    if jsonb_typeof(item_value) <> 'object'
      or not item_value ? 'brick_type_id'
      or not item_value ? 'quantity'
      or exists (
        select 1
        from jsonb_object_keys(item_value) as supplied(item_key)
        where supplied.item_key not in (
          'brick_type_id', 'quantity', 'pricing_mode', 'rate', 'amount'
        )
      ) then
      raise exception 'Each Challan item contains an unsupported field.'
        using errcode = '22023';
    end if;

    item_pricing_mode := coalesce(item_value ->> 'pricing_mode', 'RATE');
    if (item_value ? 'pricing_mode' and (item_value ->> 'pricing_mode') is null)
      or item_pricing_mode not in ('RATE', 'AMOUNT')
      or (item_pricing_mode = 'RATE' and (
        not item_value ? 'rate' or item_value ? 'amount'
      ))
      or (item_pricing_mode = 'AMOUNT' and (
        not item_value ? 'amount' or item_value ? 'rate'
      )) then
      raise exception 'Each Challan item must supply exactly one pricing input: Rate or Amount.'
        using errcode = '22023';
    end if;

    item_rate := null;
    item_amount := null;
    begin
      item_brick_type_id := (item_value ->> 'brick_type_id')::uuid;
      item_quantity_numeric := (item_value ->> 'quantity')::numeric;
      if item_pricing_mode = 'RATE' then
        item_rate := (item_value ->> 'rate')::numeric;
      else
        item_amount := (item_value ->> 'amount')::numeric;
      end if;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'A Challan item contains an invalid brick type, quantity, Rate, or Amount.'
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
    item_quantity := item_quantity_numeric::bigint;

    if item_pricing_mode = 'RATE' then
      if item_rate is null
        or item_rate = 'NaN'::numeric
        or item_rate = 'Infinity'::numeric
        or item_rate <= 0
        or item_rate >= 1000000000
        or item_rate <> round(item_rate, 2) then
        raise exception 'Challan item Rate must be positive and use at most two decimal places.'
          using errcode = '22023';
      end if;
      item_amount := round((item_quantity_numeric * item_rate) / 1000, 2);
    else
      if item_amount is null
        or item_amount = 'NaN'::numeric
        or item_amount = 'Infinity'::numeric
        or item_amount <= 0
        or item_amount >= 1000000000
        or item_amount <> round(item_amount, 2) then
        raise exception 'Challan item Amount must be positive and use at most two decimal places.'
          using errcode = '22023';
      end if;
      item_rate := round((item_amount * 1000) / item_quantity_numeric, 9);
      if item_rate <= 0 or item_rate >= 1000000000 then
        raise exception 'The derived Challan item Rate is outside the supported range.'
          using errcode = '22023';
      end if;
    end if;

    select name into item_particulars
    from public.brick_types
    where id = item_brick_type_id and factory_id = p_factory_id;
    if not found then
      raise exception 'Brick type does not belong to this factory.' using errcode = 'P3004';
    end if;

    insert into public.challan_items(
      factory_id,
      challan_id,
      brick_type_id,
      brick_particulars_snapshot,
      quantity,
      pricing_mode,
      rate_per_1000_bricks,
      pricing_unit,
      line_amount,
      line_position
    ) values (
      p_factory_id,
      p_challan_id,
      item_brick_type_id,
      item_particulars,
      item_quantity,
      item_pricing_mode,
      item_rate,
      'PER_1000_BRICKS',
      item_amount,
      item_position
    );
  end loop;
end;
$$;

comment on column public.challan_items.pricing_mode is
  'Operator pricing authority for this saved brick row: RATE calculates Amount; AMOUNT preserves exact Amount and derives Rate / 1,000.';
comment on column public.challan_items.rate_per_1000_bricks is
  'Operator-entered two-decimal Rate for RATE rows, or database-derived nine-decimal Rate for AMOUNT rows.';
comment on column public.challan_items.line_amount is
  'Authoritative saved brick revenue. Calculated from Rate for RATE rows; preserved exactly from operator Amount for AMOUNT rows.';
comment on function public.insert_challan_items(uuid, uuid, jsonb) is
  'Private factory-safe brick row writer enforcing exactly one pricing authority and database-derived counterpart values.';

commit;
