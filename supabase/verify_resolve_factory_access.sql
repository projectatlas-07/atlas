-- Atlas Authentication 11D3b rollback verifier. Run only on confirmed Test Atlas Clean.

begin;

create temporary table atlas_11d3b_persistent_baseline (
  factories_count bigint not null,
  memberships_count bigint not null,
  auth_users_count bigint not null,
  mud_states_count bigint not null
) on commit preserve rows;

insert into atlas_11d3b_persistent_baseline
select
  (select count(*) from public.factories),
  (select count(*) from public.factory_users),
  (select count(*) from auth.users),
  (select count(*) from public.mud_accounting_states);

do $$
declare
  resolver_oid oid := pg_catalog.to_regprocedure('public.resolve_factory_access()');
  resolver_definition text;
begin
  if resolver_oid is null then
    raise exception 'FAIL: resolve_factory_access() is missing';
  end if;

  select pg_catalog.pg_get_functiondef(resolver_oid)
  into resolver_definition;

  if not exists (
    select 1
    from pg_catalog.pg_proc
    where oid = resolver_oid
      and prosecdef
      and provolatile = 's'
      and proconfig @> array['search_path=pg_catalog, public']
  ) then
    raise exception 'FAIL: resolver is not SECURITY DEFINER, STABLE, and fixed-search-path';
  end if;

  if resolver_definition ~* '\m(insert|update|delete|merge|truncate|nextval)\M' then
    raise exception 'FAIL: resolver definition contains a write operation';
  end if;

  if resolver_definition not like '%auth.uid()%'
    or resolver_definition not like '%from public.factory_users%'
    or resolver_definition like '%p_user_id%' then
    raise exception 'FAIL: resolver identity or membership lookup is not narrowly scoped';
  end if;

  if not pg_catalog.has_function_privilege('authenticated', resolver_oid, 'EXECUTE')
    or pg_catalog.has_function_privilege('anon', resolver_oid, 'EXECUTE')
    or exists (
      select 1
      from pg_catalog.pg_proc as procedures
      cross join lateral pg_catalog.aclexplode(
        coalesce(
          procedures.proacl,
          pg_catalog.acldefault('f', procedures.proowner)
        )
      ) as privileges
      where procedures.oid = resolver_oid
        and privileges.grantee = 0
        and privileges.privilege_type = 'EXECUTE'
    ) then
    raise exception 'FAIL: resolver execute privileges are not authenticated-only';
  end if;

  raise notice 'PASS [EXECUTED]: resolver is STABLE, read-only, fixed-search-path, and authenticated-only';
end;
$$;

insert into auth.users (
  id,
  aud,
  role,
  email,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  ('13b00000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'atlas-11d3b-active@example.invalid', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('13b00000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'atlas-11d3b-inactive@example.invalid', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('13b00000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'atlas-11d3b-none@example.invalid', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.factories(id, name)
values
  ('13b10000-0000-4000-8000-000000000001', 'Atlas 11D3b Active Fixture'),
  ('13b10000-0000-4000-8000-000000000002', 'Atlas 11D3b Inactive Fixture');

insert into public.factory_users(user_id, factory_id, is_active)
values
  ('13b00000-0000-4000-8000-000000000001', '13b10000-0000-4000-8000-000000000001', true),
  ('13b00000-0000-4000-8000-000000000002', '13b10000-0000-4000-8000-000000000002', false);

create temporary table atlas_11d3b_fixture_counts on commit drop as
select
  (select count(*) from public.factories) as factories_count,
  (select count(*) from public.factory_users) as memberships_count,
  (select count(*) from auth.users) as auth_users_count,
  (select count(*) from public.mud_accounting_states) as mud_states_count;

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '13b00000-0000-4000-8000-000000000001', true);
do $$
declare
  result record;
begin
  select * into result from public.resolve_factory_access();
  if result.status <> 'active'
    or result.factory_id <> '13b10000-0000-4000-8000-000000000001'::uuid then
    raise exception 'FAIL: active user result was status %, factory %', result.status, result.factory_id;
  end if;
  raise notice 'PASS [EXECUTED]: active user returns active plus the correct factory UUID';
end;
$$;
reset role;

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '13b00000-0000-4000-8000-000000000002', true);
do $$
declare
  result record;
begin
  select * into result from public.resolve_factory_access();
  if result.status <> 'inactive' or result.factory_id is not null then
    raise exception 'FAIL: inactive user result was status %, factory %', result.status, result.factory_id;
  end if;
  raise notice 'PASS [EXECUTED]: inactive user returns inactive without factory details';
end;
$$;
reset role;

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '13b00000-0000-4000-8000-000000000003', true);
do $$
declare
  result record;
begin
  select * into result from public.resolve_factory_access();
  if result.status <> 'none' or result.factory_id is not null then
    raise exception 'FAIL: no-membership user result was status %, factory %', result.status, result.factory_id;
  end if;
  raise notice 'PASS [EXECUTED]: user without membership returns none and NULL factory UUID';
end;
$$;
reset role;

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '', true);
do $$
begin
  perform public.resolve_factory_access();
  raise exception 'FAIL: unauthenticated resolver call unexpectedly succeeded' using errcode = 'P9999';
exception when others then
  if sqlstate = 'P9999' then raise; end if;
  if sqlstate <> 'P0001' or sqlerrm <> 'ATLAS_UNAUTHENTICATED' then
    raise exception 'FAIL: unauthenticated error was % (%)', sqlstate, sqlerrm;
  end if;
  raise notice 'PASS [EXECUTED]: unauthenticated call returns stable ATLAS_UNAUTHENTICATED';
end;
$$;
reset role;

set local role anon;
do $$
begin
  perform public.resolve_factory_access();
  raise exception 'FAIL: anon unexpectedly executed resolver' using errcode = 'P9999';
exception when others then
  if sqlstate = 'P9999' then raise; end if;
  if sqlstate <> '42501' then
    raise exception 'FAIL: anon expected SQLSTATE 42501, received % (%)', sqlstate, sqlerrm;
  end if;
  raise notice 'PASS [EXECUTED]: anon direct invocation is denied';
end;
$$;
reset role;

do $$
declare
  expected record;
  persistent record;
begin
  select * into expected from atlas_11d3b_fixture_counts;
  if (select count(*) from public.factories) <> expected.factories_count
    or (select count(*) from public.factory_users) <> expected.memberships_count
    or (select count(*) from auth.users) <> expected.auth_users_count
    or (select count(*) from public.mud_accounting_states) <> expected.mud_states_count then
    raise exception 'FAIL: resolver calls changed fixture row counts';
  end if;
  raise notice 'PASS [EXECUTED]: resolver calls performed no writes';

  select * into persistent from atlas_11d3b_persistent_baseline;
  if expected.factories_count <> persistent.factories_count + 2
    or expected.memberships_count <> persistent.memberships_count + 2
    or expected.auth_users_count <> persistent.auth_users_count + 3
    or expected.mud_states_count <> persistent.mud_states_count + 2 then
    raise exception 'FAIL: synthetic fixture counts differ from the exact rollback delta';
  end if;
  raise notice 'PASS [EXECUTED]: only the exact synthetic fixture delta exists before rollback';
end;
$$;

rollback;
