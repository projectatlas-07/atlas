-- Atlas Staff redesign S6: enforce the final worker/category model.

do $$
begin
  if exists (
    select 1 from public.staff_workers
    where reference_salary is null
  ) then
    raise exception 'Cannot finalize Staff: every existing Staff worker needs a positive reference salary.'
      using errcode = '23502';
  end if;
end;
$$;

alter table public.staff_workers
  alter column reference_salary set not null;

drop index public.staff_categories_factory_active_idx;

alter table public.staff_categories
  drop column is_active;

comment on table public.staff_categories is
  'Organizational Staff categories. Categories can be renamed or deleted when unused; they do not define salary or have an archive lifecycle.';
