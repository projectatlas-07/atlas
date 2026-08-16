create table public.production_wage_rates (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  production_crew_id uuid,
  labourer_id uuid,
  rate_per_1000_bricks numeric not null,
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint production_wage_rates_id_factory_key
    unique (id, factory_id),
  constraint production_wage_rates_exactly_one_scope_check
    check ((production_crew_id is not null) <> (labourer_id is not null)),
  constraint production_wage_rates_rate_per_1000_bricks_check
    check (
      rate_per_1000_bricks > 0
      and rate_per_1000_bricks <> 'NaN'::numeric
    ),
  constraint production_wage_rates_effective_dates_check
    check (effective_to is null or effective_to >= effective_from),
  constraint production_wage_rates_crew_factory_fkey
    foreign key (production_crew_id, factory_id)
    references public.production_crews (id, factory_id) on delete restrict,
  constraint production_wage_rates_labourer_factory_fkey
    foreign key (labourer_id, factory_id)
    references public.labourers (id, factory_id) on delete restrict,
  constraint production_wage_rates_no_overlapping_crew_dates
    exclude using gist (
      production_crew_id with =,
      daterange(effective_from, effective_to, '[]') with &&
    ) where (production_crew_id is not null),
  constraint production_wage_rates_no_overlapping_labourer_dates
    exclude using gist (
      labourer_id with =,
      daterange(effective_from, effective_to, '[]') with &&
    ) where (labourer_id is not null)
);

create index production_wage_rates_factory_idx
  on public.production_wage_rates (factory_id);

create trigger production_wage_rates_set_updated_at
before update on public.production_wage_rates
for each row execute function public.set_updated_at();

alter table public.production_wage_rates enable row level security;

revoke all on public.production_wage_rates from anon;
revoke all on public.production_wage_rates from authenticated;

grant select on public.production_wage_rates to authenticated;

create policy "Authenticated users can read their factory production wage rates"
  on public.production_wage_rates
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = production_wage_rates.factory_id
        and factory_users.is_active = true
    )
  );
