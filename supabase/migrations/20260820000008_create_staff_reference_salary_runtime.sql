-- Atlas Staff redesign S2: authoritative individual reference salary runtime.

create or replace function public.create_staff_worker_with_reference_salary(
  p_factory_id uuid,
  p_name text,
  p_staff_category_id uuid,
  p_reference_salary numeric
)
returns public.staff_workers
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  new_worker public.staff_workers%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;

  if p_name is null or btrim(p_name) = '' then
    raise exception 'Staff worker name is required.' using errcode = '22023';
  end if;

  if p_staff_category_id is null or not exists (
    select 1 from public.staff_categories
    where staff_categories.id = p_staff_category_id
      and staff_categories.factory_id = p_factory_id
  ) then
    raise exception 'Staff category does not belong to this factory.' using errcode = '42501';
  end if;

  if p_reference_salary is null or p_reference_salary <= 0
    or p_reference_salary = 'NaN'::numeric then
    raise exception 'reference_salary must be greater than zero.' using errcode = '22023';
  end if;

  insert into public.staff_workers (
    factory_id,
    name,
    staff_category_id,
    reference_salary,
    is_active
  ) values (
    p_factory_id,
    btrim(p_name),
    p_staff_category_id,
    p_reference_salary,
    true
  ) returning * into new_worker;

  return new_worker;
end;
$$;

create or replace function public.update_staff_reference_salary(
  p_factory_id uuid,
  p_staff_worker_id uuid,
  p_reference_salary numeric
)
returns public.staff_workers
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  worker_row public.staff_workers%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;

  if p_reference_salary is null or p_reference_salary <= 0
    or p_reference_salary = 'NaN'::numeric then
    raise exception 'reference_salary must be greater than zero.' using errcode = '22023';
  end if;

  select * into worker_row
  from public.staff_workers
  where staff_workers.id = p_staff_worker_id
    and staff_workers.factory_id = p_factory_id
  for update;

  if not found then
    raise exception 'Staff worker does not belong to this factory.' using errcode = 'P2502';
  end if;

  update public.staff_workers
  set reference_salary = p_reference_salary
  where id = p_staff_worker_id
    and factory_id = p_factory_id
  returning * into worker_row;

  return worker_row;
end;
$$;

revoke all on function public.create_staff_worker_with_reference_salary(
  uuid, text, uuid, numeric
) from public;
revoke all on function public.create_staff_worker_with_reference_salary(
  uuid, text, uuid, numeric
) from anon;
grant execute on function public.create_staff_worker_with_reference_salary(
  uuid, text, uuid, numeric
) to authenticated;

revoke all on function public.update_staff_reference_salary(
  uuid, uuid, numeric
) from public;
revoke all on function public.update_staff_reference_salary(
  uuid, uuid, numeric
) from anon;
grant execute on function public.update_staff_reference_salary(
  uuid, uuid, numeric
) to authenticated;
