alter table public.weekly_earnings
  add constraint weekly_earnings_id_factory_key
    unique (id, factory_id),
  alter column wage_rate_id drop not null,
  alter column rate_used drop not null,
  add constraint weekly_earnings_legacy_rate_pair_check
    check ((wage_rate_id is null) = (rate_used is null)),
  add constraint weekly_earnings_mud_rate_required_check
    check (
      labour_group_id is null
      or (wage_rate_id is not null and rate_used is not null)
    );

create table public.production_weekly_earning_details (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  weekly_earning_id uuid not null,
  work_date date not null,
  quantity_used integer not null,
  production_wage_rate_id uuid not null,
  rate_per_1000_bricks numeric not null,
  rate_source text not null,
  production_crew_id uuid,
  amount numeric not null,
  created_at timestamptz not null default now(),
  constraint production_weekly_earning_details_parent_work_date_key
    unique (weekly_earning_id, work_date),
  constraint production_weekly_earning_details_quantity_used_check
    check (quantity_used > 0),
  constraint production_weekly_earning_details_rate_check
    check (
      rate_per_1000_bricks > 0
      and rate_per_1000_bricks <> 'NaN'::numeric
    ),
  constraint production_weekly_earning_details_rate_source_check
    check (rate_source in ('crew_default', 'individual_override')),
  constraint production_weekly_earning_details_rate_source_crew_check
    check (
      (rate_source = 'crew_default' and production_crew_id is not null)
      or (rate_source = 'individual_override' and production_crew_id is null)
    ),
  constraint production_weekly_earning_details_amount_check
    check (amount >= 0 and amount <> 'NaN'::numeric),
  constraint production_weekly_earning_details_parent_factory_fkey
    foreign key (weekly_earning_id, factory_id)
    references public.weekly_earnings (id, factory_id) on delete restrict,
  constraint production_weekly_earning_details_rate_factory_fkey
    foreign key (production_wage_rate_id, factory_id)
    references public.production_wage_rates (id, factory_id) on delete restrict,
  constraint production_weekly_earning_details_crew_factory_fkey
    foreign key (production_crew_id, factory_id)
    references public.production_crews (id, factory_id) on delete restrict
);

create index production_weekly_earning_details_factory_parent_idx
  on public.production_weekly_earning_details (factory_id, weekly_earning_id);

alter table public.production_weekly_earning_details enable row level security;

revoke all on public.production_weekly_earning_details from anon;
revoke all on public.production_weekly_earning_details from authenticated;

grant select on public.production_weekly_earning_details to authenticated;

create policy "Authenticated users can read their factory production weekly earning details"
  on public.production_weekly_earning_details
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = production_weekly_earning_details.factory_id
        and factory_users.is_active = true
    )
  );
