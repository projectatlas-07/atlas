-- Atlas Brick Types: durable Sales-only lifecycle and guarded deletion.

begin;

alter table public.brick_types
  add column ever_used boolean not null default false;

-- Preserve current references in any environment where this forward migration
-- is applied. Test Atlas Clean is reset separately through a project-scoped,
-- one-time operation so this migration is never destructive on Main Atlas.
update public.brick_types as brick_types
set ever_used = true
where exists (
  select 1
  from public.challan_items
  where challan_items.factory_id = brick_types.factory_id
    and challan_items.brick_type_id = brick_types.id
);

create or replace function public.protect_brick_type_usage_state()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    if new.ever_used then
      raise exception 'A new Brick Type cannot start as used.' using errcode = 'P3403';
    end if;
    return new;
  end if;

  if old.ever_used and not new.ever_used then
    raise exception 'Brick Type usage history cannot be reset.' using errcode = 'P3403';
  end if;

  if new.id <> old.id
    or new.factory_id <> old.factory_id
    or new.created_at <> old.created_at then
    raise exception 'Brick Type identity cannot be changed.' using errcode = 'P3403';
  end if;

  return new;
end;
$$;

create trigger brick_types_protect_usage_state
before insert or update on public.brick_types
for each row execute function public.protect_brick_type_usage_state();

create or replace function public.mark_challan_brick_type_used()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.brick_types
  set ever_used = true
  where id = new.brick_type_id
    and factory_id = new.factory_id
    and not ever_used;

  return new;
end;
$$;

create trigger challan_items_mark_brick_type_used
after insert on public.challan_items
for each row execute function public.mark_challan_brick_type_used();

create or replace function public.create_brick_type(
  p_factory_id uuid,
  p_name text
)
returns public.brick_types
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_name text := btrim(p_name);
  created_brick_type public.brick_types%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;

  if p_name is null or normalized_name = '' then
    raise exception 'Brick Type name is required.' using errcode = '22023';
  end if;

  insert into public.brick_types(factory_id, name, is_active, ever_used)
  values (p_factory_id, normalized_name, true, false)
  returning * into created_brick_type;

  return created_brick_type;
end;
$$;

create or replace function public.rename_brick_type(
  p_factory_id uuid,
  p_brick_type_id uuid,
  p_name text
)
returns public.brick_types
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_name text := btrim(p_name);
  changed_brick_type public.brick_types%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;

  if p_name is null or normalized_name = '' then
    raise exception 'Brick Type name is required.' using errcode = '22023';
  end if;

  update public.brick_types
  set name = normalized_name
  where id = p_brick_type_id
    and factory_id = p_factory_id
  returning * into changed_brick_type;

  if not found then
    raise exception 'Brick Type does not belong to this factory.' using errcode = 'P3400';
  end if;

  return changed_brick_type;
end;
$$;

create or replace function public.set_brick_type_active(
  p_factory_id uuid,
  p_brick_type_id uuid,
  p_is_active boolean
)
returns public.brick_types
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  changed_brick_type public.brick_types%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;

  if p_is_active is null then
    raise exception 'Brick Type active state is required.' using errcode = '22023';
  end if;

  update public.brick_types
  set is_active = p_is_active
  where id = p_brick_type_id
    and factory_id = p_factory_id
  returning * into changed_brick_type;

  if not found then
    raise exception 'Brick Type does not belong to this factory.' using errcode = 'P3400';
  end if;

  return changed_brick_type;
end;
$$;

create or replace function public.delete_unused_brick_type(
  p_factory_id uuid,
  p_brick_type_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_brick_type public.brick_types%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;

  -- This row lock serializes deletion with the Brick Type FK key-share lock
  -- taken by a concurrent Challan-item insert. The FK remains final authority.
  select * into target_brick_type
  from public.brick_types
  where id = p_brick_type_id
    and factory_id = p_factory_id
  for update;

  if not found then
    raise exception 'Brick Type does not belong to this factory.' using errcode = 'P3400';
  end if;

  if target_brick_type.ever_used then
    raise exception 'A Brick Type used in a saved Challan cannot be deleted. Deactivate it instead.'
      using errcode = 'P3401';
  end if;

  if exists (
    select 1
    from public.challan_items
    where challan_items.factory_id = p_factory_id
      and challan_items.brick_type_id = p_brick_type_id
  ) then
    raise exception 'A Brick Type referenced by a Challan cannot be deleted.'
      using errcode = 'P3402';
  end if;

  delete from public.brick_types
  where id = p_brick_type_id
    and factory_id = p_factory_id;

  return target_brick_type.id;
end;
$$;

-- Brick Type mutations are RPC-only. Clients keep factory-scoped SELECT access.
revoke insert, update, delete on public.brick_types from public, anon, authenticated;

revoke all on function public.protect_brick_type_usage_state()
  from public, anon, authenticated;
revoke all on function public.mark_challan_brick_type_used()
  from public, anon, authenticated;

revoke all on function public.create_brick_type(uuid, text)
  from public, anon, authenticated;
grant execute on function public.create_brick_type(uuid, text)
  to authenticated;

revoke all on function public.rename_brick_type(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.rename_brick_type(uuid, uuid, text)
  to authenticated;

revoke all on function public.set_brick_type_active(uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.set_brick_type_active(uuid, uuid, boolean)
  to authenticated;

revoke all on function public.delete_unused_brick_type(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_unused_brick_type(uuid, uuid)
  to authenticated;

comment on column public.brick_types.ever_used is
  'Monotonic lifecycle fact: true after the Brick Type first appears in a successfully saved Challan item.';
comment on function public.delete_unused_brick_type(uuid, uuid) is
  'Factory-scoped permanent deletion for a Brick Type that has never been used and has no current Challan-item reference.';

commit;
