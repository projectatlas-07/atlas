-- Prevent Staff creation when the first eligible month has no salary to snapshot.

create or replace function public.create_staff_worker(
  p_factory_id uuid,
  p_name text,
  p_staff_category_id uuid,
  p_salary_start_month date,
  p_first_month_custom_salary numeric default null
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

  if p_salary_start_month is null or not isfinite(p_salary_start_month)
    or p_salary_start_month <> date_trunc('month', p_salary_start_month)::date then
    raise exception 'salary_start_month must be the first day of a finite month.'
      using errcode = '22023';
  end if;

  if p_first_month_custom_salary is not null and (
    p_first_month_custom_salary <= 0
    or p_first_month_custom_salary = 'NaN'::numeric
  ) then
    raise exception 'first_month_custom_salary must be greater than zero.'
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.staff_categories
    where staff_categories.id = p_staff_category_id
      and staff_categories.factory_id = p_factory_id
  ) then
    raise exception 'Staff category does not belong to this factory.' using errcode = '42501';
  end if;

  -- Use the same category salary track lock as salary creation/correction so a
  -- worker cannot be created between validation and a concurrent rate change.
  perform pg_advisory_xact_lock(
    hashtext(p_factory_id::text),
    hashtext('staff_category_monthly_salary:' || p_staff_category_id::text)
  );

  if not exists (
    select 1 from public.staff_monthly_salary_rates
    where staff_monthly_salary_rates.factory_id = p_factory_id
      and staff_monthly_salary_rates.staff_category_id = p_staff_category_id
      and staff_monthly_salary_rates.staff_worker_id is null
      and staff_monthly_salary_rates.effective_from <= p_salary_start_month
      and (
        staff_monthly_salary_rates.effective_to is null
        or staff_monthly_salary_rates.effective_to >= p_salary_start_month
      )
  ) then
    raise exception 'Salary not set for the Staff start month. Configure the category salary for that month first.'
      using errcode = 'P2505';
  end if;

  insert into public.staff_workers (
    factory_id, name, staff_category_id, is_active
  ) values (
    p_factory_id, btrim(p_name), p_staff_category_id, true
  ) returning * into new_worker;

  insert into public.staff_salary_eligibility_periods (
    factory_id, staff_worker_id, effective_from_month,
    first_month_custom_salary
  ) values (
    p_factory_id, new_worker.id, p_salary_start_month,
    p_first_month_custom_salary
  );

  return new_worker;
end;
$$;

revoke all on function public.create_staff_worker(uuid, text, uuid, date, numeric) from public;
revoke all on function public.create_staff_worker(uuid, text, uuid, date, numeric) from anon;
grant execute on function public.create_staff_worker(uuid, text, uuid, date, numeric) to authenticated;
