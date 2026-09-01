-- Atlas S7A repair: qualify supplier identity inside list_expense_records.
-- The original function's RETURNS TABLE factory_id output variable made its bare
-- supplier factory_id predicate ambiguous at runtime when a supplier filter was used.

create or replace function public.list_expense_records(
  p_factory_id uuid,
  p_supplier_id uuid
)
returns table (
  expense_record_id uuid,
  factory_id uuid,
  business_date date,
  kind text,
  supplier_id uuid,
  counterparty_name_snapshot text,
  counterparty_address_snapshot text,
  counterparty_mobile_snapshot text,
  description text,
  total_amount numeric,
  note text,
  status text,
  is_locked boolean,
  total_paid numeric,
  outstanding_amount numeric,
  payment_state text,
  voided_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not exists (
    select 1
    from public.factory_users as authorized_user
    where authorized_user.user_id = auth.uid()
      and authorized_user.factory_id = p_factory_id
      and authorized_user.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;
  if p_supplier_id is not null and not exists (
    select 1
    from public.suppliers as requested_supplier
    where requested_supplier.id = p_supplier_id
      and requested_supplier.factory_id = p_factory_id
  ) then
    raise exception 'Supplier does not belong to this factory.' using errcode = 'P4002';
  end if;

  return query
  select
    records.id, records.factory_id, records.business_date, records.kind, records.supplier_id,
    records.counterparty_name_snapshot, records.counterparty_address_snapshot,
    records.counterparty_mobile_snapshot, records.description, records.total_amount,
    records.note, records.status, records.is_locked,
    coalesce(paid.total_paid, 0),
    case when records.status = 'active'
      then records.total_amount - coalesce(paid.total_paid, 0) else 0 end,
    case
      when coalesce(paid.total_paid, 0) = 0 then 'unpaid'
      when coalesce(paid.total_paid, 0) < records.total_amount then 'partially_paid'
      else 'paid'
    end,
    records.voided_at, records.created_at, records.updated_at
  from public.expense_records as records
  left join lateral (
    select coalesce(sum(allocations.allocated_amount), 0) as total_paid
    from public.expense_payment_allocations as allocations
    where allocations.factory_id = records.factory_id
      and allocations.expense_record_id = records.id
  ) as paid on true
  where records.factory_id = p_factory_id
    and (p_supplier_id is null or records.supplier_id = p_supplier_id)
  order by records.business_date desc, records.created_at desc, records.id desc;
end;
$$;

revoke all on function public.list_expense_records(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.list_expense_records(uuid, uuid) to authenticated;

comment on function public.list_expense_records(uuid, uuid) is
  'Lists authoritative Expense/Purchase state; supplier validation uses qualified columns to avoid PL/pgSQL output-variable ambiguity.';
