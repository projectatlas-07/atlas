-- Atlas Soil Supply T8 hardening: serialize trolley-derived earnings with
-- payments/adjustments and reject corrections that would overdraw the worker.

create or replace function public.guard_soil_daily_financial_balance()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  current_summary record;
  projected_available_balance numeric;
begin
  -- This is the same per-worker lock used by T5 payments and adjustments.
  -- The save RPC already holds rate and daily-entry locks. This guard then
  -- takes financial before T7's lifecycle trigger, keeping one stable order.
  perform pg_advisory_xact_lock(
    hashtext(new.factory_id::text),
    hashtext('soil_financial:' || new.soil_worker_id::text)
  );

  if tg_op = 'UPDATE'
    and new.base_amount_snapshot < old.base_amount_snapshot then
    select *
    into current_summary
    from public.get_soil_financial_summary(
      new.factory_id,
      new.soil_worker_id
    );

    projected_available_balance := current_summary.available_balance
      + new.base_amount_snapshot
      - old.base_amount_snapshot;

    if projected_available_balance < 0 then
      raise exception 'This trolley correction would reduce the Soil worker available balance below zero. Resolve the financial balance first.'
        using errcode = 'P2A05';
    end if;
  end if;

  return new;
end;
$$;

-- PostgreSQL runs same-event triggers in name order. "financial_lock" runs
-- before T7's "require_active_worker", preserving financial -> lifecycle order.
create trigger soil_daily_trolley_entries_financial_lock
before insert or update on public.soil_daily_trolley_entries
for each row execute function public.guard_soil_daily_financial_balance();

revoke all on function public.guard_soil_daily_financial_balance()
  from public, anon, authenticated;

comment on function public.guard_soil_daily_financial_balance() is
  'Serializes T2/T3 writes with the authoritative Soil financial lock and prevents a downward earning correction from making available balance negative.';
