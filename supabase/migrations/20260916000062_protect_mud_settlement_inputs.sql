begin;

-- Mud Phase 5B2: once a factory is in SETTLEMENT, every input already included
-- in the factory cutoff is immutable. All writers use the same factory lock as
-- create_mud_settlement_withdrawal/create_mud_factory_settlement.

create or replace function public.assert_production_date_is_unsettled(
  p_factory_id uuid,
  p_labourer_id uuid,
  p_production_date date
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  latest_cutoff date;
  mud_mode public.mud_accounting_mode;
begin
  perform pg_advisory_xact_lock(
    hashtext(p_factory_id::text), hashtext('mud_factory_settlement')
  );

  select states.accounting_mode
  into mud_mode
  from public.mud_accounting_states as states
  where states.factory_id = p_factory_id;

  if mud_mode = 'SETTLEMENT' then
    select max(settlements.settled_through)
    into latest_cutoff
    from public.mud_factory_settlements as settlements
    where settlements.factory_id = p_factory_id;

    if latest_cutoff is null then
      raise exception 'Mud SETTLEMENT factory is missing its settlement cutoff.'
        using errcode = 'P3302';
    end if;
    if p_production_date <= latest_cutoff then
      raise exception 'Production through % is settled and cannot be changed.',
        to_char(latest_cutoff, 'FMDD Mon YYYY')
        using errcode = 'P3306';
    end if;
  end if;

  -- Preserve the existing per-labourer Production settlement authority.
  perform pg_advisory_xact_lock(
    hashtext(p_factory_id::text),
    hashtext('production_account:' || p_labourer_id::text)
  );

  select max(settlements.settled_through)
  into latest_cutoff
  from public.production_earning_settlements as settlements
  where settlements.factory_id = p_factory_id
    and settlements.labourer_id = p_labourer_id;

  if latest_cutoff is not null and p_production_date <= latest_cutoff then
    raise exception 'Production through % is settled and cannot be changed.',
      to_char(latest_cutoff, 'FMDD Mon YYYY')
      using errcode = 'P2520';
  end if;
end;
$$;

create or replace function public.protect_mud_group_term_settled_date()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_factory_id uuid := case when tg_op = 'DELETE' then old.factory_id else new.factory_id end;
  latest_cutoff date;
  mud_mode public.mud_accounting_mode;
begin
  perform pg_advisory_xact_lock(
    hashtext(target_factory_id::text), hashtext('mud_factory_settlement')
  );

  select states.accounting_mode
  into mud_mode
  from public.mud_accounting_states as states
  where states.factory_id = target_factory_id;
  if mud_mode is distinct from 'SETTLEMENT' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  select max(settlements.settled_through)
  into latest_cutoff
  from public.mud_factory_settlements as settlements
  where settlements.factory_id = target_factory_id;
  if latest_cutoff is null then
    raise exception 'Mud SETTLEMENT factory is missing its settlement cutoff.'
      using errcode = 'P3302';
  end if;

  if tg_op = 'INSERT' and new.effective_from <= latest_cutoff then
    raise exception 'Mud group configuration through % is settled and cannot be changed.',
      to_char(latest_cutoff, 'FMDD Mon YYYY') using errcode = 'P3310';
  elsif tg_op = 'DELETE' and old.effective_from <= latest_cutoff then
    raise exception 'Mud group configuration through % is settled and cannot be changed.',
      to_char(latest_cutoff, 'FMDD Mon YYYY') using errcode = 'P3310';
  elsif tg_op = 'UPDATE' then
    if new.factory_id <> old.factory_id
      or new.labour_group_id <> old.labour_group_id
      or (old.effective_from <= latest_cutoff and (
        new.effective_from <> old.effective_from
        or new.member_count <> old.member_count
        or least(coalesce(new.effective_to, 'infinity'::date), latest_cutoff)
          is distinct from least(coalesce(old.effective_to, 'infinity'::date), latest_cutoff)
      ))
      or (old.effective_from > latest_cutoff and new.effective_from <= latest_cutoff) then
      raise exception 'Mud group configuration through % is settled and cannot be changed.',
        to_char(latest_cutoff, 'FMDD Mon YYYY') using errcode = 'P3310';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.protect_mud_group_rate_settled_date()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_factory_id uuid := case when tg_op = 'DELETE' then old.factory_id else new.factory_id end;
  latest_cutoff date;
  mud_mode public.mud_accounting_mode;
begin
  perform pg_advisory_xact_lock(
    hashtext(target_factory_id::text), hashtext('mud_factory_settlement')
  );

  select states.accounting_mode
  into mud_mode
  from public.mud_accounting_states as states
  where states.factory_id = target_factory_id;
  if mud_mode is distinct from 'SETTLEMENT' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  select max(settlements.settled_through)
  into latest_cutoff
  from public.mud_factory_settlements as settlements
  where settlements.factory_id = target_factory_id;
  if latest_cutoff is null then
    raise exception 'Mud SETTLEMENT factory is missing its settlement cutoff.'
      using errcode = 'P3302';
  end if;

  if tg_op = 'INSERT' and new.effective_from <= latest_cutoff then
    raise exception 'Mud rate through % is settled and cannot be changed.',
      to_char(latest_cutoff, 'FMDD Mon YYYY') using errcode = 'P3311';
  elsif tg_op = 'DELETE' and old.effective_from <= latest_cutoff then
    raise exception 'Mud rate through % is settled and cannot be changed.',
      to_char(latest_cutoff, 'FMDD Mon YYYY') using errcode = 'P3311';
  elsif tg_op = 'UPDATE' then
    if new.factory_id <> old.factory_id
      or new.labour_group_id <> old.labour_group_id
      or (old.effective_from <= latest_cutoff and (
        new.effective_from <> old.effective_from
        or new.rate_per_1000_bricks <> old.rate_per_1000_bricks
        or least(coalesce(new.effective_to, 'infinity'::date), latest_cutoff)
          is distinct from least(coalesce(old.effective_to, 'infinity'::date), latest_cutoff)
      ))
      or (old.effective_from > latest_cutoff and new.effective_from <= latest_cutoff) then
      raise exception 'Mud rate through % is settled and cannot be changed.',
        to_char(latest_cutoff, 'FMDD Mon YYYY') using errcode = 'P3311';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger mud_group_terms_protect_settled_date
before insert or update or delete on public.mud_group_terms
for each row execute function public.protect_mud_group_term_settled_date();

create trigger mud_group_rates_protect_settled_date
before insert or update or delete on public.mud_group_rates
for each row execute function public.protect_mud_group_rate_settled_date();

revoke all on function public.protect_mud_group_term_settled_date()
  from public, anon, authenticated;
revoke all on function public.protect_mud_group_rate_settled_date()
  from public, anon, authenticated;

comment on function public.assert_production_date_is_unsettled(uuid, uuid, date) is
  'Serializes on the Mud factory lock, protects the Mud settlement cutoff, then preserves the per-labourer Production settlement cutoff.';
comment on function public.protect_mud_group_term_settled_date() is
  'Rejects Mud group participation/member changes that alter any date at or before the SETTLEMENT factory cutoff.';
comment on function public.protect_mud_group_rate_settled_date() is
  'Rejects Mud group rate changes that alter any date at or before the SETTLEMENT factory cutoff.';

commit;
