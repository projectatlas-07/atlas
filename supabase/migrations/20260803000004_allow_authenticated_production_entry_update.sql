grant update on public.production_entries to authenticated;

create policy "Authenticated users can update their factory production entries"
  on public.production_entries
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = production_entries.factory_id
        and factory_users.is_active = true
    )
  )
  with check (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = production_entries.factory_id
        and factory_users.is_active = true
    )
  );
