-- Atlas Staff redesign S5: remove the obsolete entitlement/balance salary engine.
-- Every dependency drop is explicit and audited.

-- Drop public RPCs from the outside of the legacy call graph inward.
drop function public.create_staff_salary_deduction(uuid, uuid, date, numeric, text);
drop function public.create_staff_withdrawal(uuid, uuid, date, numeric);
drop function public.get_staff_financial_summary(uuid, uuid);

drop function public.deactivate_staff_worker(uuid, uuid, date);
drop function public.reactivate_staff_worker(uuid, uuid, date);
drop function public.create_staff_worker(uuid, text, uuid, date, numeric);

drop function public.ensure_staff_monthly_earnings(uuid, uuid, date);
drop function public.resolve_staff_monthly_salary(uuid, uuid, date);
drop function public.create_staff_category_monthly_salary(uuid, uuid, numeric, date);
drop function public.create_staff_monthly_salary_override(uuid, uuid, numeric, date);

-- Drop child financial tables before the tables they reference. Their owned
-- policies, grants, indexes, constraints, and triggers are removed with them.
drop table public.staff_salary_deductions;
drop table public.staff_withdrawals;
drop table public.staff_monthly_earnings;
drop table public.staff_salary_eligibility_periods;
drop table public.staff_monthly_salary_rates;

-- The immutable-history trigger functions are no longer referenced after the
-- audited table drops above.
drop function public.prevent_staff_salary_deduction_mutation();
drop function public.prevent_staff_withdrawal_mutation();
drop function public.prevent_staff_monthly_earning_mutation();

comment on table public.staff_categories is
  'Organizational Staff categories. Categories do not define salary or earnings.';
comment on table public.staff_workers is
  'Staff profiles with an informational individual reference salary and organizational Active/Archived state.';
