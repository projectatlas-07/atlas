begin;

-- Mud Phase 4B: a completed, locked legacy week must prove exact SHADOW parity
-- before SETTLEMENT can be selected. This remains a derived read model: the
-- locked weekly earning and existing SHADOW comparison are the authority.

create or replace function public.get_mud_shadow_certification_status(
  p_factory_id uuid
)
returns table (
  certification_status text,
  certification_week date,
  legacy_earning numeric,
  new_engine_earning numeric,
  difference numeric,
  parity_status text,
  reason text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  business_today date := (now() at time zone 'Asia/Kolkata')::date;
  current_mode public.mud_accounting_mode;
  candidate_week date;
  comparison_count integer;
  comparison record;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;

  select states.accounting_mode into current_mode
  from public.mud_accounting_states as states
  where states.factory_id = p_factory_id;
  if not found then
    raise exception 'Mud accounting state is missing for this factory.' using errcode = 'P2803';
  end if;

  if current_mode <> 'SHADOW' then
    return query select
      'WAITING_FOR_COMPLETED_WEEK'::text,
      null::date,
      null::numeric,
      null::numeric,
      null::numeric,
      null::text,
      'Factory must be in SHADOW mode before it can be certified.'::text;
    return;
  end if;

  select max(earnings.week_start) into candidate_week
  from public.weekly_earnings as earnings
  where earnings.factory_id = p_factory_id
    and earnings.labour_group_id is not null
    and earnings.labourer_id is null
    and earnings.week_start + 6 < business_today;

  if candidate_week is null then
    return query select
      'WAITING_FOR_COMPLETED_WEEK'::text,
      null::date,
      null::numeric,
      null::numeric,
      null::numeric,
      null::text,
      'Waiting for a completed Monday-Sunday week to be locked by Calculate Mud Wage.'::text;
    return;
  end if;

  select count(*) into comparison_count
  from public.get_mud_shadow_weekly_comparisons(
    p_factory_id,
    candidate_week,
    candidate_week
  );

  if comparison_count <> 1 then
    return query select
      'CONFIGURATION_ERROR'::text,
      candidate_week,
      null::numeric,
      null::numeric,
      null::numeric,
      'CONFIGURATION_ERROR'::text,
      'Certification requires exactly one locked Mud group earning for the completed week.'::text;
    return;
  end if;

  select * into comparison
  from public.get_mud_shadow_weekly_comparisons(
    p_factory_id,
    candidate_week,
    candidate_week
  );

  if comparison.status = 'PARITY_OK' then
    return query select
      'READY'::text,
      comparison.week_start,
      comparison.legacy_earning,
      comparison.new_engine_earning,
      comparison.difference,
      comparison.status,
      'Latest completed locked Mud week has exact constant-rate single-group parity.'::text;
  elsif comparison.status = 'CONFIGURATION_ERROR' then
    return query select
      'CONFIGURATION_ERROR'::text,
      comparison.week_start,
      comparison.legacy_earning,
      comparison.new_engine_earning,
      comparison.difference,
      comparison.status,
      comparison.detail;
  elsif comparison.status = 'UNEXPECTED_MISMATCH' then
    return query select
      'UNEXPECTED_MISMATCH'::text,
      comparison.week_start,
      comparison.legacy_earning,
      comparison.new_engine_earning,
      comparison.difference,
      comparison.status,
      comparison.detail;
  else
    return query select
      'WAITING_FOR_COMPLETED_WEEK'::text,
      comparison.week_start,
      comparison.legacy_earning,
      comparison.new_engine_earning,
      comparison.difference,
      comparison.status,
      'A mid-week Mud rate change can validate daily-rate behavior, but cannot certify settlement cutover.'::text;
  end if;
end;
$$;

revoke all on function public.get_mud_shadow_certification_status(uuid)
  from public, anon, authenticated;
grant execute on function public.get_mud_shadow_certification_status(uuid)
  to authenticated;

comment on function public.get_mud_shadow_certification_status(uuid) is
  'Returns certification from the latest completed locked real Mud week; only exact constant-rate single-group SHADOW parity is READY.';

create or replace function public.protect_mud_accounting_state_transition()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  certification record;
begin
  if new.factory_id <> old.factory_id then
    raise exception 'Mud accounting state cannot move between factories.' using errcode = 'P2800';
  end if;
  if new.accounting_mode = old.accounting_mode then
    raise exception 'Mud accounting mode is already %.', old.accounting_mode using errcode = 'P2801';
  end if;
  if not (
    (old.accounting_mode = 'LEGACY_WEEKLY' and new.accounting_mode = 'SHADOW')
    or (old.accounting_mode = 'SHADOW' and new.accounting_mode = 'SETTLEMENT')
  ) then
    raise exception 'Mud accounting mode cannot transition from % to %.', old.accounting_mode, new.accounting_mode
      using errcode = 'P2802';
  end if;
  if auth.uid() is null then
    raise exception 'Mud accounting transitions require an authenticated actor.' using errcode = '42501';
  end if;
  if old.accounting_mode = 'SHADOW' and new.accounting_mode = 'SETTLEMENT' then
    select * into certification
    from public.get_mud_shadow_certification_status(old.factory_id);
    if certification.certification_status <> 'READY' then
      raise exception 'Mud settlement cutover requires a completed SHADOW week with PARITY_OK.'
        using errcode = 'P3100', detail = certification.reason;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.transition_mud_accounting_mode(
  p_factory_id uuid,
  p_new_mode public.mud_accounting_mode
)
returns setof public.mud_accounting_states
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_mode public.mud_accounting_mode;
  certification record;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;

  select states.accounting_mode into current_mode
  from public.mud_accounting_states as states
  where states.factory_id = p_factory_id
  for update;
  if not found then
    raise exception 'Mud accounting state is missing for this factory.' using errcode = 'P2803';
  end if;
  if not (
    (current_mode = 'LEGACY_WEEKLY' and p_new_mode = 'SHADOW')
    or (current_mode = 'SHADOW' and p_new_mode = 'SETTLEMENT')
  ) then
    raise exception 'Mud accounting mode cannot transition from % to %.', current_mode, p_new_mode
      using errcode = 'P2802';
  end if;

  if current_mode = 'SHADOW' and p_new_mode = 'SETTLEMENT' then
    select * into certification
    from public.get_mud_shadow_certification_status(p_factory_id);
    if certification.certification_status <> 'READY' then
      raise exception 'Mud settlement cutover requires a completed SHADOW week with PARITY_OK.'
        using errcode = 'P3100', detail = certification.reason;
    end if;
  end if;

  return query
  update public.mud_accounting_states
  set accounting_mode = p_new_mode
  where factory_id = p_factory_id
  returning *;
end;
$$;

comment on function public.transition_mud_accounting_mode(uuid, public.mud_accounting_mode) is
  'Allows LEGACY_WEEKLY to SHADOW unchanged; SHADOW to SETTLEMENT additionally requires READY certification.';

commit;
