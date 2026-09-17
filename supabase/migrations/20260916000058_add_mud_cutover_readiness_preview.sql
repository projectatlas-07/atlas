begin;

-- Mud Phase 4C: read-only cutover readiness and Legacy Opening preview.
-- This function derives a proposal from stored legacy accounting. It creates
-- no settlement, opening, transition, or other financial row.

create or replace function public.calculate_mud_cutover_readiness(
  p_factory_id uuid,
  p_cutoff_override date default null
)
returns table (
  readiness_status text,
  reason text,
  certification_week date,
  final_legacy_week_start date,
  final_legacy_week_end date,
  proposed_legacy_cutoff date,
  settlement_start_date date,
  labour_group_id uuid,
  group_name text,
  legacy_locked_earning_total numeric,
  existing_withdrawals numeric,
  proposed_opening_amount numeric,
  resulting_balance numeric
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  current_mode public.mud_accounting_mode;
  certification record;
  resolved_final_week date;
  resolved_cutoff date;
  resolved_settlement_start date;
  preview_group record;
  group_count integer;
  configured_group_count integer;
  configured_production bigint;
  configured_allocation bigint;
begin
  select states.accounting_mode into current_mode
  from public.mud_accounting_states as states
  where states.factory_id = p_factory_id;
  if not found then
    raise exception 'Mud accounting state is missing for this factory.' using errcode = 'P2803';
  end if;

  if current_mode <> 'SHADOW' then
    return query select
      'BLOCKED'::text,
      'Mud cutover readiness requires SHADOW accounting mode.'::text,
      null::date, null::date, null::date, null::date, null::date,
      null::uuid, null::text, null::numeric, null::numeric, null::numeric, null::numeric;
    return;
  end if;

  select * into certification
  from public.get_mud_shadow_certification_status(p_factory_id);
  if certification.certification_status <> 'READY'
    or certification.parity_status <> 'PARITY_OK' then
    return query select
      'BLOCKED'::text,
      ('SHADOW certification is not READY: ' || certification.reason)::text,
      certification.certification_week,
      null::date, null::date, null::date, null::date,
      null::uuid, null::text, null::numeric, null::numeric, null::numeric, null::numeric;
    return;
  end if;

  if exists (
    select 1 from public.mud_factory_settlements as settlements
    where settlements.factory_id = p_factory_id
  ) then
    return query select
      'BLOCKED'::text,
      'A Mud settlement already exists; duplicate cutover is not allowed.'::text,
      certification.certification_week,
      null::date, null::date, null::date, null::date,
      null::uuid, null::text, null::numeric, null::numeric, null::numeric, null::numeric;
    return;
  end if;
  if exists (
    select 1 from public.mud_group_legacy_openings as openings
    where openings.factory_id = p_factory_id
  ) then
    return query select
      'BLOCKED'::text,
      'A Mud Legacy Opening already exists; duplicate cutover is not allowed.'::text,
      certification.certification_week,
      null::date, null::date, null::date, null::date,
      null::uuid, null::text, null::numeric, null::numeric, null::numeric, null::numeric;
    return;
  end if;

  select max(weekly.week_start) into resolved_final_week
  from public.weekly_earnings as weekly
  where weekly.factory_id = p_factory_id
    and weekly.labour_group_id is not null
    and weekly.labourer_id is null;

  if resolved_final_week is null or resolved_final_week <> certification.certification_week then
    return query select
      'BLOCKED'::text,
      'The final locked legacy Mud week does not match the PARITY_OK certification week.'::text,
      certification.certification_week,
      resolved_final_week,
      case when resolved_final_week is null then null else resolved_final_week + 6 end,
      null::date, null::date,
      null::uuid, null::text, null::numeric, null::numeric, null::numeric, null::numeric;
    return;
  end if;

  resolved_cutoff := coalesce(p_cutoff_override, resolved_final_week + 6);
  resolved_settlement_start := resolved_cutoff + 1;
  if resolved_cutoff <> resolved_final_week + 6
    or extract(isodow from resolved_final_week) <> 1
    or extract(isodow from resolved_cutoff) <> 7
    or extract(isodow from resolved_settlement_start) <> 1 then
    return query select
      'BLOCKED'::text,
      'Mud cutover must use the final locked Monday-Sunday week and begin settlement accounting on the following Monday.'::text,
      certification.certification_week,
      resolved_final_week,
      resolved_final_week + 6,
      resolved_cutoff,
      resolved_settlement_start,
      null::uuid, null::text, null::numeric, null::numeric, null::numeric, null::numeric;
    return;
  end if;

  if exists (
    select 1 from public.withdrawals as withdrawals
    where withdrawals.factory_id = p_factory_id
      and withdrawals.labour_group_id is not null
      and withdrawals.labourer_id is null
      and withdrawals.withdrawal_date > resolved_cutoff
  ) then
    return query select
      'BLOCKED'::text,
      'A legacy Mud withdrawal exists after the proposed Sunday cutoff.'::text,
      certification.certification_week,
      resolved_final_week,
      resolved_final_week + 6,
      resolved_cutoff,
      resolved_settlement_start,
      null::uuid, null::text, null::numeric, null::numeric, null::numeric, null::numeric;
    return;
  end if;

  select count(*) into group_count
  from public.labour_groups as groups
  where groups.factory_id = p_factory_id;
  if group_count = 0 then
    return query select
      'BLOCKED'::text,
      'No Mud groups exist for the Legacy Opening preview.'::text,
      certification.certification_week,
      resolved_final_week,
      resolved_final_week + 6,
      resolved_cutoff,
      resolved_settlement_start,
      null::uuid, null::text, null::numeric, null::numeric, null::numeric, null::numeric;
    return;
  end if;

  for preview_group in
    select
      groups.id,
      groups.name,
      coalesce((
        select sum(weekly.amount)
        from public.weekly_earnings as weekly
        where weekly.factory_id = p_factory_id
          and weekly.labour_group_id = groups.id
          and weekly.labourer_id is null
          and weekly.week_start + 6 <= resolved_cutoff
      ), 0) as locked_earned,
      coalesce((
        select sum(withdrawals.amount)
        from public.withdrawals as withdrawals
        where withdrawals.factory_id = p_factory_id
          and withdrawals.labour_group_id = groups.id
          and withdrawals.labourer_id is null
          and withdrawals.withdrawal_date <= resolved_cutoff
      ), 0) as withdrawn
    from public.labour_groups as groups
    where groups.factory_id = p_factory_id
    order by groups.name, groups.id
  loop
    if preview_group.locked_earned - preview_group.withdrawn < 0 then
      return query select
        'BLOCKED'::text,
        format('Mud group %s cannot reconcile: withdrawals exceed locked legacy earnings.', preview_group.name)::text,
        certification.certification_week,
        resolved_final_week,
        resolved_final_week + 6,
        resolved_cutoff,
        resolved_settlement_start,
        preview_group.id,
        preview_group.name,
        preview_group.locked_earned,
        preview_group.withdrawn,
        preview_group.locked_earned,
        preview_group.locked_earned - preview_group.withdrawn;
      return;
    end if;
  end loop;

  begin
    select
      count(*),
      max(allocation.eligible_factory_production),
      coalesce(sum(allocation.allocated_production), 0)
    into configured_group_count, configured_production, configured_allocation
    from public.get_mud_group_daily_allocation(
      p_factory_id,
      resolved_settlement_start
    ) as allocation;

    if configured_group_count = 0 or configured_allocation <> configured_production then
      return query select
        'BLOCKED'::text,
        'Mud group configuration immediately after cutover does not preserve eligible Production.'::text,
        certification.certification_week,
        resolved_final_week,
        resolved_final_week + 6,
        resolved_cutoff,
        resolved_settlement_start,
        null::uuid, null::text, null::numeric, null::numeric, null::numeric, null::numeric;
      return;
    end if;
  exception
    when sqlstate 'P2701' or sqlstate 'P2702' or sqlstate 'P2703'
      or sqlstate 'P2704' or sqlstate 'P2705' then
      return query select
        'BLOCKED'::text,
        ('Mud configuration is invalid on settlement start: ' || sqlerrm)::text,
        certification.certification_week,
        resolved_final_week,
        resolved_final_week + 6,
        resolved_cutoff,
        resolved_settlement_start,
        null::uuid, null::text, null::numeric, null::numeric, null::numeric, null::numeric;
      return;
  end;

  return query
  select
    'READY_FOR_CUTOVER'::text,
    'Certification, boundary, legacy balances, and next-day Mud configuration are ready.'::text,
    certification.certification_week,
    resolved_final_week,
    resolved_final_week + 6,
    resolved_cutoff,
    resolved_settlement_start,
    groups.id,
    groups.name,
    coalesce(sum(weekly.amount) filter (
      where weekly.week_start + 6 <= resolved_cutoff
    ), 0),
    coalesce((
      select sum(withdrawals.amount)
      from public.withdrawals as withdrawals
      where withdrawals.factory_id = p_factory_id
        and withdrawals.labour_group_id = groups.id
        and withdrawals.labourer_id is null
        and withdrawals.withdrawal_date <= resolved_cutoff
    ), 0),
    coalesce(sum(weekly.amount) filter (
      where weekly.week_start + 6 <= resolved_cutoff
    ), 0),
    coalesce(sum(weekly.amount) filter (
      where weekly.week_start + 6 <= resolved_cutoff
    ), 0) - coalesce((
      select sum(withdrawals.amount)
      from public.withdrawals as withdrawals
      where withdrawals.factory_id = p_factory_id
        and withdrawals.labour_group_id = groups.id
        and withdrawals.labourer_id is null
        and withdrawals.withdrawal_date <= resolved_cutoff
    ), 0)
  from public.labour_groups as groups
  left join public.weekly_earnings as weekly
    on weekly.factory_id = groups.factory_id
    and weekly.labour_group_id = groups.id
    and weekly.labourer_id is null
  where groups.factory_id = p_factory_id
  group by groups.id, groups.name
  order by groups.name, groups.id;
end;
$$;

revoke all on function public.calculate_mud_cutover_readiness(uuid, date)
  from public, anon, authenticated;

create or replace function public.get_mud_cutover_readiness(
  p_factory_id uuid
)
returns table (
  readiness_status text,
  reason text,
  certification_week date,
  final_legacy_week_start date,
  final_legacy_week_end date,
  proposed_legacy_cutoff date,
  settlement_start_date date,
  labour_group_id uuid,
  group_name text,
  legacy_locked_earning_total numeric,
  existing_withdrawals numeric,
  proposed_opening_amount numeric,
  resulting_balance numeric
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
  select * from public.calculate_mud_cutover_readiness(p_factory_id, null);
end;
$$;

revoke all on function public.get_mud_cutover_readiness(uuid)
  from public, anon, authenticated;
grant execute on function public.get_mud_cutover_readiness(uuid)
  to authenticated;

comment on function public.get_mud_cutover_readiness(uuid) is
  'Read-only Mud cutover readiness and per-group Legacy Opening preview. Creates no financial or mode rows.';

commit;
