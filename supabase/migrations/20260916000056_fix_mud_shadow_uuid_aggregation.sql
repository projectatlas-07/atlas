begin;

-- PostgreSQL does not provide min(uuid). Keep the Phase 4 readout unchanged
-- except for selecting the sole group through its ordered text form.
create or replace function public.get_mud_shadow_weekly_comparisons(
  p_factory_id uuid,
  p_from_week_start date,
  p_to_week_start date
)
returns table (
  week_start date,
  labour_group_id uuid,
  legacy_weekly_earning_id uuid,
  legacy_earning numeric,
  new_engine_earning numeric,
  difference numeric,
  status text,
  detail text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  business_today date := (now() at time zone 'Asia/Kolkata')::date;
  legacy_row record;
  resolved_new_earning numeric;
  resolved_group_count integer;
  resolved_group_id uuid;
  resolved_rate_count integer;
  inconsistent_date date;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;
  if p_from_week_start is null or p_to_week_start is null
    or not isfinite(p_from_week_start) or not isfinite(p_to_week_start)
    or extract(isodow from p_from_week_start) <> 1
    or extract(isodow from p_to_week_start) <> 1
    or p_from_week_start > p_to_week_start then
    raise exception 'A valid inclusive range of Monday week starts is required.' using errcode = '22023';
  end if;
  if p_to_week_start + 6 >= business_today then
    raise exception 'SHADOW comparison is available only for completed Monday-Sunday weeks.' using errcode = 'P3000';
  end if;
  if not exists (
    select 1 from public.mud_accounting_states
    where mud_accounting_states.factory_id = p_factory_id
      and mud_accounting_states.accounting_mode = 'SHADOW'
  ) then
    raise exception 'Mud SHADOW comparison requires the factory to be in SHADOW mode.' using errcode = 'P3001';
  end if;

  for legacy_row in
    select
      earnings.id,
      earnings.labour_group_id,
      earnings.week_start,
      earnings.amount
    from public.weekly_earnings as earnings
    where earnings.factory_id = p_factory_id
      and earnings.labour_group_id is not null
      and earnings.labourer_id is null
      and earnings.week_start >= p_from_week_start
      and earnings.week_start <= p_to_week_start
    order by earnings.week_start
  loop
    week_start := legacy_row.week_start;
    labour_group_id := legacy_row.labour_group_id;
    legacy_weekly_earning_id := legacy_row.id;
    legacy_earning := legacy_row.amount;
    new_engine_earning := null;
    difference := null;
    status := null;
    detail := null;

    begin
      with allocation as materialized (
        select *
        from public.get_mud_group_range_allocation(
          p_factory_id,
          legacy_row.week_start,
          legacy_row.week_start + 6
        )
      )
      select
        coalesce(sum(allocation.earned_amount), 0),
        count(distinct allocation.labour_group_id),
        min(allocation.labour_group_id::text)::uuid,
        count(distinct allocation.mud_group_rate_id)
      into
        resolved_new_earning,
        resolved_group_count,
        resolved_group_id,
        resolved_rate_count
      from allocation;

      if resolved_group_count <> 1 or resolved_group_id <> legacy_row.labour_group_id then
        raise exception 'SHADOW single-group validation requires the same one Mud group for the full week.'
          using errcode = 'P3002';
      end if;

      with allocation as materialized (
        select *
        from public.get_mud_group_range_allocation(
          p_factory_id,
          legacy_row.week_start,
          legacy_row.week_start + 6
        )
      )
      select allocation.production_date
      into inconsistent_date
      from allocation
      group by allocation.production_date
      having sum(allocation.allocated_production) <> max(allocation.eligible_factory_production)
      order by allocation.production_date
      limit 1;

      if inconsistent_date is not null then
        raise exception 'Mud allocation did not exactly preserve Production on %.', inconsistent_date
          using errcode = 'P3003';
      end if;

      new_engine_earning := resolved_new_earning;
      difference := resolved_new_earning - legacy_row.amount;

      if difference = 0 then
        status := 'PARITY_OK';
        detail := 'Legacy weekly and new daily earnings match exactly.';
      elsif resolved_rate_count > 1 then
        status := 'EXPECTED_RATE_CHANGE_DIFFERENCE';
        detail := 'The new engine applied dated daily rates; legacy used the Monday rate for the full week.';
      else
        status := 'UNEXPECTED_MISMATCH';
        detail := 'A constant-rate single-group week did not match legacy weekly earnings.';
      end if;
    exception
      when sqlstate 'P2701' or sqlstate 'P2702' or sqlstate 'P2703'
        or sqlstate 'P2704' or sqlstate 'P2705'
        or sqlstate 'P3002' or sqlstate 'P3003' then
        new_engine_earning := null;
        difference := null;
        status := 'CONFIGURATION_ERROR';
        detail := sqlerrm;
    end;

    return next;
  end loop;
end;
$$;

comment on function public.get_mud_shadow_weekly_comparisons(uuid, date, date) is
  'Read-only completed-week comparison of locked legacy Mud earnings against the daily engine while a factory is in SHADOW mode.';

commit;
