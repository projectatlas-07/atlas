alter table public.labourers
  add column is_placeholder boolean not null default false;

create unique index labourers_one_placeholder_per_factory_idx
  on public.labourers (factory_id)
  where is_placeholder;

create table public.labour_groups (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  name text not null,
  member_names text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint labour_groups_id_factory_key unique (id, factory_id)
);

create table public.wage_rates (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  applies_to text not null,
  rate_per_1000_bricks numeric not null,
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  constraint wage_rates_id_factory_key unique (id, factory_id),
  constraint wage_rates_applies_to_check
    check (applies_to in ('production', 'mud_supply')),
  constraint wage_rates_rate_per_1000_bricks_check
    check (rate_per_1000_bricks > 0),
  constraint wage_rates_effective_dates_check
    check (effective_to is null or effective_to >= effective_from)
);

create table public.weekly_earnings (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  labourer_id uuid,
  labour_group_id uuid,
  week_start date not null,
  quantity_used integer not null,
  wage_rate_id uuid not null,
  rate_used numeric not null,
  amount numeric not null,
  calculated_at timestamptz not null default now(),
  constraint weekly_earnings_exactly_one_entity_check
    check ((labourer_id is not null) <> (labour_group_id is not null)),
  constraint weekly_earnings_week_start_monday_check
    check (extract(isodow from week_start) = 1),
  constraint weekly_earnings_quantity_used_check
    check (quantity_used >= 0),
  constraint weekly_earnings_rate_used_check
    check (rate_used > 0),
  constraint weekly_earnings_amount_check
    check (amount >= 0),
  constraint weekly_earnings_labourer_factory_fkey
    foreign key (labourer_id, factory_id)
    references public.labourers (id, factory_id) on delete restrict,
  constraint weekly_earnings_labour_group_factory_fkey
    foreign key (labour_group_id, factory_id)
    references public.labour_groups (id, factory_id) on delete restrict,
  constraint weekly_earnings_wage_rate_factory_fkey
    foreign key (wage_rate_id, factory_id)
    references public.wage_rates (id, factory_id) on delete restrict
);

create unique index weekly_earnings_factory_labourer_week_key
  on public.weekly_earnings (factory_id, labourer_id, week_start)
  where labourer_id is not null;

create unique index weekly_earnings_factory_labour_group_week_key
  on public.weekly_earnings (factory_id, labour_group_id, week_start)
  where labour_group_id is not null;

create table public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  labourer_id uuid,
  labour_group_id uuid,
  withdrawal_date date not null,
  amount numeric not null,
  note text,
  created_at timestamptz not null default now(),
  constraint withdrawals_exactly_one_entity_check
    check ((labourer_id is not null) <> (labour_group_id is not null)),
  constraint withdrawals_amount_check
    check (amount > 0),
  constraint withdrawals_labourer_factory_fkey
    foreign key (labourer_id, factory_id)
    references public.labourers (id, factory_id) on delete restrict,
  constraint withdrawals_labour_group_factory_fkey
    foreign key (labour_group_id, factory_id)
    references public.labour_groups (id, factory_id) on delete restrict
);

alter table public.labour_groups enable row level security;
alter table public.wage_rates enable row level security;
alter table public.weekly_earnings enable row level security;
alter table public.withdrawals enable row level security;

revoke all on public.labour_groups, public.wage_rates, public.weekly_earnings, public.withdrawals from anon;
revoke all on public.labour_groups, public.wage_rates, public.weekly_earnings, public.withdrawals from authenticated;

grant select, insert, update on public.labour_groups to authenticated;
grant select, insert, update on public.wage_rates to authenticated;
grant select, insert on public.weekly_earnings to authenticated;
grant select, insert on public.withdrawals to authenticated;

create policy "Authenticated users can read their factory labour groups"
  on public.labour_groups
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = labour_groups.factory_id
        and factory_users.is_active = true
    )
  );

create policy "Authenticated users can insert their factory labour groups"
  on public.labour_groups
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = labour_groups.factory_id
        and factory_users.is_active = true
    )
  );

create policy "Authenticated users can update their factory labour groups"
  on public.labour_groups
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = labour_groups.factory_id
        and factory_users.is_active = true
    )
  )
  with check (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = labour_groups.factory_id
        and factory_users.is_active = true
    )
  );

create policy "Authenticated users can read their factory wage rates"
  on public.wage_rates
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = wage_rates.factory_id
        and factory_users.is_active = true
    )
  );

create policy "Authenticated users can insert their factory wage rates"
  on public.wage_rates
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = wage_rates.factory_id
        and factory_users.is_active = true
    )
  );

create policy "Authenticated users can update their factory wage rates"
  on public.wage_rates
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = wage_rates.factory_id
        and factory_users.is_active = true
    )
  )
  with check (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = wage_rates.factory_id
        and factory_users.is_active = true
    )
  );

create policy "Authenticated users can read their factory weekly earnings"
  on public.weekly_earnings
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = weekly_earnings.factory_id
        and factory_users.is_active = true
    )
  );

create policy "Authenticated users can insert their factory weekly earnings"
  on public.weekly_earnings
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = weekly_earnings.factory_id
        and factory_users.is_active = true
    )
  );

create policy "Authenticated users can read their factory withdrawals"
  on public.withdrawals
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = withdrawals.factory_id
        and factory_users.is_active = true
    )
  );

create policy "Authenticated users can insert their factory withdrawals"
  on public.withdrawals
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = withdrawals.factory_id
        and factory_users.is_active = true
    )
  );
