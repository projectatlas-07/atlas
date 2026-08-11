do $$
begin
  if exists (
    select 1
    from public.weekly_earnings
    join public.labourers
      on labourers.id = weekly_earnings.labourer_id
      and labourers.factory_id = weekly_earnings.factory_id
    where labourers.is_placeholder
  ) then
    raise exception 'Cannot enforce placeholder earning guard: a placeholder labourer already has an individual weekly earning.'
      using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.prevent_placeholder_labourer_weekly_earning()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.labourer_id is not null and exists (
    select 1
    from public.labourers
    where labourers.id = new.labourer_id
      and labourers.factory_id = new.factory_id
      and labourers.is_placeholder
  ) then
    raise exception 'Placeholder labourers cannot receive individual weekly earnings.'
      using
        errcode = '23514',
        constraint = 'weekly_earnings_placeholder_labourer_check';
  end if;

  return new;
end;
$$;

revoke all on function public.prevent_placeholder_labourer_weekly_earning() from public;
revoke all on function public.prevent_placeholder_labourer_weekly_earning() from anon;
revoke all on function public.prevent_placeholder_labourer_weekly_earning() from authenticated;

create trigger weekly_earnings_prevent_placeholder_labourer
before insert or update of factory_id, labourer_id
on public.weekly_earnings
for each row
execute function public.prevent_placeholder_labourer_weekly_earning();
