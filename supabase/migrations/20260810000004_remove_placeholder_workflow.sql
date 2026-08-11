begin;

lock table public.labourers in share row exclusive mode;
lock table public.production_entries in share row exclusive mode;
lock table public.weekly_earnings in share row exclusive mode;
lock table public.withdrawals in share row exclusive mode;

do $$
declare
  unexpected_references text;
begin
  if exists (
    select 1
    from public.weekly_earnings
    join public.labourers
      on labourers.id = weekly_earnings.labourer_id
      and labourers.factory_id = weekly_earnings.factory_id
    where labourers.is_placeholder
  ) then
    raise exception 'Placeholder cleanup aborted: a placeholder labourer is referenced by weekly_earnings.'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.withdrawals
    join public.labourers
      on labourers.id = withdrawals.labourer_id
      and labourers.factory_id = withdrawals.factory_id
    where labourers.is_placeholder
  ) then
    raise exception 'Placeholder cleanup aborted: a placeholder labourer is referenced by withdrawals.'
      using errcode = 'P0001';
  end if;

  select string_agg(
    format('%I.%I via %I', referenced_namespace.nspname, referenced_table.relname, pg_constraint.conname),
    ', '
    order by referenced_namespace.nspname, referenced_table.relname, pg_constraint.conname
  )
    into unexpected_references
    from pg_catalog.pg_constraint
    join pg_catalog.pg_class as referenced_table
      on referenced_table.oid = pg_constraint.conrelid
    join pg_catalog.pg_namespace as referenced_namespace
      on referenced_namespace.oid = referenced_table.relnamespace
    where pg_constraint.contype = 'f'
      and pg_constraint.confrelid = 'public.labourers'::regclass
      and pg_constraint.conrelid not in (
        'public.production_entries'::regclass,
        'public.weekly_earnings'::regclass,
        'public.withdrawals'::regclass
      );

  if unexpected_references is not null then
    raise exception 'Placeholder cleanup aborted: unexpected tables reference labourers: %.', unexpected_references
      using errcode = 'P0001';
  end if;
end;
$$;

drop trigger if exists factories_provision_placeholder_labourer
  on public.factories;
drop function if exists public.provision_new_factory_placeholder();
drop function if exists public.ensure_factory_placeholder(uuid);

drop trigger if exists weekly_earnings_prevent_placeholder_labourer
  on public.weekly_earnings;
drop function if exists public.prevent_placeholder_labourer_weekly_earning();

drop trigger if exists production_entries_require_normal_brick_type
  on public.production_entries;
drop function if exists public.require_normal_production_brick_type();

delete from public.production_entries
using public.labourers
where labourers.id = production_entries.labourer_id
  and labourers.factory_id = production_entries.factory_id
  and labourers.is_placeholder;

delete from public.labourers
where labourers.is_placeholder;

do $$
begin
  if exists (
    select 1
    from public.labourers
    where assigned_brick_type_id is null
  ) then
    raise exception 'Placeholder cleanup aborted: a remaining labourer has no assigned brick type.'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.production_entries
    where brick_type_id is null
  ) then
    raise exception 'Placeholder cleanup aborted: a remaining production entry has no brick-type snapshot.'
      using errcode = 'P0001';
  end if;
end;
$$;

alter table public.labourers
  alter column assigned_brick_type_id set not null;

alter table public.labourers
  drop constraint if exists labourers_brick_type_required_unless_placeholder_check;

alter table public.production_entries
  alter column brick_type_id set not null;

drop index if exists public.labourers_one_placeholder_per_factory_idx;

commit;
