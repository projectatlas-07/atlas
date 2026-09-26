-- Run only against confirmed Test Atlas Clean after migration 20260924000065.
-- All fixture writes are rolled back.

begin;

do $$
begin
  if not exists (
    select 1
    from public.factory_users
    where is_active = true
  ) then
    raise exception 'FAIL: Test Atlas Clean has no active factory user for RLS verification.';
  end if;
end;
$$;

select set_config(
  'request.jwt.claim.sub',
  (select user_id::text from public.factory_users where is_active = true order by created_at limit 1),
  true
);
select set_config('atlas.production_worker_id', gen_random_uuid()::text, true);
select set_config('atlas.production_entry_id', gen_random_uuid()::text, true);

set local role authenticated;

insert into public.labourers(id, factory_id, name, is_active)
select
  current_setting('atlas.production_worker_id')::uuid,
  factory_id,
  'Brick-type-free verifier worker',
  true
from public.factory_users
where user_id = auth.uid()
  and is_active = true
order by created_at
limit 1;

select *
from public.save_production_entry(
  (select factory_id from public.factory_users where user_id = auth.uid() and is_active = true order by created_at limit 1),
  current_setting('atlas.production_entry_id')::uuid,
  current_setting('atlas.production_worker_id')::uuid,
  date '2099-01-01',
  1000
);

select *
from public.save_production_entry(
  (select factory_id from public.factory_users where user_id = auth.uid() and is_active = true order by created_at limit 1),
  current_setting('atlas.production_entry_id')::uuid,
  current_setting('atlas.production_worker_id')::uuid,
  date '2099-01-01',
  1200
);

do $$
begin
  if (
    select count(*) <> 1 or max(quantity) <> 1200
    from public.production_entries
    where labourer_id = current_setting('atlas.production_worker_id')::uuid
      and production_date = date '2099-01-01'
  ) then
    raise exception 'FAIL: Production save did not preserve one worker/day row with editable quantity.';
  end if;
end;
$$;

reset role;

do $$
declare
  labourer_policy text;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'labourers'
      and column_name = 'assigned_brick_type_id'
  ) then
    raise exception 'FAIL: labourers.assigned_brick_type_id still exists.';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'production_entries'
      and column_name = 'brick_type_id'
  ) then
    raise exception 'FAIL: production_entries.brick_type_id still exists.';
  end if;

  select coalesce(string_agg(coalesce(with_check, ''), ' '), '')
  into labourer_policy
  from pg_policies
  where schemaname = 'public'
    and tablename = 'labourers'
    and cmd in ('INSERT', 'UPDATE');

  if labourer_policy ilike '%brick_type%' then
    raise exception 'FAIL: labourer write RLS still depends on Brick Type.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'challan_items'
      and column_name = 'brick_type_id'
      and is_nullable = 'NO'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'challan_items'
      and column_name = 'brick_particulars_snapshot'
      and is_nullable = 'NO'
  ) then
    raise exception 'FAIL: canonical Challan Brick Type contracts changed.';
  end if;
end;
$$;

rollback;
