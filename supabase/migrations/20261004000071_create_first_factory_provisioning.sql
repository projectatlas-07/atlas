do $$
declare
  factory_name_constraint name;
begin
  select constraints.conname
  into factory_name_constraint
  from pg_catalog.pg_constraint as constraints
  join pg_catalog.pg_attribute as attributes
    on attributes.attrelid = constraints.conrelid
    and attributes.attnum = any(constraints.conkey)
  where constraints.conrelid = 'public.factories'::regclass
    and constraints.contype = 'u'
    and pg_catalog.cardinality(constraints.conkey) = 1
    and attributes.attname = 'name';

  if factory_name_constraint is null then
    raise exception 'Expected one global unique constraint on public.factories.name.';
  end if;

  execute pg_catalog.format(
    'alter table public.factories drop constraint %I',
    factory_name_constraint
  );
end;
$$;

-- Provisioning order is deliberate: authenticate, lock by auth.uid(), return or
-- reject any existing membership, verify email confirmation only for users with
-- no membership, validate the name, insert the factory (and let its existing
-- initialization triggers run), insert the membership, then return the result.
-- Keeping the existing-membership check before email confirmation preserves
-- historical users whose Auth confirmation metadata may be absent.
create or replace function public.provision_first_factory(p_factory_name text)
returns table(factory_id uuid, created boolean)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_user_id uuid := auth.uid();
  existing_factory_id uuid;
  existing_membership_active boolean;
  normalized_factory_name text;
  new_factory_id uuid;
begin
  if current_user_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'ATLAS_UNAUTHENTICATED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'atlas:provision_first_factory:' || current_user_id::text,
      0
    )
  );

  select memberships.factory_id, memberships.is_active
  into existing_factory_id, existing_membership_active
  from public.factory_users as memberships
  where memberships.user_id = current_user_id;

  if found then
    if not existing_membership_active then
      raise exception using
        errcode = 'P0001',
        message = 'ATLAS_MEMBERSHIP_INACTIVE';
    end if;

    return query select existing_factory_id, false;
    return;
  end if;

  if not exists (
    select 1
    from auth.users as users
    where users.id = current_user_id
      and users.email_confirmed_at is not null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'ATLAS_EMAIL_NOT_CONFIRMED';
  end if;

  if p_factory_name is null or p_factory_name ~ '[[:cntrl:]]' then
    raise exception using
      errcode = 'P0001',
      message = 'ATLAS_INVALID_FACTORY_NAME';
  end if;

  normalized_factory_name := pg_catalog.regexp_replace(
    pg_catalog.btrim(p_factory_name),
    '[[:space:]]+',
    ' ',
    'g'
  );

  if normalized_factory_name = ''
    or pg_catalog.char_length(normalized_factory_name) > 200 then
    raise exception using
      errcode = 'P0001',
      message = 'ATLAS_INVALID_FACTORY_NAME';
  end if;

  insert into public.factories(name)
  values (normalized_factory_name)
  returning id into new_factory_id;

  insert into public.factory_users(user_id, factory_id, is_active)
  values (current_user_id, new_factory_id, true);

  return query select new_factory_id, true;
end;
$$;

comment on function public.provision_first_factory(text) is
  'Atomically provisions the authenticated confirmed user first factory and active membership. Factory names are normalized and limited to 200 characters; active memberships are returned idempotently.';

revoke all on function public.provision_first_factory(text) from public;
revoke all on function public.provision_first_factory(text) from anon;
revoke all on function public.provision_first_factory(text) from authenticated;
grant execute on function public.provision_first_factory(text) to authenticated;
