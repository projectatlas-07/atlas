grant select on public.factory_users to authenticated;

create policy "Authenticated users can read their own active factory mapping"
  on public.factory_users
  for select
  to authenticated
  using (auth.uid() = user_id and is_active = true);
