grant insert on public.production_entries to authenticated;

create policy "Authenticated users can insert their factory production entries"
  on public.production_entries
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = production_entries.factory_id
        and factory_users.is_active = true
    )
  );
