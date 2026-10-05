create or replace function public.resolve_factory_access()
returns table(status text, factory_id uuid)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  current_user_id uuid := auth.uid();
  membership_factory_id uuid;
  membership_is_active boolean;
begin
  if current_user_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'ATLAS_UNAUTHENTICATED';
  end if;

  select memberships.factory_id, memberships.is_active
  into membership_factory_id, membership_is_active
  from public.factory_users as memberships
  where memberships.user_id = current_user_id;

  if not found then
    return query select 'none'::text, null::uuid;
    return;
  end if;

  if membership_is_active then
    return query select 'active'::text, membership_factory_id;
    return;
  end if;

  return query select 'inactive'::text, null::uuid;
end;
$$;

comment on function public.resolve_factory_access() is
  'Read-only routing hint for the authenticated user factory membership. Returns only active, inactive, or none; authorization remains enforced independently by RLS and write RPCs.';

revoke all on function public.resolve_factory_access() from public;
revoke all on function public.resolve_factory_access() from anon;
revoke all on function public.resolve_factory_access() from authenticated;
grant execute on function public.resolve_factory_access() to authenticated;
