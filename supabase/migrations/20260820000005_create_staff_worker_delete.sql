-- Delete only mistaken Staff setup that has no immutable financial history.

create or replace function public.delete_staff_worker(
  p_factory_id uuid,
  p_staff_worker_id uuid
)
returns uuid
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

  -- Match the salary-boundary correction lock order, then serialize against
  -- lifecycle changes, earning materialization, withdrawals, and deductions.
  perform pg_advisory_xact_lock(
    hashtext(p_factory_id::text),
    hashtext('staff_worker_monthly_salary:' || p_staff_worker_id::text)
  );
  perform pg_advisory_xact_lock(
    hashtext(p_factory_id::text),
    hashtext('staff_salary_lifecycle:' || p_staff_worker_id::text)
  );

  select * into worker_row
  from public.staff_workers
  where staff_workers.id = p_staff_worker_id
    and staff_workers.factory_id = p_factory_id
  for update;

  if not found then
    raise exception 'Staff worker does not belong to this factory.' using errcode = 'P2502';
  end if;

  if exists (
    select 1 from public.staff_monthly_earnings
    where staff_monthly_earnings.factory_id = p_factory_id
      and staff_monthly_earnings.staff_worker_id = p_staff_worker_id
  ) or exists (
    select 1 from public.staff_withdrawals
    where staff_withdrawals.factory_id = p_factory_id
      and staff_withdrawals.staff_worker_id = p_staff_worker_id
  ) or exists (
    select 1 from public.staff_salary_deductions
    where staff_salary_deductions.factory_id = p_factory_id
      and staff_salary_deductions.staff_worker_id = p_staff_worker_id
  ) then
    raise exception 'This Staff member has salary history and cannot be deleted. Deactivate them instead.'
      using errcode = 'P2540';
  end if;

  delete from public.staff_monthly_salary_rates
  where factory_id = p_factory_id
    and staff_worker_id = p_staff_worker_id
    and staff_category_id is null;

  delete from public.staff_salary_eligibility_periods
  where factory_id = p_factory_id
    and staff_worker_id = p_staff_worker_id;

  delete from public.staff_workers
  where id = p_staff_worker_id
    and factory_id = p_factory_id;

  return worker_row.id;
end;
$$;

revoke all on function public.delete_staff_worker(uuid, uuid) from public;
revoke all on function public.delete_staff_worker(uuid, uuid) from anon;
grant execute on function public.delete_staff_worker(uuid, uuid) to authenticated;
