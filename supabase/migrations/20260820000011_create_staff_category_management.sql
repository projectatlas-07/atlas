-- Atlas Staff redesign S5.1: controlled category rename and guarded deletion.

create or replace function public.update_staff_category(
  p_factory_id uuid,
  p_staff_category_id uuid,
  p_name text
)
returns public.staff_categories
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  category_row public.staff_categories%rowtype;
  normalized_name text := btrim(p_name);
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;

  if p_name is null or normalized_name = '' then
    raise exception 'Staff category name is required.' using errcode = '22023';
  end if;

  select * into category_row
  from public.staff_categories
  where staff_categories.id = p_staff_category_id
    and staff_categories.factory_id = p_factory_id
  for update;

  if not found then
    raise exception 'Staff category does not belong to this factory.' using errcode = 'P2504';
  end if;

  update public.staff_categories
  set name = normalized_name
  where id = p_staff_category_id
    and factory_id = p_factory_id
  returning * into category_row;

  return category_row;
end;
$$;

create or replace function public.delete_staff_category(
  p_factory_id uuid,
  p_staff_category_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  category_row public.staff_categories%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;

  -- The row lock serializes deletion with the worker FK's key-share lock.
  -- Whichever transaction wins, the worker cannot be orphaned.
  select * into category_row
  from public.staff_categories
  where staff_categories.id = p_staff_category_id
    and staff_categories.factory_id = p_factory_id
  for update;

  if not found then
    raise exception 'Staff category does not belong to this factory.' using errcode = 'P2504';
  end if;

  if exists (
    select 1 from public.staff_workers
    where staff_workers.factory_id = p_factory_id
      and staff_workers.staff_category_id = p_staff_category_id
  ) then
    raise exception 'This category is assigned to Staff members and cannot be deleted.'
      using errcode = 'P2570';
  end if;

  delete from public.staff_categories
  where id = p_staff_category_id
    and factory_id = p_factory_id;

  return category_row.id;
end;
$$;

-- Category updates are now RPC-only. Creation remains the existing direct,
-- factory-scoped insert path and deletion was never granted directly.
revoke update on public.staff_categories from authenticated;

revoke all on function public.update_staff_category(uuid, uuid, text) from public;
revoke all on function public.update_staff_category(uuid, uuid, text) from anon;
grant execute on function public.update_staff_category(uuid, uuid, text)
  to authenticated;

revoke all on function public.delete_staff_category(uuid, uuid) from public;
revoke all on function public.delete_staff_category(uuid, uuid) from anon;
grant execute on function public.delete_staff_category(uuid, uuid)
  to authenticated;
