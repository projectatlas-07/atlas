-- Atlas Authentication 11C rollback-only verifier. Run only on confirmed Test Atlas Clean.

do $$
begin
  if (select count(*) from public.factories) <> 1
    or (select count(*) from public.factory_users) <> 1 then
    raise exception 'FAIL: expected persistent Test baseline of one factory and one membership';
  end if;
  raise notice 'PASS [EXECUTED]: persistent baseline is one factory and one membership';
end;
$$;

begin;

do $$
declare
  rpc_oid oid := pg_catalog.to_regprocedure('public.provision_first_factory(text)');
  rpc_definition text;
begin
  if rpc_oid is null then
    raise exception 'FAIL: provision_first_factory(text) is missing';
  end if;

  select pg_catalog.pg_get_functiondef(rpc_oid)
  into rpc_definition;

  if not exists (
    select 1
    from pg_catalog.pg_proc
    where oid = rpc_oid
      and prosecdef
      and proconfig @> array['search_path=pg_catalog, public']
  ) then
    raise exception 'FAIL: RPC is not SECURITY DEFINER with the fixed expected search_path';
  end if;

  if rpc_definition ~* '\m(commit|rollback)\M'
    or rpc_definition ~* '(dblink|postgres_fdw|autonomous)' then
    raise exception 'FAIL: RPC contains a transaction escape';
  end if;

  if rpc_definition not like '%auth.uid()%'
    or rpc_definition not like '%pg_advisory_xact_lock%'
    or rpc_definition not like '%email_confirmed_at is not null%'
    or rpc_definition not like '%insert into public.factories%'
    or rpc_definition not like '%insert into public.factory_users%' then
    raise exception 'FAIL: RPC definition is missing an identity, lock, confirmation, or atomic write requirement';
  end if;

  if pg_catalog.has_function_privilege('anon', rpc_oid, 'EXECUTE')
    or not pg_catalog.has_function_privilege('authenticated', rpc_oid, 'EXECUTE')
    or exists (
      select 1
      from pg_catalog.pg_proc as procedures
      cross join lateral pg_catalog.aclexplode(
        coalesce(
          procedures.proacl,
          pg_catalog.acldefault('f', procedures.proowner)
        )
      ) as privileges
      where procedures.oid = rpc_oid
        and privileges.grantee = 0
        and privileges.privilege_type = 'EXECUTE'
    ) then
    raise exception 'FAIL: RPC execute privileges are not authenticated-only';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_constraint as constraints
    join pg_catalog.pg_attribute as attributes
      on attributes.attrelid = constraints.conrelid
      and attributes.attnum = any(constraints.conkey)
    where constraints.conrelid = 'public.factories'::regclass
      and constraints.contype = 'u'
      and pg_catalog.cardinality(constraints.conkey) = 1
      and attributes.attname = 'name'
  ) then
    raise exception 'FAIL: factories.name still has a global unique constraint';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraints
    join pg_catalog.pg_attribute as attributes
      on attributes.attrelid = constraints.conrelid
      and attributes.attnum = any(constraints.conkey)
    where constraints.conrelid = 'public.factory_users'::regclass
      and constraints.contype = 'u'
      and pg_catalog.cardinality(constraints.conkey) = 1
      and attributes.attname = 'user_id'
  ) then
    raise exception 'FAIL: factory_users.user_id is not protected by a single-column UNIQUE constraint';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger as triggers
    where triggers.tgrelid = 'public.factories'::regclass
      and triggers.tgname = 'factories_initialize_mud_accounting_state'
      and triggers.tgfoid = 'public.initialize_mud_accounting_state()'::regprocedure
      and not triggers.tgisinternal
      and triggers.tgenabled <> 'D'
  ) then
    raise exception 'FAIL: factories Mud-state initialization trigger is missing or disabled';
  end if;

  raise notice 'PASS [EXECUTED]: definition, transaction boundary, catalog, trigger, and privilege assertions';
  raise notice 'PASS [BY-DESIGN]: per-user advisory lock serializes concurrent onboarding calls; factory_users.user_id UNIQUE is the database backstop';
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
  ('11000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'atlas-11c-a@example.invalid', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('11000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'atlas-11c-b@example.invalid', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('11000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'atlas-11c-invalid@example.invalid', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('11000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'atlas-11c-unconfirmed@example.invalid', null, '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('11000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'atlas-11c-inactive@example.invalid', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('11000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'atlas-11c-existing@example.invalid', null, '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('11000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'atlas-11c-failure@example.invalid', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.factories(id, name)
values
  ('12000000-0000-4000-8000-000000000005', 'Atlas 11C Inactive Fixture'),
  ('12000000-0000-4000-8000-000000000006', 'Atlas 11C Existing Fixture');

insert into public.factory_users(user_id, factory_id, is_active)
values
  ('11000000-0000-4000-8000-000000000005', '12000000-0000-4000-8000-000000000005', false),
  ('11000000-0000-4000-8000-000000000006', '12000000-0000-4000-8000-000000000006', true);

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '', true);
do $$
begin
  perform public.provision_first_factory('Unauthenticated Fixture');
  raise exception 'FAIL: authenticated role without auth.uid() unexpectedly succeeded' using errcode = 'P9999';
exception when others then
  if sqlstate = 'P9999' then raise; end if;
  if sqlstate <> 'P0001' or sqlerrm <> 'ATLAS_UNAUTHENTICATED' then
    raise exception 'FAIL: unauthenticated error was % (%)', sqlstate, sqlerrm;
  end if;
  raise notice 'PASS [EXECUTED]: stable ATLAS_UNAUTHENTICATED error';
end;
$$;
reset role;

set local role anon;
do $$
begin
  perform public.provision_first_factory('Anon Fixture');
  raise exception 'FAIL: anon unexpectedly executed provisioning RPC' using errcode = 'P9999';
exception when others then
  if sqlstate = 'P9999' then raise; end if;
  if sqlstate <> '42501' then
    raise exception 'FAIL: anon expected SQLSTATE 42501, received % (%)', sqlstate, sqlerrm;
  end if;
  raise notice 'PASS [EXECUTED]: anon direct invocation is denied';
end;
$$;
reset role;

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000004', true);
do $$
begin
  perform public.provision_first_factory('Unconfirmed Fixture');
  raise exception 'FAIL: unconfirmed user unexpectedly succeeded' using errcode = 'P9999';
exception when others then
  if sqlstate = 'P9999' then raise; end if;
  if sqlstate <> 'P0001' or sqlerrm <> 'ATLAS_EMAIL_NOT_CONFIRMED' then
    raise exception 'FAIL: unconfirmed error was % (%)', sqlstate, sqlerrm;
  end if;
  raise notice 'PASS [EXECUTED]: stable ATLAS_EMAIL_NOT_CONFIRMED error';
end;
$$;
reset role;

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000005', true);
do $$
begin
  perform public.provision_first_factory('Inactive Retry Fixture');
  raise exception 'FAIL: inactive membership unexpectedly succeeded' using errcode = 'P9999';
exception when others then
  if sqlstate = 'P9999' then raise; end if;
  if sqlstate <> 'P0001' or sqlerrm <> 'ATLAS_MEMBERSHIP_INACTIVE' then
    raise exception 'FAIL: inactive-membership error was % (%)', sqlstate, sqlerrm;
  end if;
  raise notice 'PASS [EXECUTED]: stable ATLAS_MEMBERSHIP_INACTIVE error';
end;
$$;
reset role;

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000006', true);
do $$
declare
  result record;
  count_before bigint := (select count(*) from public.factories);
begin
  select * into result from public.provision_first_factory('Ignored Existing Name');
  if result.factory_id <> '12000000-0000-4000-8000-000000000006'::uuid
    or result.created
    or (select count(*) from public.factories) <> count_before then
    raise exception 'FAIL: active existing membership was not returned idempotently';
  end if;
  raise notice 'PASS [EXECUTED]: active existing membership returns before confirmation check';
end;
$$;
reset role;

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000003', true);
do $$
declare
  test_name text;
begin
  foreach test_name in array array['   ', E'Control\nName', repeat('x', 201)] loop
    begin
      perform public.provision_first_factory(test_name);
      raise exception 'FAIL: invalid factory name unexpectedly succeeded' using errcode = 'P9999';
    exception when others then
      if sqlstate = 'P9999' then raise; end if;
      if sqlstate <> 'P0001' or sqlerrm <> 'ATLAS_INVALID_FACTORY_NAME' then
        raise exception 'FAIL: invalid-name error was % (%)', sqlstate, sqlerrm;
      end if;
    end;
  end loop;
  raise notice 'PASS [EXECUTED]: blank, control-character, and over-200-character names are rejected';
end;
$$;
reset role;

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000001', true);
do $$
declare
  result record;
  retry_result record;
  count_after_first bigint;
begin
  select * into result from public.provision_first_factory('  Shared   Atlas Factory  ');
  if not result.created then
    raise exception 'FAIL: first provisioning call did not report created=true';
  end if;

  perform pg_catalog.set_config('atlas11c.factory_a', result.factory_id::text, true);
  count_after_first := (select count(*) from public.factories);

  select * into retry_result from public.provision_first_factory('Shared Atlas Factory');
  if retry_result.factory_id <> result.factory_id or retry_result.created then
    raise exception 'FAIL: same-name retry was not idempotent';
  end if;

  select * into retry_result from public.provision_first_factory('Different Retry Name');
  if retry_result.factory_id <> result.factory_id
    or retry_result.created
    or (select count(*) from public.factories) <> count_after_first then
    raise exception 'FAIL: different-name retry created or returned another factory';
  end if;

  if (select name from public.factories where id = result.factory_id) <> 'Shared Atlas Factory'
    or not exists (
      select 1 from public.factory_users
      where user_id = '11000000-0000-4000-8000-000000000001'
        and factory_id = result.factory_id
        and is_active
    )
    or not exists (
      select 1 from public.mud_accounting_states
      where factory_id = result.factory_id
        and accounting_mode = 'LEGACY_WEEKLY'
    ) then
    raise exception 'FAIL: created factory, membership, normalized name, or required trigger initialization is wrong';
  end if;

  raise notice 'PASS [EXECUTED]: atomic creation, normalization, Mud-state initialization, and sequential retries';
end;
$$;
reset role;

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000002', true);
do $$
declare
  result record;
begin
  select * into result from public.provision_first_factory('Shared Atlas Factory');
  if not result.created
    or result.factory_id = pg_catalog.current_setting('atlas11c.factory_a')::uuid then
    raise exception 'FAIL: distinct confirmed users could not create distinct factories with the same name';
  end if;
  raise notice 'PASS [EXECUTED]: second user created a distinct same-name factory through the RPC';
end;
$$;
reset role;

do $$
begin
  if (select count(*) from public.factories where name = 'Shared Atlas Factory') <> 2 then
    raise exception 'FAIL: privileged fixture inspection did not find both same-name factories';
  end if;
  raise notice 'PASS [EXECUTED]: duplicate factory names exist across distinct isolated users';
end;
$$;

create or replace function pg_temp.fail_atlas11c_membership_insert()
returns trigger
language plpgsql
as $$
begin
  raise exception 'ATLAS_11C_FORCED_MEMBERSHIP_FAILURE' using errcode = 'P7777';
end;
$$;

create trigger atlas11c_force_membership_failure
before insert on public.factory_users
for each row
when (new.user_id = '11000000-0000-4000-8000-000000000007'::uuid)
execute function pg_temp.fail_atlas11c_membership_insert();

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000007', true);
do $$
begin
  perform public.provision_first_factory('Atlas 11C Forced Failure');
  raise exception 'FAIL: forced membership failure unexpectedly succeeded' using errcode = 'P9999';
exception when others then
  if sqlstate = 'P9999' then raise; end if;
  if sqlstate <> 'P7777' or sqlerrm <> 'ATLAS_11C_FORCED_MEMBERSHIP_FAILURE' then
    raise exception 'FAIL: forced failure was % (%)', sqlstate, sqlerrm;
  end if;
  raise notice 'PASS [EXECUTED]: forced post-factory membership failure surfaced';
end;
$$;
reset role;

do $$
begin
  if exists (
    select 1 from public.factories where name = 'Atlas 11C Forced Failure'
  ) or exists (
    select 1 from public.factory_users
    where user_id = '11000000-0000-4000-8000-000000000007'
  ) then
    raise exception 'FAIL: forced failure left a partial factory or membership';
  end if;
  raise notice 'PASS [EXECUTED]: forced failure is atomic with no partial usable factory state';
end;
$$;

rollback;

do $$
begin
  if (select count(*) from public.factories) <> 1
    or (select count(*) from public.factory_users) <> 1 then
    raise exception 'FAIL: rollback changed persistent Test factory or membership counts';
  end if;
  raise notice 'PASS [EXECUTED]: rollback restored persistent counts to one factory and one membership';
end;
$$;

select 'PASS: Atlas Authentication 11C provisioning verifier completed; every fixture was rolled back.' as result;
