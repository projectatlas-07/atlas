alter table public.production_entries
  add constraint production_entries_factory_labourer_brick_type_date_key
  unique (factory_id, labourer_id, brick_type_id, production_date);

alter table public.production_entries enable row level security;

create policy "Development anonymous production entry select"
  on public.production_entries
  for select
  to anon
  using (true);

create policy "Development anonymous production entry insert"
  on public.production_entries
  for insert
  to anon
  with check (true);

create policy "Development anonymous production entry update"
  on public.production_entries
  for update
  to anon
  using (true)
  with check (true);
