alter table public.labourers enable row level security;

grant select, insert, update on public.labourers to authenticated;
revoke select, insert, update on public.labourers from anon;

create policy "Authenticated users can read their factory labourers"
  on public.labourers
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = labourers.factory_id
        and factory_users.is_active = true
    )
  );

create policy "Authenticated users can insert their factory labourers"
  on public.labourers
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = labourers.factory_id
        and factory_users.is_active = true
    )
    and exists (
      select 1
      from public.brick_types
      where brick_types.id = labourers.assigned_brick_type_id
        and brick_types.factory_id = labourers.factory_id
    )
  );

create policy "Authenticated users can update their factory labourers"
  on public.labourers
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = labourers.factory_id
        and factory_users.is_active = true
    )
  )
  with check (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = labourers.factory_id
        and factory_users.is_active = true
    )
    and exists (
      select 1
      from public.brick_types
      where brick_types.id = labourers.assigned_brick_type_id
        and brick_types.factory_id = labourers.factory_id
    )
  );
