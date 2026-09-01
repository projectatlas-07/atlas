-- Atlas Sales correction A4: authoritative combined Challan total.
-- The saved total is derived only from persisted brick revenue and EXTRA_CHARGE rows.

begin;

-- Freeze the four financial write surfaces while the total trigger and the guarded
-- historical reconciliation are installed as one atomic schema change.
lock table public.challans,
  public.challan_items,
  public.challan_flexible_lines,
  public.customer_payment_allocations
in exclusive mode;

create or replace function public.calculate_challan_total(
  p_factory_id uuid,
  p_challan_id uuid
)
returns numeric
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    coalesce((
      select sum(items.line_amount)
      from public.challan_items as items
      where items.factory_id = p_factory_id
        and items.challan_id = p_challan_id
    ), 0)
    + coalesce((
      select sum(lines.amount)
      from public.challan_flexible_lines as lines
      where lines.factory_id = p_factory_id
        and lines.challan_id = p_challan_id
        and lines.line_type = 'EXTRA_CHARGE'
        and lines.line_category = 'OTHER_REVENUE'
    ), 0);
$$;

create or replace function public.refresh_challan_total(
  p_factory_id uuid,
  p_challan_id uuid
)
returns numeric
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  calculated_total numeric;
  previous_internal_flag text := current_setting(
    'atlas.internal_challan_total_write', true
  );
begin
  calculated_total := public.calculate_challan_total(
    p_factory_id,
    p_challan_id
  );
  perform set_config('atlas.internal_challan_total_write', 'on', true);

  update public.challans
  set challan_total = calculated_total
  where id = p_challan_id
    and factory_id = p_factory_id;

  if not found then
    raise exception 'Challan does not belong to this factory.'
      using errcode = 'P3003';
  end if;

  perform set_config(
    'atlas.internal_challan_total_write',
    coalesce(previous_internal_flag, ''),
    true
  );
  return calculated_total;
exception when others then
  perform set_config(
    'atlas.internal_challan_total_write',
    coalesce(previous_internal_flag, ''),
    true
  );
  raise;
end;
$$;

-- Keep the existing trigger entry point so the proven brick-line trigger does not
-- need replacing. Both line tables now delegate to the same persisted-row refresh.
create or replace function public.recalculate_challan_total()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  target_challan_id uuid := case
    when tg_op = 'DELETE' then old.challan_id
    else new.challan_id
  end;
  target_factory_id uuid := case
    when tg_op = 'DELETE' then old.factory_id
    else new.factory_id
  end;
begin
  perform public.refresh_challan_total(
    target_factory_id,
    target_challan_id
  );
  return null;
end;
$$;

create trigger challan_flexible_lines_recalculate_total
after insert or update or delete on public.challan_flexible_lines
for each row execute function public.recalculate_challan_total();

-- Pre-A4 EXTRA_CHARGE rows were possible through the controlled RPC even though
-- no flexible-line UI existed. Never silently rewrite a void, locked, or allocated
-- sale. Stop the migration so that such a protected mismatch can be audited first.
do $$
declare
  protected_mismatch_count bigint;
  protected_locked_count bigint;
  protected_void_count bigint;
  protected_allocated_count bigint;
begin
  select
    count(*),
    count(*) filter (where candidates.is_locked),
    count(*) filter (where candidates.status <> 'active'),
    count(*) filter (where candidates.has_allocations)
  into
    protected_mismatch_count,
    protected_locked_count,
    protected_void_count,
    protected_allocated_count
  from (
    select
      challans.id,
      challans.is_locked,
      challans.status,
      exists (
        select 1
        from public.customer_payment_allocations as allocations
        where allocations.factory_id = challans.factory_id
          and allocations.challan_id = challans.id
      ) as has_allocations
    from public.challans
    where exists (
        select 1
        from public.challan_flexible_lines as lines
        where lines.factory_id = challans.factory_id
          and lines.challan_id = challans.id
          and lines.line_type = 'EXTRA_CHARGE'
          and lines.line_category = 'OTHER_REVENUE'
      )
      and challans.challan_total is distinct from public.calculate_challan_total(
        challans.factory_id,
        challans.id
      )
      and (
        challans.is_locked
        or challans.status <> 'active'
        or exists (
          select 1
          from public.customer_payment_allocations as allocations
          where allocations.factory_id = challans.factory_id
            and allocations.challan_id = challans.id
        )
      )
  ) as candidates;

  if protected_mismatch_count > 0 then
    raise exception 'A4 stopped before changing protected historical Challan totals.'
      using
        errcode = 'P3013',
        detail = format(
          '%s protected mismatch(es): %s locked, %s void, %s with payment allocations.',
          protected_mismatch_count,
          protected_locked_count,
          protected_void_count,
          protected_allocated_count
        ),
        hint = 'Audit these pre-A4 EXTRA_CHARGE Challans and their allocations before rerunning this migration.';
  end if;
end;
$$;

-- Only active, unlocked, unallocated pre-A4 rows are safe to reconcile
-- automatically. Brick-only and NOTE-only history is deliberately untouched.
do $$
declare
  candidate record;
begin
  for candidate in
    select challans.factory_id, challans.id
    from public.challans
    where challans.status = 'active'
      and not challans.is_locked
      and not exists (
        select 1
        from public.customer_payment_allocations as allocations
        where allocations.factory_id = challans.factory_id
          and allocations.challan_id = challans.id
      )
      and exists (
        select 1
        from public.challan_flexible_lines as lines
        where lines.factory_id = challans.factory_id
          and lines.challan_id = challans.id
          and lines.line_type = 'EXTRA_CHARGE'
          and lines.line_category = 'OTHER_REVENUE'
      )
      and challans.challan_total is distinct from public.calculate_challan_total(
        challans.factory_id,
        challans.id
      )
    order by challans.factory_id, challans.id
  loop
    perform public.refresh_challan_total(
      candidate.factory_id,
      candidate.id
    );
  end loop;
end;
$$;

-- A4 retires the temporary no-brick financial restriction. Final validity now has
-- one rule only: at least one persisted brick or flexible document line.
create or replace function public.assert_challan_final_content(
  p_factory_id uuid,
  p_challan_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  has_brick_items boolean;
  has_flexible_lines boolean;
begin
  perform 1
  from public.challans
  where id = p_challan_id
    and factory_id = p_factory_id
  for update;
  if not found then
    raise exception 'Challan does not belong to this factory.' using errcode = 'P3003';
  end if;

  select exists (
    select 1
    from public.challan_items
    where challan_id = p_challan_id
      and factory_id = p_factory_id
  ) into has_brick_items;

  select exists (
    select 1
    from public.challan_flexible_lines
    where challan_id = p_challan_id
      and factory_id = p_factory_id
  ) into has_flexible_lines;

  if not has_brick_items and not has_flexible_lines then
    raise exception 'A Challan must contain at least one meaningful document line.'
      using errcode = 'P3011';
  end if;
end;
$$;

-- Keep the header guard behavior unchanged; only correct its now-stale description
-- of the internal total source.
create or replace function public.guard_challan_header_update()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.status = 'void' then
    raise exception 'A void Challan cannot be changed.' using errcode = 'P3006';
  end if;

  if old.is_locked then
    raise exception 'A locked Challan cannot be changed.' using errcode = 'P3005';
  end if;

  if new.id <> old.id
    or new.factory_id <> old.factory_id
    or new.challan_number <> old.challan_number
    or new.company_name_snapshot <> old.company_name_snapshot
    or new.company_business_description_snapshot
      <> old.company_business_description_snapshot
    or new.company_address_snapshot <> old.company_address_snapshot
    or new.company_mobile_snapshot <> old.company_mobile_snapshot
    or new.company_village_snapshot is distinct from old.company_village_snapshot
    or new.company_post_office_snapshot is distinct from old.company_post_office_snapshot
    or new.company_police_station_snapshot is distinct from old.company_police_station_snapshot
    or new.company_district_snapshot is distinct from old.company_district_snapshot
    or new.company_state_snapshot is distinct from old.company_state_snapshot
    or new.created_at <> old.created_at then
    raise exception 'Permanent Challan identity and company snapshots cannot be changed.'
      using errcode = 'P3007';
  end if;

  if new.challan_total is distinct from old.challan_total
    and current_setting('atlas.internal_challan_total_write', true) is distinct from 'on' then
    raise exception 'Challan totals can only be derived from persisted Challan lines.'
      using errcode = 'P3008';
  end if;

  if new.status <> old.status and new.status <> 'void' then
    raise exception 'A Challan can only transition from active to void.'
      using errcode = 'P3009';
  end if;

  if old.is_locked and not new.is_locked then
    raise exception 'A Challan financial lock cannot be removed.'
      using errcode = 'P3005';
  end if;

  return new;
end;
$$;

revoke all on function public.calculate_challan_total(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.refresh_challan_total(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.recalculate_challan_total()
  from public, anon, authenticated;
revoke all on function public.assert_challan_final_content(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.guard_challan_header_update()
  from public, anon, authenticated;

comment on function public.calculate_challan_total(uuid, uuid) is
  'Private A4 authority: sums persisted brick line_amount plus persisted EXTRA_CHARGE amount for one factory-scoped Challan.';
comment on function public.refresh_challan_total(uuid, uuid) is
  'Private A4 writer: persists the shared combined-total calculation through the protected internal total path.';
comment on function public.recalculate_challan_total() is
  'A4 row-trigger adapter shared by brick and flexible Challan lines.';
comment on function public.assert_challan_final_content(uuid, uuid) is
  'A4 final-state guard: requires at least one persisted brick or flexible document line.';
comment on function public.guard_challan_header_update() is
  'Protects permanent Challan identity, snapshots, lifecycle, lock, and database-authoritative total.';
comment on column public.challans.challan_total is
  'Database-authoritative combined sale total: brick line_amount plus EXTRA_CHARGE amount; NOTE contributes zero.';
comment on column public.challan_flexible_lines.amount is
  'Database-authoritative line amount. NOTE is zero; EXTRA_CHARGE is explicit or round(quantity * rate, 2) and contributes to challan_total.';
comment on function public.create_challan(uuid, date, uuid, text, numeric, jsonb) is
  'Backward-compatible brick-only create entry point using A4 authoritative combined totals.';
comment on function public.create_challan(uuid, date, uuid, text, numeric, jsonb, jsonb) is
  'Combined-content create entry point. Any non-empty brick/flexible document is valid and its saved total is database-authoritative.';
comment on function public.update_challan(uuid, uuid, date, uuid, text, numeric, jsonb) is
  'Backward-compatible update entry point. Flexible lines are preserved and remain part of the A4 combined total.';
comment on function public.update_challan(uuid, uuid, date, uuid, text, numeric, jsonb, jsonb) is
  'Combined-content update entry point. NULL preserves flexible lines; an array replaces them before final validation and combined-total return.';

commit;
