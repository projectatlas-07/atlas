-- Atlas multi-mode customer payments Step 1: additive method storage only.
-- The legacy customer_payments.payment_mode column remains authoritative until
-- the payment writers and readers are cut over in a later milestone.

begin;

create table public.customer_payment_methods (
  factory_id uuid not null references public.factories(id) on delete restrict,
  payment_id uuid not null,
  mode text not null,
  split_amount numeric(18, 2),
  created_at timestamptz not null default now(),
  constraint customer_payment_methods_payment_mode_key
    primary key (payment_id, mode),
  constraint customer_payment_methods_payment_factory_fkey
    foreign key (payment_id, factory_id)
    references public.customer_payments(id, factory_id) on delete restrict,
  constraint customer_payment_methods_mode_check check (
    mode in ('cash', 'upi', 'bank_transfer', 'cheque', 'other', 'unspecified')
  ),
  constraint customer_payment_methods_split_amount_check check (
    split_amount is null
    or (
      split_amount > 0
      and split_amount <> 'NaN'::numeric
      and split_amount <> 'Infinity'::numeric
      and split_amount < 10000000000000000
      and split_amount = round(split_amount, 2)
    )
  )
);

create index customer_payment_methods_factory_payment_idx
  on public.customer_payment_methods(factory_id, payment_id, mode);

alter table public.customer_payment_methods enable row level security;

revoke all on public.customer_payment_methods from public, anon, authenticated;
grant select on public.customer_payment_methods to authenticated;

create policy "Authenticated users can read their factory customer payment methods"
  on public.customer_payment_methods
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = customer_payment_methods.factory_id
        and factory_users.is_active = true
    )
  );

-- Historical rows recorded only one scalar mode. Preserve that fact without
-- fabricating a per-method amount: every backfilled split remains NULL.
insert into public.customer_payment_methods(
  factory_id,
  payment_id,
  mode,
  split_amount,
  created_at
)
select
  payments.factory_id,
  payments.id,
  payments.payment_mode,
  null,
  payments.created_at
from public.customer_payments as payments
order by payments.id
on conflict (payment_id, mode) do nothing;

do $$
begin
  if exists (
    select 1
    from public.customer_payments as payments
    left join public.customer_payment_methods as methods
      on methods.payment_id = payments.id
      and methods.factory_id = payments.factory_id
    group by payments.id, payments.factory_id, payments.payment_mode
    having count(methods.payment_id) <> 1
      or min(methods.mode) is distinct from payments.payment_mode
      or count(methods.split_amount) <> 0
  ) then
    raise exception 'Customer payment method backfill is incomplete or inconsistent.'
      using errcode = 'P3108';
  end if;
end;
$$;

create trigger customer_payment_methods_prevent_update_delete
before update or delete on public.customer_payment_methods
for each row execute function public.prevent_customer_payment_mutation();

comment on table public.customer_payment_methods is
  'Immutable payment-method metadata for one customer payment. Step 1 backfills one unsplit method from the legacy scalar mode.';
comment on column public.customer_payment_methods.split_amount is
  'Explicit per-method amount when recorded. NULL means no method split was supplied and must never be inferred.';

commit;
