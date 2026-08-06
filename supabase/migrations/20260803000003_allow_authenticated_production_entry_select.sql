grant select on public.production_entries to authenticated;

create policy "Authenticated users can read their factory production entries"
  on public.production_entries
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = production_entries.factory_id
        and factory_users.is_active = true
    )
  );
