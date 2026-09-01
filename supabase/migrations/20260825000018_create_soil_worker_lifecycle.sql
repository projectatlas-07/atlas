-- Atlas Soil Supply T7: safe worker archive, restore, and unused-worker deletion.

comment on column public.soil_workers.is_active is
  'Soil worker lifecycle state. Active workers are eligible for new trolley recording; archived workers retain all historical operational and financial records.';

create or replace function public.enforce_active_soil_worker_for_daily_write()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  worker_is_active boolean;
begin
  -- Serialize the final eligibility check with archive, restore, and delete.
  perform pg_advisory_xact_lock(
    hashtext(new.factory_id::text),
    hashtext('soil_lifecycle:' || new.soil_worker_id::text)
  );

  select soil_workers.is_active
  into worker_is_active
  from public.soil_workers
  where soil_workers.id = new.soil_worker_id
    and soil_workers.factory_id = new.factory_id;

  if not found then
    raise exception 'Soil worker does not belong to this factory.'
      using errcode = 'P2602';
  end if;

  if not worker_is_active then
    raise exception 'Archived Soil workers cannot receive trolley entries. Restore the worker first.'
      using errcode = 'P2A03';
  end if;

  return new;
end;
$$;

create trigger soil_daily_trolley_entries_require_active_worker
before insert or update on public.soil_daily_trolley_entries
for each row execute function public.enforce_active_soil_worker_for_daily_write();

create or replace function public.archive_soil_worker(
  p_factory_id uuid,
  p_soil_worker_id uuid
)
returns public.soil_workers
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  worker_row public.soil_workers%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.'
      using errcode = '42501';
  end if;

  -- Match T1/T3 rate locking before taking the lifecycle lock.
  perform pg_advisory_xact_lock(
    hashtext('soil_worker_trolley_rate'),
    hashtext(p_soil_worker_id::text)
  );
  perform pg_advisory_xact_lock(
    hashtext(p_factory_id::text),
    hashtext('soil_lifecycle:' || p_soil_worker_id::text)
  );

  select *
  into worker_row
  from public.soil_workers
  where soil_workers.id = p_soil_worker_id
    and soil_workers.factory_id = p_factory_id
  for update;

  if not found then
    raise exception 'Soil worker does not belong to this factory.'
      using errcode = 'P2602';
  end if;
  if not worker_row.is_active then
    raise exception 'This Soil worker is already archived.'
      using errcode = 'P2A01';
  end if;

  update public.soil_workers
  set is_active = false
  where id = p_soil_worker_id
    and factory_id = p_factory_id
  returning * into worker_row;

  return worker_row;
end;
$$;

create or replace function public.restore_soil_worker(
  p_factory_id uuid,
  p_soil_worker_id uuid
)
returns public.soil_workers
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  worker_row public.soil_workers%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtext('soil_worker_trolley_rate'),
    hashtext(p_soil_worker_id::text)
  );
  perform pg_advisory_xact_lock(
    hashtext(p_factory_id::text),
    hashtext('soil_lifecycle:' || p_soil_worker_id::text)
  );

  select *
  into worker_row
  from public.soil_workers
  where soil_workers.id = p_soil_worker_id
    and soil_workers.factory_id = p_factory_id
  for update;

  if not found then
    raise exception 'Soil worker does not belong to this factory.'
      using errcode = 'P2602';
  end if;
  if worker_row.is_active then
    raise exception 'This Soil worker is already active.'
      using errcode = 'P2A02';
  end if;

  update public.soil_workers
  set is_active = true
  where id = p_soil_worker_id
    and factory_id = p_factory_id
  returning * into worker_row;

  return worker_row;
end;
$$;

create or replace function public.delete_unused_soil_worker(
  p_factory_id uuid,
  p_soil_worker_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  worker_row public.soil_workers%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.'
      using errcode = '42501';
  end if;

  -- Use the same order as rate, finance, and lifecycle writers so a concurrent
  -- first record either commits before this guard or fails after deletion.
  perform pg_advisory_xact_lock(
    hashtext('soil_worker_trolley_rate'),
    hashtext(p_soil_worker_id::text)
  );
  perform pg_advisory_xact_lock(
    hashtext(p_factory_id::text),
    hashtext('soil_financial:' || p_soil_worker_id::text)
  );
  perform pg_advisory_xact_lock(
    hashtext(p_factory_id::text),
    hashtext('soil_lifecycle:' || p_soil_worker_id::text)
  );

  select *
  into worker_row
  from public.soil_workers
  where soil_workers.id = p_soil_worker_id
    and soil_workers.factory_id = p_factory_id
  for update;

  if not found then
    raise exception 'Soil worker does not belong to this factory.'
      using errcode = 'P2602';
  end if;

  if exists (
    select 1
    from public.soil_daily_trolley_entries
    where soil_daily_trolley_entries.factory_id = p_factory_id
      and soil_daily_trolley_entries.soil_worker_id = p_soil_worker_id
  ) or exists (
    select 1
    from public.soil_earnings
    where soil_earnings.factory_id = p_factory_id
      and soil_earnings.soil_worker_id = p_soil_worker_id
  ) or exists (
    select 1
    from public.soil_payments
    where soil_payments.factory_id = p_factory_id
      and soil_payments.soil_worker_id = p_soil_worker_id
  ) or exists (
    select 1
    from public.soil_financial_adjustments
    where soil_financial_adjustments.factory_id = p_factory_id
      and soil_financial_adjustments.soil_worker_id = p_soil_worker_id
  ) then
    raise exception 'This Soil worker has historical records and cannot be deleted. Archive the worker instead.'
      using errcode = 'P2A04';
  end if;

  -- T1 creates at least one setup rate. Rates are not meaningful work or
  -- financial history and are removed transactionally with an unused worker.
  delete from public.soil_worker_trolley_rates
  where factory_id = p_factory_id
    and soil_worker_id = p_soil_worker_id;

  delete from public.soil_workers
  where id = p_soil_worker_id
    and factory_id = p_factory_id;

  return worker_row.id;
end;
$$;

revoke all on function public.enforce_active_soil_worker_for_daily_write()
  from public, anon, authenticated;

revoke all on function public.archive_soil_worker(uuid, uuid)
  from public, anon;
grant execute on function public.archive_soil_worker(uuid, uuid)
  to authenticated;

revoke all on function public.restore_soil_worker(uuid, uuid)
  from public, anon;
grant execute on function public.restore_soil_worker(uuid, uuid)
  to authenticated;

revoke all on function public.delete_unused_soil_worker(uuid, uuid)
  from public, anon;
grant execute on function public.delete_unused_soil_worker(uuid, uuid)
  to authenticated;

comment on function public.delete_unused_soil_worker(uuid, uuid) is
  'Permanently deletes a Soil worker only when no daily, earning, payment, or adjustment history exists; setup-only trolley rates are removed in the same transaction.';
