-- Production records raw, ungraded brick quantities. Finished Brick Types
-- remain owned by Challans/Sales and are no longer part of Production.

begin;

create temporary table production_brick_type_cutover_guard
on commit drop
as
select jsonb_build_object(
  'labourer_count', (select count(*) from public.labourers),
  'production_count', (select count(*) from public.production_entries),
  'production_quantity', (select coalesce(sum(quantity), 0) from public.production_entries),
  'production_first_date', (select min(production_date) from public.production_entries),
  'production_last_date', (select max(production_date) from public.production_entries),
  'production_rate_count', (select count(*) from public.production_wage_rates),
  'crew_assignment_count', (select count(*) from public.production_crew_assignments),
  'weekly_earning_count', (select count(*) from public.weekly_earnings),
  'weekly_earning_amount', (select coalesce(sum(amount), 0) from public.weekly_earnings),
  'settlement_count', (select count(*) from public.production_earning_settlements),
  'settlement_earned', (select coalesce(sum(total_earned), 0) from public.production_earning_settlements),
  'settlement_detail_count', (select count(*) from public.production_earning_settlement_details),
  'settlement_detail_earned', (select coalesce(sum(earned_amount), 0) from public.production_earning_settlement_details),
  'withdrawal_count', (select count(*) from public.withdrawals),
  'withdrawal_amount', (select coalesce(sum(amount), 0) from public.withdrawals),
  'brick_type_count', (select count(*) from public.brick_types),
  'challan_count', (select count(*) from public.challans),
  'challan_total', (select coalesce(sum(challan_total), 0) from public.challans),
  'challan_item_count', (select count(*) from public.challan_items),
  'challan_item_amount', (select coalesce(sum(line_amount), 0) from public.challan_items)
) as snapshot;

drop function if exists public.save_production_entry(uuid, uuid, uuid, uuid, date, integer);

drop trigger if exists production_entries_protect_settled_date
  on public.production_entries;

drop policy if exists "Authenticated users can insert their factory labourers"
  on public.labourers;
drop policy if exists "Authenticated users can update their factory labourers"
  on public.labourers;

alter table public.labourers
  drop constraint if exists labourers_assigned_brick_type_factory_fkey,
  drop column assigned_brick_type_id;

drop index if exists public.production_entries_brick_type_date_idx;

alter table public.production_entries
  drop constraint if exists production_entries_brick_type_factory_fkey,
  drop column brick_type_id;

create policy "Authenticated users can insert their factory labourers"
  on public.labourers
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = labourers.factory_id
        and factory_users.is_active = true
    )
  );

create policy "Authenticated users can update their factory labourers"
  on public.labourers
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = labourers.factory_id
        and factory_users.is_active = true
    )
  )
  with check (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = labourers.factory_id
        and factory_users.is_active = true
    )
  );

create or replace function public.protect_settled_production_entry()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' and (
    new.factory_id <> old.factory_id
    or new.labourer_id <> old.labourer_id
    or new.production_date <> old.production_date
  ) then
    raise exception 'Production record identity cannot be changed.'
      using errcode = 'P2523';
  end if;

  if tg_op = 'INSERT' then
    perform public.assert_production_date_is_unsettled(
      new.factory_id, new.labourer_id, new.production_date
    );
    return new;
  end if;

  perform public.assert_production_date_is_unsettled(
    old.factory_id, old.labourer_id, old.production_date
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger production_entries_protect_settled_date
before insert or update or delete on public.production_entries
for each row execute function public.protect_settled_production_entry();

create or replace function public.save_production_entry(
  p_factory_id uuid,
  p_entry_id uuid,
  p_labourer_id uuid,
  p_production_date date,
  p_quantity integer
)
returns setof public.production_entries
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  saved_entry public.production_entries%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;
  if p_entry_id is null or p_labourer_id is null
    or p_production_date is null or not isfinite(p_production_date) then
    raise exception 'Entry, labourer, and finite Production date are required.'
      using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Production quantity must be greater than zero.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.labourers
    where labourers.id = p_labourer_id and labourers.factory_id = p_factory_id
  ) then
    raise exception 'Labourer does not belong to this factory.' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.production_entries
    where production_entries.id = p_entry_id
      and (
        production_entries.factory_id <> p_factory_id
        or production_entries.labourer_id <> p_labourer_id
        or production_entries.production_date <> p_production_date
      )
  ) then
    raise exception 'Production entry does not belong to this labourer and date.' using errcode = '42501';
  end if;

  perform public.assert_production_date_is_unsettled(
    p_factory_id, p_labourer_id, p_production_date
  );

  insert into public.production_entries (
    id, factory_id, labourer_id, production_date, quantity
  ) values (
    p_entry_id, p_factory_id, p_labourer_id, p_production_date, p_quantity
  )
  on conflict (factory_id, labourer_id, production_date)
  do update set quantity = excluded.quantity
  returning * into saved_entry;

  return next saved_entry;
end;
$$;

revoke insert, update, delete on public.production_entries from authenticated;
revoke all on function public.save_production_entry(uuid, uuid, uuid, date, integer)
  from public, anon, authenticated;
grant execute on function public.save_production_entry(uuid, uuid, uuid, date, integer)
  to authenticated;

comment on column public.production_entries.quantity is
  'Raw, ungraded brick quantity produced by one labourer on one business date.';
comment on function public.save_production_entry(uuid, uuid, uuid, date, integer) is
  'Saves one raw Production quantity per labourer and business date while preserving settlement locks.';

do $$
declare
  before_snapshot jsonb;
  after_snapshot jsonb;
begin
  select snapshot into before_snapshot
  from production_brick_type_cutover_guard;

  select jsonb_build_object(
    'labourer_count', (select count(*) from public.labourers),
    'production_count', (select count(*) from public.production_entries),
    'production_quantity', (select coalesce(sum(quantity), 0) from public.production_entries),
    'production_first_date', (select min(production_date) from public.production_entries),
    'production_last_date', (select max(production_date) from public.production_entries),
    'production_rate_count', (select count(*) from public.production_wage_rates),
    'crew_assignment_count', (select count(*) from public.production_crew_assignments),
    'weekly_earning_count', (select count(*) from public.weekly_earnings),
    'weekly_earning_amount', (select coalesce(sum(amount), 0) from public.weekly_earnings),
    'settlement_count', (select count(*) from public.production_earning_settlements),
    'settlement_earned', (select coalesce(sum(total_earned), 0) from public.production_earning_settlements),
    'settlement_detail_count', (select count(*) from public.production_earning_settlement_details),
    'settlement_detail_earned', (select coalesce(sum(earned_amount), 0) from public.production_earning_settlement_details),
    'withdrawal_count', (select count(*) from public.withdrawals),
    'withdrawal_amount', (select coalesce(sum(amount), 0) from public.withdrawals),
    'brick_type_count', (select count(*) from public.brick_types),
    'challan_count', (select count(*) from public.challans),
    'challan_total', (select coalesce(sum(challan_total), 0) from public.challans),
    'challan_item_count', (select count(*) from public.challan_items),
    'challan_item_amount', (select coalesce(sum(line_amount), 0) from public.challan_items)
  ) into after_snapshot;

  if after_snapshot is distinct from before_snapshot then
    raise exception 'Production Brick-Type cutover changed authoritative Production, accounting, or Sales data.'
      using errcode = 'P0001';
  end if;
end;
$$;

commit;
