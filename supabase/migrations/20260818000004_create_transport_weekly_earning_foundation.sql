create table public.transport_weekly_earnings (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  transport_worker_id uuid not null,
  week_start date not null,
  total_amount numeric not null,
  created_at timestamptz not null default now(),
  constraint transport_weekly_earnings_parent_identity_key
    unique (id, factory_id, transport_worker_id, week_start),
  constraint transport_weekly_earnings_worker_week_key
    unique (factory_id, transport_worker_id, week_start),
  constraint transport_weekly_earnings_week_start_monday_check
    check (
      isfinite(week_start)
      and extract(isodow from week_start) = 1
    ),
  constraint transport_weekly_earnings_total_amount_check
    check (
      total_amount >= 0
      and total_amount <> 'NaN'::numeric
    ),
  constraint transport_weekly_earnings_worker_factory_fkey
    foreign key (transport_worker_id, factory_id)
    references public.transport_workers (id, factory_id) on delete restrict
);

create table public.transport_weekly_earning_details (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  transport_weekly_earning_id uuid not null,
  transport_worker_id uuid not null,
  week_start date not null,
  transport_daily_entry_id uuid not null,
  transport_crew_id uuid not null,
  work_date date not null,
  transport_crew_wage_rate_id uuid not null,
  rate_per_paya_snapshot numeric not null,
  paya_quantity_snapshot numeric not null,
  attendance_count_snapshot integer not null,
  daily_crew_pool_snapshot numeric not null,
  worker_daily_share_snapshot numeric not null,
  created_at timestamptz not null default now(),
  constraint transport_weekly_earning_details_parent_entry_key
    unique (transport_weekly_earning_id, transport_daily_entry_id),
  constraint transport_weekly_earning_details_week_check
    check (
      isfinite(week_start)
      and isfinite(work_date)
      and work_date >= week_start
      and work_date <= week_start + 6
    ),
  constraint transport_weekly_earning_details_rate_snapshot_check
    check (
      rate_per_paya_snapshot > 0
      and rate_per_paya_snapshot <> 'NaN'::numeric
    ),
  constraint transport_weekly_earning_details_paya_snapshot_check
    check (
      paya_quantity_snapshot > 0
      and paya_quantity_snapshot <> 'NaN'::numeric
    ),
  constraint transport_weekly_earning_details_attendance_snapshot_check
    check (attendance_count_snapshot > 0),
  constraint transport_weekly_earning_details_pool_snapshot_check
    check (
      daily_crew_pool_snapshot > 0
      and daily_crew_pool_snapshot <> 'NaN'::numeric
    ),
  constraint transport_weekly_earning_details_share_snapshot_check
    check (
      worker_daily_share_snapshot > 0
      and worker_daily_share_snapshot <> 'NaN'::numeric
    ),
  constraint transport_weekly_earning_details_parent_identity_fkey
    foreign key (
      transport_weekly_earning_id,
      factory_id,
      transport_worker_id,
      week_start
    )
    references public.transport_weekly_earnings (
      id,
      factory_id,
      transport_worker_id,
      week_start
    ) on delete restrict,
  constraint transport_weekly_earning_details_daily_entry_fkey
    foreign key (
      transport_daily_entry_id,
      factory_id,
      transport_crew_id,
      work_date
    )
    references public.transport_daily_entries (
      id,
      factory_id,
      transport_crew_id,
      work_date
    ) on delete restrict,
  constraint transport_weekly_earning_details_rate_factory_fkey
    foreign key (transport_crew_wage_rate_id, factory_id)
    references public.transport_crew_wage_rates (id, factory_id) on delete restrict
);

create index transport_weekly_earnings_factory_week_idx
  on public.transport_weekly_earnings (factory_id, week_start desc);

create index transport_weekly_earning_details_factory_parent_idx
  on public.transport_weekly_earning_details (
    factory_id,
    transport_weekly_earning_id
  );

alter table public.transport_weekly_earnings enable row level security;
alter table public.transport_weekly_earning_details enable row level security;

revoke all on public.transport_weekly_earnings,
  public.transport_weekly_earning_details from anon;
revoke all on public.transport_weekly_earnings,
  public.transport_weekly_earning_details from authenticated;

grant select on public.transport_weekly_earnings,
  public.transport_weekly_earning_details to authenticated;

create policy "Authenticated users can read their factory transport weekly earnings"
  on public.transport_weekly_earnings
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = transport_weekly_earnings.factory_id
        and factory_users.is_active = true
    )
  );

create policy "Authenticated users can read their factory transport weekly earning details"
  on public.transport_weekly_earning_details
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = transport_weekly_earning_details.factory_id
        and factory_users.is_active = true
    )
  );
