create or replace function public.require_normal_production_brick_type()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.brick_type_id is null and exists (
    select 1
    from public.labourers
    where labourers.id = new.labourer_id
      and labourers.factory_id = new.factory_id
      and not labourers.is_placeholder
  ) then
    raise exception 'Normal labourer production requires a brick type.'
      using
        errcode = '23514',
        constraint = 'production_entries_normal_labourer_brick_type_check';
  end if;

  return new;
end;
$$;

revoke all on function public.require_normal_production_brick_type() from public;
revoke all on function public.require_normal_production_brick_type() from anon;
revoke all on function public.require_normal_production_brick_type() from authenticated;

create trigger production_entries_require_normal_brick_type
before insert or update of factory_id, labourer_id, brick_type_id
on public.production_entries
for each row
execute function public.require_normal_production_brick_type();

alter table public.production_entries
  alter column brick_type_id drop not null;
