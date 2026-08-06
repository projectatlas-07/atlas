alter table public.brick_types enable row level security;

grant select, insert, update on public.brick_types to authenticated;
revoke select, insert, update on public.brick_types from anon;

create policy "Authenticated users can read their factory brick types"
  on public.brick_types
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = brick_types.factory_id
        and factory_users.is_active = true
    )
  );

create policy "Authenticated users can insert their factory brick types"
  on public.brick_types
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = brick_types.factory_id
        and factory_users.is_active = true
    )
  );

create policy "Authenticated users can update their factory brick types"
  on public.brick_types
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = brick_types.factory_id
        and factory_users.is_active = true
    )
  )
  with check (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = brick_types.factory_id
        and factory_users.is_active = true
    )
  );
