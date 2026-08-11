create or replace function public.ensure_factory_placeholder(p_factory_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.labourers (
    factory_id,
    name,
    assigned_brick_type_id,
    is_placeholder,
    is_active
  )
  values (
    p_factory_id,
    'Unattributed Production',
    null,
    true,
    true
  )
  on conflict (factory_id) where is_placeholder
  do nothing;
end;
$$;

revoke all on function public.ensure_factory_placeholder(uuid) from public;
revoke all on function public.ensure_factory_placeholder(uuid) from anon;
revoke all on function public.ensure_factory_placeholder(uuid) from authenticated;

create or replace function public.provision_new_factory_placeholder()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.ensure_factory_placeholder(new.id);
  return new;
end;
$$;

revoke all on function public.provision_new_factory_placeholder() from public;
revoke all on function public.provision_new_factory_placeholder() from anon;
revoke all on function public.provision_new_factory_placeholder() from authenticated;

create trigger factories_provision_placeholder_labourer
after insert on public.factories
for each row
execute function public.provision_new_factory_placeholder();

select public.ensure_factory_placeholder(factories.id)
from public.factories;
