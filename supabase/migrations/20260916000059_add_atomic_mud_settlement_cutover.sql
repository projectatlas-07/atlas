begin;

-- Mud Phase 5A: the only authenticated SHADOW -> SETTLEMENT authority.
-- Runtime withdrawal routing and settled-date protections remain dormant.

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
    if not exists (
      select 1
      from public.mud_factory_settlements as settlements
      where settlements.factory_id = old.factory_id
        and settlements.settlement_type = 'legacy_opening'
    ) then
      raise exception 'Mud SETTLEMENT mode must be entered through the atomic cutover authority.'
        using errcode = 'P3201';
    end if;

    select * into certification
    from public.get_mud_shadow_certification_status(old.factory_id);
    if certification.certification_status <> 'READY'
      or certification.parity_status <> 'PARITY_OK' then
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

  -- Use the same factory lock as opening/checkpoint creation. Reacquiring this
  -- transaction-scoped lock from execute_mud_settlement_cutover is safe.
  if p_new_mode = 'SETTLEMENT' then
    perform pg_advisory_xact_lock(
      hashtext(p_factory_id::text), hashtext('mud_factory_settlement')
    );
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
    if not exists (
      select 1
      from public.mud_factory_settlements as settlements
      where settlements.factory_id = p_factory_id
        and settlements.settlement_type = 'legacy_opening'
    ) then
      raise exception 'Mud SETTLEMENT mode must be entered through the atomic cutover authority.'
        using errcode = 'P3201';
    end if;

    select * into certification
    from public.get_mud_shadow_certification_status(p_factory_id);
    if certification.certification_status <> 'READY'
      or certification.parity_status <> 'PARITY_OK' then
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

create or replace function public.execute_mud_settlement_cutover(
  p_factory_id uuid,
  p_proposed_legacy_cutoff date
)
returns table (
  legacy_opening_settlement_id uuid,
  final_legacy_week_start date,
  legacy_cutoff date,
  settlement_start_date date,
  group_openings integer,
  transition_audit_id uuid,
  actor uuid,
  cutover_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  readiness record;
  certification record;
  opening_result record;
  transition_result record;
  audit_result record;
begin
  if p_factory_id is null
    or p_proposed_legacy_cutoff is null
    or not isfinite(p_proposed_legacy_cutoff) then
    raise exception 'Factory and finite proposed Legacy Opening cutoff are required.'
      using errcode = '22023';
  end if;
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_factory_id::text), hashtext('mud_factory_settlement')
  );

  -- Freeze every input used by readiness and the opening until this function
  -- either commits completely or rolls back completely.
  perform 1
  from public.mud_accounting_states as states
  where states.factory_id = p_factory_id
    and states.accounting_mode = 'SHADOW'
  for update;
  if not found then
    raise exception 'Mud cutover requires current SHADOW accounting mode.' using errcode = 'P3200';
  end if;

  lock table public.weekly_earnings, public.withdrawals,
    public.mud_group_terms, public.mud_group_rates,
    public.production_entries, public.labour_groups in share mode;

  select * into certification
  from public.get_mud_shadow_certification_status(p_factory_id);
  if certification.certification_status <> 'READY'
    or certification.parity_status <> 'PARITY_OK' then
    raise exception 'Mud cutover certification is not READY with PARITY_OK.'
      using errcode = 'P3200', detail = certification.reason;
  end if;

  select * into readiness
  from public.calculate_mud_cutover_readiness(
    p_factory_id, p_proposed_legacy_cutoff
  )
  limit 1;
  if readiness.readiness_status is distinct from 'READY_FOR_CUTOVER' then
    raise exception 'Mud cutover readiness is BLOCKED.'
      using errcode = 'P3200', detail = coalesce(readiness.reason, 'No readiness result was returned.');
  end if;
  if readiness.certification_week <> readiness.final_legacy_week_start
    or readiness.final_legacy_week_end <> p_proposed_legacy_cutoff
    or readiness.proposed_legacy_cutoff <> p_proposed_legacy_cutoff
    or readiness.settlement_start_date <> p_proposed_legacy_cutoff + 1
    or extract(isodow from readiness.final_legacy_week_start) <> 1
    or extract(isodow from p_proposed_legacy_cutoff) <> 7
    or extract(isodow from readiness.settlement_start_date) <> 1 then
    raise exception 'Mud cutover requires the certified completed Monday-Sunday week and following Monday start.'
      using errcode = 'P3200';
  end if;

  select * into opening_result
  from public.create_mud_legacy_opening(
    p_factory_id, p_proposed_legacy_cutoff
  );

  -- Readiness intentionally becomes BLOCKED once the opening exists, so prove
  -- the immutable rows directly against the same locked inputs.
  if opening_result.group_openings <> (
      select count(*) from public.labour_groups where factory_id = p_factory_id
    ) or exists (
      select 1
      from public.mud_group_legacy_openings as openings
      join public.labour_groups as groups
        on groups.id = openings.labour_group_id
        and groups.factory_id = openings.factory_id
      where openings.factory_id = p_factory_id
        and openings.settlement_id = opening_result.settlement_id
        and openings.locked_weekly_earned is distinct from coalesce((
          select sum(weekly.amount)
          from public.weekly_earnings as weekly
          where weekly.factory_id = p_factory_id
            and weekly.labour_group_id = groups.id
            and weekly.labourer_id is null
            and weekly.week_start + 6 <= p_proposed_legacy_cutoff
        ), 0)
    ) then
    raise exception 'Created Mud Legacy Openings do not match locked legacy earnings.'
      using errcode = 'P3202';
  end if;

  select * into transition_result
  from public.transition_mud_accounting_mode(p_factory_id, 'SETTLEMENT');
  if transition_result.accounting_mode <> 'SETTLEMENT' then
    raise exception 'Mud accounting state did not enter SETTLEMENT.' using errcode = 'P3202';
  end if;

  select transitions.id, transitions.actor, transitions.changed_at
  into audit_result
  from public.mud_accounting_mode_transitions as transitions
  where transitions.factory_id = p_factory_id
    and transitions.old_mode = 'SHADOW'
    and transitions.new_mode = 'SETTLEMENT'
  order by transitions.changed_at desc, transitions.id desc
  limit 1;
  if audit_result.id is null or audit_result.actor <> auth.uid() then
    raise exception 'Mud cutover transition audit was not recorded for the actor.'
      using errcode = 'P3202';
  end if;

  legacy_opening_settlement_id := opening_result.settlement_id;
  final_legacy_week_start := readiness.final_legacy_week_start;
  legacy_cutoff := p_proposed_legacy_cutoff;
  settlement_start_date := readiness.settlement_start_date;
  group_openings := opening_result.group_openings;
  transition_audit_id := audit_result.id;
  actor := audit_result.actor;
  cutover_at := audit_result.changed_at;
  return next;
end;
$$;

-- The helper is now internal to the atomic authority. Checkpoint creation stays
-- service-only and shares the same factory lock for future runtime work.
revoke all on function public.create_mud_legacy_opening(uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function public.execute_mud_settlement_cutover(uuid, date)
  from public, anon, authenticated;
grant execute on function public.execute_mud_settlement_cutover(uuid, date)
  to authenticated;

comment on function public.transition_mud_accounting_mode(uuid, public.mud_accounting_mode) is
  'Allows LEGACY_WEEKLY to SHADOW; SHADOW to SETTLEMENT requires the atomic cutover authority to have created its Legacy Opening in the same transaction.';
comment on function public.create_mud_legacy_opening(uuid, date) is
  'Private atomic-cutover helper that snapshots gross locked legacy Mud earnings per group; withdrawals remain separate.';
comment on function public.execute_mud_settlement_cutover(uuid, date) is
  'Atomic authenticated SHADOW to SETTLEMENT cutover: validates certification/readiness, creates immutable Legacy Openings, transitions mode, and returns auditable boundary metadata.';

commit;
