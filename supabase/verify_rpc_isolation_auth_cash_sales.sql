-- Atlas Security 12B2A: rollback-only runtime RPC isolation proof.
-- Scope: Auth/Factory, Cash Book, and Sales on Test Atlas Clean only.

-- The hosted SQL endpoint wraps a submitted batch in a transaction. These
-- session-local temp tables are committed before the synthetic fixture
-- transaction so the post-ROLLBACK catalog/count comparison is real. No Atlas
-- data is written before the explicit fixture transaction begins.
create temporary table atlas_12b2a_rpc_manifest (
  module text not null,
  function_name text not null,
  identity_arguments text not null,
  operation_kind text not null check (operation_kind in ('READ', 'WRITE', 'MIXED')),
  has_factory_id_parameter boolean not null,
  tenant_child_parameters text not null,
  delegate_relationship text not null,
  definer_blocking_check text not null,
  primary key (function_name, identity_arguments)
) on commit preserve rows;

insert into atlas_12b2a_rpc_manifest values
  ('Auth / Factory', 'provision_first_factory', 'p_factory_name text', 'WRITE', false, 'none', 'direct implementation', 'auth.uid(); existing membership is returned or rejected; per-user advisory lock'),
  ('Auth / Factory', 'resolve_factory_access', '', 'READ', false, 'none', 'direct implementation', 'auth.uid()-only factory_users lookup; inactive returns no factory UUID'),
  ('Auth / Factory', 'update_factory_printable_profile', 'p_factory_id uuid, p_name text, p_business_description text, p_address text, p_mobile text', 'WRITE', true, 'none', 'legacy compatibility overload; direct implementation', 'auth.uid() active factory_users match on p_factory_id'),
  ('Auth / Factory', 'update_factory_printable_profile', 'p_factory_id uuid, p_name text, p_business_description text, p_village text, p_post_office text, p_police_station text, p_district text, p_state text, p_mobile text, p_gstin text', 'WRITE', true, 'none', 'current structured profile implementation', 'auth.uid() active factory_users match on p_factory_id'),

  ('Cash Book', 'initialize_cash_book', 'p_factory_id uuid, p_start_date date, p_opening_balance numeric', 'WRITE', true, 'none', 'direct implementation', 'auth.uid() active factory_users match on p_factory_id'),
  ('Cash Book', 'create_cash_book_manual_entry', 'p_factory_id uuid, p_entry_id uuid, p_business_date date, p_direction text, p_amount numeric, p_payment_mode text, p_party_details text, p_note text', 'WRITE', true, 'p_entry_id', 'direct implementation', 'membership first; initialization and request ID are factory-scoped'),
  ('Cash Book', 'void_cash_book_manual_entry', 'p_factory_id uuid, p_entry_id uuid', 'WRITE', true, 'p_entry_id', 'direct implementation', 'membership first; entry lookup constrains id plus factory_id'),
  ('Cash Book', 'get_cash_book_day_summary', 'p_factory_id uuid, p_business_date date', 'READ', true, 'none', 'direct implementation over private get_cash_book_source_movements', 'auth.uid() active factory_users match on p_factory_id'),
  ('Cash Book', 'list_cash_book_day_entries', 'p_factory_id uuid, p_business_date date', 'READ', true, 'none', 'direct implementation over private get_cash_book_source_movements', 'auth.uid() active factory_users match on p_factory_id'),

  ('Sales', 'create_brick_type', 'p_factory_id uuid, p_name text', 'WRITE', true, 'none', 'direct implementation', 'auth.uid() active factory_users match on p_factory_id'),
  ('Sales', 'rename_brick_type', 'p_factory_id uuid, p_brick_type_id uuid, p_name text', 'WRITE', true, 'p_brick_type_id', 'direct implementation', 'membership first; brick lookup constrains id plus factory_id'),
  ('Sales', 'set_brick_type_active', 'p_factory_id uuid, p_brick_type_id uuid, p_is_active boolean', 'WRITE', true, 'p_brick_type_id', 'direct implementation', 'membership first; brick lookup constrains id plus factory_id'),
  ('Sales', 'delete_unused_brick_type', 'p_factory_id uuid, p_brick_type_id uuid', 'WRITE', true, 'p_brick_type_id', 'direct implementation', 'membership first; locked brick lookup constrains id plus factory_id'),
  ('Sales', 'create_customer', 'p_factory_id uuid, p_name text, p_address text, p_mobile text', 'WRITE', true, 'none', 'direct implementation', 'auth.uid() active factory_users match on p_factory_id'),
  ('Sales', 'update_customer', 'p_factory_id uuid, p_customer_id uuid, p_name text, p_address text, p_mobile text', 'WRITE', true, 'p_customer_id', 'direct implementation', 'membership first; customer lookup constrains id plus factory_id'),
  ('Sales', 'find_or_create_vehicle', 'p_factory_id uuid, p_vehicle_number text, p_delivery_wage_tracking_enabled boolean', 'WRITE', true, 'none', 'direct implementation', 'auth.uid() active factory_users match on p_factory_id'),
  ('Sales', 'set_vehicle_delivery_wage_tracking', 'p_factory_id uuid, p_vehicle_id uuid, p_enabled boolean', 'WRITE', true, 'p_vehicle_id', 'direct implementation', 'membership first; vehicle lookup constrains id plus factory_id'),
  ('Sales', 'archive_vehicle', 'p_factory_id uuid, p_vehicle_id uuid', 'WRITE', true, 'p_vehicle_id', 'direct implementation', 'membership first; vehicle lookup constrains id plus factory_id'),
  ('Sales', 'restore_vehicle', 'p_factory_id uuid, p_vehicle_id uuid', 'WRITE', true, 'p_vehicle_id', 'direct implementation', 'membership first; vehicle lookup constrains id plus factory_id'),
  ('Sales', 'create_challan', 'p_factory_id uuid, p_challan_number text, p_challan_date date, p_customer_id uuid, p_vehicle_id uuid, p_trip_labour_wage numeric, p_items jsonb, p_flexible_lines jsonb', 'WRITE', true, 'p_customer_id, p_vehicle_id, item brick_type_id values', 'authenticated wrapper delegates to private create_challan_with_vehicle_snapshot', 'delegate checks membership; customer/vehicle/brick lookups constrain factory_id'),
  ('Sales', 'create_challan_with_received_payment', 'p_factory_id uuid, p_challan_number text, p_challan_date date, p_customer_id uuid, p_vehicle_id uuid, p_trip_labour_wage numeric, p_items jsonb, p_flexible_lines jsonb, p_payment_date date, p_payment_amount numeric, p_payment_mode text', 'WRITE', true, 'p_customer_id, p_vehicle_id, item brick_type_id values', 'delegates to authenticated create_challan and create_customer_payment implementations', 'outer membership check plus checked delegates'),
  ('Sales', 'update_challan', 'p_factory_id uuid, p_challan_id uuid, p_challan_number text, p_challan_date date, p_customer_id uuid, p_vehicle_id uuid, p_trip_labour_wage numeric, p_items jsonb, p_flexible_lines jsonb', 'WRITE', true, 'p_challan_id, p_customer_id, p_vehicle_id, item brick_type_id values', 'authenticated wrapper delegates to private update_challan_with_vehicle_snapshot', 'delegate checks membership; header/customer/vehicle/brick lookups constrain factory_id'),
  ('Sales', 'void_challan', 'p_factory_id uuid, p_challan_id uuid', 'WRITE', true, 'p_challan_id', 'direct implementation', 'membership first; locked challan lookup constrains id plus factory_id'),
  ('Sales', 'create_customer_payment', 'p_factory_id uuid, p_customer_id uuid, p_payment_date date, p_amount numeric, p_payment_mode text, p_note text, p_allocations jsonb', 'WRITE', true, 'p_customer_id, allocation challan_id values', 'compatibility wrapper delegates to create_customer_payment_with_methods', 'delegate checks membership; customer/challan lookups constrain factory_id'),
  ('Sales', 'create_customer_payment_with_methods', 'p_factory_id uuid, p_customer_id uuid, p_payment_date date, p_amount numeric, p_payment_methods jsonb, p_note text, p_allocations jsonb', 'WRITE', true, 'p_customer_id, allocation challan_id values', 'current multi-method implementation', 'membership first; customer/challan lookups constrain factory_id'),
  ('Sales', 'get_challan_payment_state', 'p_factory_id uuid, p_challan_id uuid', 'READ', true, 'p_challan_id', 'direct implementation', 'membership first; challan and allocations constrained by factory_id'),
  ('Sales', 'get_customer_sales_summary', 'p_factory_id uuid, p_customer_id uuid', 'READ', true, 'p_customer_id', 'direct implementation', 'membership first; customer/challan/allocation lookups constrained by factory_id');

create temporary table atlas_12b2a_persistent_counts (
  schema_name text not null,
  table_name text not null,
  row_count bigint not null,
  primary key (schema_name, table_name)
) on commit preserve rows;

do $$
declare
  target record;
  persistent_count bigint;
begin
  if (select count(*) from atlas_12b2a_rpc_manifest) <> 27 then
    raise exception 'FAIL: expected 27 scoped RPC signatures in manifest';
  end if;
  if (select count(*) from atlas_12b2a_rpc_manifest where module = 'Auth / Factory') <> 4
    or (select count(*) from atlas_12b2a_rpc_manifest where module = 'Cash Book') <> 5
    or (select count(*) from atlas_12b2a_rpc_manifest where module = 'Sales') <> 18 then
    raise exception 'FAIL: scoped module counts changed';
  end if;

  for target in
    select 'public'::text as schema_name, c.relname::text as table_name
    from pg_catalog.pg_class as c
    join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
    union all
    select 'auth', 'users'
    order by 1, 2
  loop
    execute pg_catalog.format(
      'select count(*) from %I.%I', target.schema_name, target.table_name
    ) into persistent_count;
    insert into atlas_12b2a_persistent_counts values (
      target.schema_name, target.table_name, persistent_count
    );
  end loop;

  if (select count(*) from atlas_12b2a_persistent_counts where schema_name = 'public') <> 63
    or (select count(*) from atlas_12b2a_persistent_counts) <> 64 then
    raise exception 'FAIL: expected 63 public table counts plus auth.users';
  end if;
end;
$$;

commit;
begin;

create temporary table atlas_12b2a_ids (
  key text primary key,
  id uuid not null
) on commit drop;
grant select, insert, update, delete on atlas_12b2a_ids to authenticated;

create function pg_temp.assert_identity(expected_user uuid, assertion_label text)
returns void
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if current_user <> 'authenticated' or auth.uid() is distinct from expected_user then
    raise exception 'FAIL: % role/JWT mismatch (role %, uid %)',
      assertion_label, current_user, auth.uid();
  end if;
end;
$$;

create function pg_temp.fixture_id(fixture_key text)
returns uuid
language sql
stable
set search_path = pg_catalog, public
as $$
  select ids.id from pg_temp.atlas_12b2a_ids as ids where ids.key = fixture_key;
$$;

create function pg_temp.scoped_state_hash(target_factory_id uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select pg_catalog.md5(pg_catalog.jsonb_build_object(
    'factories', (select coalesce(jsonb_agg(to_jsonb(rows) order by rows.id), '[]'::jsonb) from public.factories rows where rows.id = target_factory_id),
    'factory_users', (select coalesce(jsonb_agg(to_jsonb(rows) order by rows.user_id), '[]'::jsonb) from public.factory_users rows where rows.factory_id = target_factory_id),
    'mud_accounting_states', (select coalesce(jsonb_agg(to_jsonb(rows) order by rows.factory_id), '[]'::jsonb) from public.mud_accounting_states rows where rows.factory_id = target_factory_id),
    'cash_book_initializations', (select coalesce(jsonb_agg(to_jsonb(rows) order by rows.factory_id), '[]'::jsonb) from public.cash_book_initializations rows where rows.factory_id = target_factory_id),
    'cash_book_manual_entries', (select coalesce(jsonb_agg(to_jsonb(rows) order by rows.id), '[]'::jsonb) from public.cash_book_manual_entries rows where rows.factory_id = target_factory_id),
    'brick_types', (select coalesce(jsonb_agg(to_jsonb(rows) order by rows.id), '[]'::jsonb) from public.brick_types rows where rows.factory_id = target_factory_id),
    'customers', (select coalesce(jsonb_agg(to_jsonb(rows) order by rows.id), '[]'::jsonb) from public.customers rows where rows.factory_id = target_factory_id),
    'vehicles', (select coalesce(jsonb_agg(to_jsonb(rows) order by rows.id), '[]'::jsonb) from public.vehicles rows where rows.factory_id = target_factory_id),
    'challans', (select coalesce(jsonb_agg(to_jsonb(rows) order by rows.id), '[]'::jsonb) from public.challans rows where rows.factory_id = target_factory_id),
    'challan_items', (select coalesce(jsonb_agg(to_jsonb(rows) order by rows.id), '[]'::jsonb) from public.challan_items rows where rows.factory_id = target_factory_id),
    'challan_flexible_lines', (select coalesce(jsonb_agg(to_jsonb(rows) order by rows.id), '[]'::jsonb) from public.challan_flexible_lines rows where rows.factory_id = target_factory_id),
    'customer_payments', (select coalesce(jsonb_agg(to_jsonb(rows) order by rows.id), '[]'::jsonb) from public.customer_payments rows where rows.factory_id = target_factory_id),
    'customer_payment_methods', (select coalesce(jsonb_agg(to_jsonb(rows) order by rows.payment_id, rows.mode), '[]'::jsonb) from public.customer_payment_methods rows where rows.factory_id = target_factory_id),
    'customer_payment_allocations', (select coalesce(jsonb_agg(to_jsonb(rows) order by rows.id), '[]'::jsonb) from public.customer_payment_allocations rows where rows.factory_id = target_factory_id)
  )::text);
$$;

create function pg_temp.expect_isolated_write(
  assertion_label text,
  statement_to_run text,
  expected_state text,
  expected_message_pattern text
)
returns void
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  user_a constant uuid := '12c00000-0000-4000-8000-000000000001';
  factory_a uuid := pg_temp.fixture_id('factory_a');
  factory_b uuid := pg_temp.fixture_id('factory_b');
  before_a text;
  before_b text;
  after_a text;
  after_b text;
  got_state text;
  got_message text;
  succeeded boolean := false;
begin
  if current_user in ('authenticated', 'anon') or auth.uid() is not null then
    raise exception 'FAIL: % snapshot did not start with privileged identity cleared', assertion_label;
  end if;

  before_a := pg_temp.scoped_state_hash(factory_a);
  before_b := pg_temp.scoped_state_hash(factory_b);

  execute 'set local role authenticated';
  perform pg_catalog.set_config('request.jwt.claim.sub', user_a::text, true);
  perform pg_temp.assert_identity(user_a, assertion_label);
  begin
    execute statement_to_run;
    succeeded := true;
  exception when others then
    got_state := sqlstate;
    got_message := sqlerrm;
  end;

  execute 'reset role';
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);

  if succeeded then
    raise exception 'FAIL: % unexpectedly succeeded', assertion_label;
  end if;
  if got_state <> expected_state
    or (expected_message_pattern is not null and got_message !~ expected_message_pattern) then
    raise exception 'FAIL: % rejected through incidental path: SQLSTATE %, class %',
      assertion_label, got_state, got_message;
  end if;

  after_a := pg_temp.scoped_state_hash(factory_a);
  after_b := pg_temp.scoped_state_hash(factory_b);
  if before_a is distinct from after_a or before_b is distinct from after_b then
    raise exception 'FAIL: % changed synthetic tenant state despite rejection', assertion_label;
  end if;

  raise notice 'PASS [EXECUTED] [ISOLATION-PROVEN] [%/%]: %; Factory A and B hashes unchanged',
    expected_state, expected_message_pattern, assertion_label;
end;
$$;

create function pg_temp.expect_user_a_error(
  assertion_label text,
  statement_to_run text,
  expected_state text,
  expected_message_pattern text
)
returns void
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  user_a constant uuid := '12c00000-0000-4000-8000-000000000001';
  got_state text;
  got_message text;
  succeeded boolean := false;
begin
  if current_user in ('authenticated', 'anon') or auth.uid() is not null then
    raise exception 'FAIL: % did not start with privileged identity cleared', assertion_label;
  end if;
  execute 'set local role authenticated';
  perform pg_catalog.set_config('request.jwt.claim.sub', user_a::text, true);
  perform pg_temp.assert_identity(user_a, assertion_label);
  begin
    execute statement_to_run;
    succeeded := true;
  exception when others then
    got_state := sqlstate;
    got_message := sqlerrm;
  end;
  execute 'reset role';
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  if succeeded then raise exception 'FAIL: % unexpectedly succeeded', assertion_label; end if;
  if got_state <> expected_state
    or (expected_message_pattern is not null and got_message !~ expected_message_pattern) then
    raise exception 'FAIL: % rejected through incidental path: SQLSTATE %, class %',
      assertion_label, got_state, got_message;
  end if;
  raise notice 'PASS [EXECUTED] [ISOLATION-PROVEN] [%/%]: %',
    expected_state, expected_message_pattern, assertion_label;
end;
$$;

-- Live catalog contract for all 27 scoped callable signatures.
do $$
declare
  actual_count integer;
begin
  select count(*) into actual_count
  from pg_catalog.pg_proc as procedures
  join pg_catalog.pg_namespace as namespaces on namespaces.oid = procedures.pronamespace
  join atlas_12b2a_rpc_manifest as manifest
    on manifest.function_name = procedures.proname
    and manifest.identity_arguments = pg_catalog.pg_get_function_identity_arguments(procedures.oid)
  where namespaces.nspname = 'public'
    and procedures.prokind = 'f';

  if actual_count <> 27 then
    raise exception 'FAIL: only % of 27 scoped live signatures matched the manifest', actual_count;
  end if;

  if exists (
    select 1
    from atlas_12b2a_rpc_manifest as manifest
    join pg_catalog.pg_proc as procedures
      on procedures.proname = manifest.function_name
      and pg_catalog.pg_get_function_identity_arguments(procedures.oid) = manifest.identity_arguments
    join pg_catalog.pg_namespace as namespaces on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'public'
      and (
        not procedures.prosecdef
        or not pg_catalog.has_function_privilege('authenticated', procedures.oid, 'EXECUTE')
        or pg_catalog.has_function_privilege('anon', procedures.oid, 'EXECUTE')
        or not (procedures.proconfig @> array['search_path=pg_catalog, public'])
        or exists (
          select 1
          from pg_catalog.aclexplode(
            coalesce(procedures.proacl, pg_catalog.acldefault('f', procedures.proowner))
          ) as grants
          where grants.grantee = 0 and grants.privilege_type = 'EXECUTE'
        )
      )
  ) then
    raise exception 'FAIL: a scoped function is not fixed-search-path SECURITY DEFINER with authenticated-only EXECUTE';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_proc as procedures
    join pg_catalog.pg_namespace as namespaces on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'public'
      and procedures.prokind = 'f'
      and procedures.prorettype <> 'pg_catalog.trigger'::pg_catalog.regtype
      and procedures.proname in (select function_name from atlas_12b2a_rpc_manifest)
      and pg_catalog.has_function_privilege('authenticated', procedures.oid, 'EXECUTE')
  ) <> 27 then
    raise exception 'FAIL: live scoped-name inventory contains an unmanifested overload';
  end if;

  raise notice 'PASS [EXECUTED]: live catalog inventory 27/27; 27 SECURITY DEFINER, 0 invoker, 5 READ, 22 WRITE; anon/PUBLIC exposure 0';
end;
$$;

-- Only synthetic confirmed Auth roots require privileged setup; no client RPC
-- exists for constructing arbitrary confirmed verifier identities.
reset role;
select pg_catalog.set_config('request.jwt.claim.sub', '', true);

-- Auth/factory calls without a caller-supplied factory ID cannot be aimed at B.
-- User A's provisioning retry and resolver must remain bound to User A.
create function pg_temp.test_auth_factory_cross_suite()
returns void
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  factory_a uuid := pg_temp.fixture_id('factory_a');
  factory_b uuid := pg_temp.fixture_id('factory_b');
  before_b text := pg_temp.scoped_state_hash(factory_b);
  after_b text;
  provision_result record;
  access_result record;
begin
  execute 'set local role authenticated';
  perform pg_catalog.set_config('request.jwt.claim.sub', pg_temp.fixture_id('user_a')::text, true);
  perform pg_temp.assert_identity(pg_temp.fixture_id('user_a'), 'auth.uid-only factory RPC attacks');

  select * into provision_result from public.provision_first_factory('Cannot Target Factory B');
  if provision_result.factory_id <> factory_a or provision_result.created then
    raise exception 'FAIL: provisioning retry escaped User A existing membership';
  end if;
  select * into access_result from public.resolve_factory_access();
  if access_result.status <> 'active' or access_result.factory_id <> factory_a then
    raise exception 'FAIL: access resolver returned another tenant';
  end if;

  execute 'reset role';
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  after_b := pg_temp.scoped_state_hash(factory_b);
  if before_b is distinct from after_b then
    raise exception 'FAIL: auth.uid-only factory calls changed Factory B';
  end if;
  raise notice 'PASS [EXECUTED] [ISOLATION-PROVEN]: provisioning/resolver are auth.uid-bound; Factory B unchanged';
end;
$$;

-- Every factory-addressable write: valid Factory B target, User A caller,
-- stable membership rejection, plus exact A/B state hashes before and after.
create function pg_temp.test_cross_factory_write_suite()
returns void
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  factory_a uuid := pg_temp.fixture_id('factory_a');
  factory_b uuid := pg_temp.fixture_id('factory_b');
  brick_a uuid := pg_temp.fixture_id('brick_a');
  brick_b uuid := pg_temp.fixture_id('brick_b');
  brick_unused_b uuid := pg_temp.fixture_id('brick_unused_b');
  customer_a uuid := pg_temp.fixture_id('customer_a');
  customer_b uuid := pg_temp.fixture_id('customer_b');
  vehicle_a uuid := pg_temp.fixture_id('vehicle_a');
  vehicle_b uuid := pg_temp.fixture_id('vehicle_b');
  vehicle_archived_b uuid := pg_temp.fixture_id('vehicle_archived_b');
  challan_a uuid := pg_temp.fixture_id('challan_a');
  challan_b uuid := pg_temp.fixture_id('challan_b');
  cash_entry_b uuid := pg_temp.fixture_id('cash_entry_b');
  membership_message constant text := 'You do not have access to this factory\.';
  b_items jsonb := jsonb_build_array(jsonb_build_object(
    'brick_type_id', brick_b, 'quantity', 1000, 'rate', 100
  ));
begin
  perform pg_temp.expect_isolated_write(
    'legacy printable-profile overload against Factory B',
    format('select public.update_factory_printable_profile(%L::uuid,%L,%L,%L,%L)',
      factory_b, 'Forbidden B', 'Forbidden B', 'Forbidden B', '9000000099'),
    '42501', membership_message
  );
  perform pg_temp.expect_isolated_write(
    'structured printable-profile overload against Factory B',
    format('select public.update_factory_printable_profile(%L::uuid,%L,%L,%L,%L,%L,%L,%L,%L,%L)',
      factory_b, 'Forbidden B', 'Forbidden B', 'Village', 'Post', 'Station',
      'District', 'State', '9000000099', null),
    '42501', membership_message
  );

  perform pg_temp.expect_isolated_write(
    'initialize_cash_book against Factory B',
    format('select public.initialize_cash_book(%L::uuid,%L::date,100)', factory_b, '2026-01-01'),
    '42501', membership_message
  );
  perform pg_temp.expect_isolated_write(
    'create_cash_book_manual_entry against Factory B',
    format('select public.create_cash_book_manual_entry(%L::uuid,%L::uuid,%L::date,%L,1,%L,%L,%L)',
      factory_b, '12c30000-0000-4000-8000-000000000099', '2026-01-02',
      'in', 'cash', 'Forbidden B party', 'Forbidden B entry'),
    '42501', membership_message
  );
  perform pg_temp.expect_isolated_write(
    'void_cash_book_manual_entry against Factory B',
    format('select public.void_cash_book_manual_entry(%L::uuid,%L::uuid)', factory_b, cash_entry_b),
    '42501', membership_message
  );

  perform pg_temp.expect_isolated_write(
    'create_brick_type against Factory B',
    format('select public.create_brick_type(%L::uuid,%L)', factory_b, 'Forbidden B Brick'),
    '42501', membership_message
  );
  perform pg_temp.expect_isolated_write(
    'rename_brick_type against Factory B',
    format('select public.rename_brick_type(%L::uuid,%L::uuid,%L)', factory_b, brick_b, 'Forbidden Rename'),
    '42501', membership_message
  );
  perform pg_temp.expect_isolated_write(
    'set_brick_type_active against Factory B',
    format('select public.set_brick_type_active(%L::uuid,%L::uuid,false)', factory_b, brick_b),
    '42501', membership_message
  );
  perform pg_temp.expect_isolated_write(
    'delete_unused_brick_type against Factory B',
    format('select public.delete_unused_brick_type(%L::uuid,%L::uuid)', factory_b, brick_unused_b),
    '42501', membership_message
  );

  perform pg_temp.expect_isolated_write(
    'create_customer against Factory B',
    format('select public.create_customer(%L::uuid,%L,%L,%L)',
      factory_b, 'Forbidden B Customer', 'Forbidden B Address', '9000000099'),
    '42501', membership_message
  );
  perform pg_temp.expect_isolated_write(
    'update_customer against Factory B',
    format('select public.update_customer(%L::uuid,%L::uuid,%L,%L,%L)',
      factory_b, customer_b, 'Forbidden B Customer', 'Forbidden B Address', '9000000099'),
    '42501', membership_message
  );

  perform pg_temp.expect_isolated_write(
    'find_or_create_vehicle against Factory B',
    format('select public.find_or_create_vehicle(%L::uuid,%L,false)', factory_b, 'AT12B099'),
    '42501', membership_message
  );
  perform pg_temp.expect_isolated_write(
    'set_vehicle_delivery_wage_tracking against Factory B',
    format('select public.set_vehicle_delivery_wage_tracking(%L::uuid,%L::uuid,true)', factory_b, vehicle_b),
    '42501', membership_message
  );
  perform pg_temp.expect_isolated_write(
    'archive_vehicle against Factory B',
    format('select public.archive_vehicle(%L::uuid,%L::uuid)', factory_b, vehicle_b),
    '42501', membership_message
  );
  perform pg_temp.expect_isolated_write(
    'restore_vehicle against Factory B',
    format('select public.restore_vehicle(%L::uuid,%L::uuid)', factory_b, vehicle_archived_b),
    '42501', membership_message
  );

  perform pg_temp.expect_isolated_write(
    'create_challan wrapper against Factory B',
    format('select public.create_challan(%L::uuid,%L,%L::date,%L::uuid,%L::uuid,0,%L::jsonb,%L::jsonb)',
      factory_b, 'B-FORBIDDEN', '2026-01-10', customer_b, vehicle_b, b_items::text, '[]'),
    '42501', membership_message
  );
  perform pg_temp.expect_isolated_write(
    'create_challan_with_received_payment wrapper against Factory B',
    format('select public.create_challan_with_received_payment(%L::uuid,%L,%L::date,%L::uuid,%L::uuid,0,%L::jsonb,%L::jsonb,%L::date,10,%L)',
      factory_b, 'B-FORBIDDEN-PAID', '2026-01-10', customer_b, vehicle_b,
      b_items::text, '[]', '2026-01-10', 'cash'),
    '42501', membership_message
  );
  perform pg_temp.expect_isolated_write(
    'update_challan wrapper against Factory B',
    format('select public.update_challan(%L::uuid,%L::uuid,%L,%L::date,%L::uuid,%L::uuid,0,%L::jsonb,%L::jsonb)',
      factory_b, challan_b, 'B-FORBIDDEN-U', '2026-01-10', customer_b, vehicle_b,
      b_items::text, '[]'),
    '42501', membership_message
  );
  perform pg_temp.expect_isolated_write(
    'void_challan against Factory B',
    format('select public.void_challan(%L::uuid,%L::uuid)', factory_b, challan_b),
    '42501', membership_message
  );

  perform pg_temp.expect_isolated_write(
    'create_customer_payment compatibility wrapper against Factory B',
    format('select public.create_customer_payment(%L::uuid,%L::uuid,%L::date,10,%L,%L,%L::jsonb)',
      factory_b, customer_b, '2026-01-10', 'cash', 'Forbidden B payment',
      jsonb_build_array(jsonb_build_object('challan_id', challan_b, 'amount', 10))::text),
    '42501', membership_message
  );
  perform pg_temp.expect_isolated_write(
    'create_customer_payment_with_methods against Factory B',
    format('select public.create_customer_payment_with_methods(%L::uuid,%L::uuid,%L::date,10,%L::jsonb,%L,%L::jsonb)',
      factory_b, customer_b, '2026-01-10',
      jsonb_build_array(jsonb_build_object('mode', 'cash', 'amount', 10))::text,
      'Forbidden B multi payment',
      jsonb_build_array(jsonb_build_object('challan_id', challan_b, 'amount', 10))::text),
    '42501', membership_message
  );

  -- Keep declared variables referenced so accidental fixture omissions fail at compile/runtime.
  if factory_a is null or brick_a is null or customer_a is null or vehicle_a is null or challan_a is null then
    raise exception 'FAIL: Factory A control fixture ID missing';
  end if;
end;
$$;

-- Scoped reads: valid A positive controls ran above; direct B access is rejected
-- by the active membership check before any B result can be produced.
create function pg_temp.test_cross_factory_read_suite()
returns void
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  factory_b uuid := pg_temp.fixture_id('factory_b');
  customer_b uuid := pg_temp.fixture_id('customer_b');
  challan_b uuid := pg_temp.fixture_id('challan_b');
  membership_message constant text := 'You do not have access to this factory\.';
begin
  perform pg_temp.expect_user_a_error(
    'get_cash_book_day_summary against Factory B',
    format('select * from public.get_cash_book_day_summary(%L::uuid,%L::date)', factory_b, '2026-01-10'),
    '42501', membership_message
  );
  perform pg_temp.expect_user_a_error(
    'list_cash_book_day_entries against Factory B',
    format('select * from public.list_cash_book_day_entries(%L::uuid,%L::date)', factory_b, '2026-01-10'),
    '42501', membership_message
  );
  perform pg_temp.expect_user_a_error(
    'get_challan_payment_state against Factory B',
    format('select * from public.get_challan_payment_state(%L::uuid,%L::uuid)', factory_b, challan_b),
    '42501', membership_message
  );
  perform pg_temp.expect_user_a_error(
    'get_customer_sales_summary against Factory B',
    format('select * from public.get_customer_sales_summary(%L::uuid,%L::uuid)', factory_b, customer_b),
    '42501', membership_message
  );
end;
$$;
insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('12c00000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'atlas-12b2a-a@example.invalid', now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('12c00000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'atlas-12b2a-b@example.invalid', now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into atlas_12b2a_ids values
  ('user_a', '12c00000-0000-4000-8000-000000000001'),
  ('user_b', '12c00000-0000-4000-8000-000000000002');

-- Factories and memberships are created through the real onboarding writer.
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '12c00000-0000-4000-8000-000000000001', true);
select pg_temp.assert_identity('12c00000-0000-4000-8000-000000000001', 'provision Factory A');
do $$
declare result record;
begin
  select * into result from public.provision_first_factory('Atlas 12B2A Factory A');
  if not result.created then raise exception 'FAIL: Factory A was not provisioned'; end if;
  insert into pg_temp.atlas_12b2a_ids values ('factory_a', result.factory_id);
end;
$$;
reset role;
select pg_catalog.set_config('request.jwt.claim.sub', '', true);

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '12c00000-0000-4000-8000-000000000002', true);
select pg_temp.assert_identity('12c00000-0000-4000-8000-000000000002', 'provision Factory B');
do $$
declare result record;
begin
  select * into result from public.provision_first_factory('Atlas 12B2A Factory B');
  if not result.created then raise exception 'FAIL: Factory B was not provisioned'; end if;
  insert into pg_temp.atlas_12b2a_ids values ('factory_b', result.factory_id);
end;
$$;
reset role;
select pg_catalog.set_config('request.jwt.claim.sub', '', true);

do $$
begin
  if not exists (
    select 1 from public.factory_users
    where user_id = pg_temp.fixture_id('user_a')
      and factory_id = pg_temp.fixture_id('factory_a') and is_active
  ) or not exists (
    select 1 from public.factory_users
    where user_id = pg_temp.fixture_id('user_b')
      and factory_id = pg_temp.fixture_id('factory_b') and is_active
  ) then
    raise exception 'FAIL: real provisioning did not create both active memberships';
  end if;
  if (select count(*) from public.mud_accounting_states where factory_id in (
    pg_temp.fixture_id('factory_a'), pg_temp.fixture_id('factory_b')
  )) <> 2 then
    raise exception 'FAIL: factory initialization trigger did not create both Mud states';
  end if;
  raise notice 'PASS [REAL-WRITER-RPC/TRIGGER-GENERATED]: two factories, two memberships, two Mud states';
end;
$$;

-- Factory B fixture graph, entirely through real authenticated writer RPCs.
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '12c00000-0000-4000-8000-000000000002', true);
select pg_temp.assert_identity('12c00000-0000-4000-8000-000000000002', 'Factory B writer fixtures');
do $$
declare
  factory_b uuid := pg_temp.fixture_id('factory_b');
  brick_primary uuid;
  brick_unused uuid;
  customer_id uuid;
  vehicle_active uuid;
  vehicle_archived uuid;
  challan_id uuid;
begin
  perform public.update_factory_printable_profile(
    factory_b, 'Atlas 12B2A Factory B', 'Verifier brick factory',
    'Village B', 'Post B', 'Station B', 'District B', 'State B', '9000000002', null
  );
  perform public.initialize_cash_book(factory_b, '2026-01-01', 100);
  perform public.create_cash_book_manual_entry(
    factory_b, '12c30000-0000-4000-8000-000000000002', '2026-01-02',
    'in', 10, 'cash', 'Factory B party', 'Factory B cash fixture'
  );
  insert into pg_temp.atlas_12b2a_ids values
    ('cash_entry_b', '12c30000-0000-4000-8000-000000000002');

  select (public.create_brick_type(factory_b, 'B Primary Brick')).id into brick_primary;
  select (public.create_brick_type(factory_b, 'B Unused Brick')).id into brick_unused;
  insert into pg_temp.atlas_12b2a_ids values
    ('brick_b', brick_primary), ('brick_unused_b', brick_unused);

  select (public.create_customer(factory_b, 'Customer B', 'Address B', '9111111112')).id
  into customer_id;
  insert into pg_temp.atlas_12b2a_ids values ('customer_b', customer_id);

  select (public.find_or_create_vehicle(factory_b, 'AT12B001', false)).id
  into vehicle_active;
  select (public.find_or_create_vehicle(factory_b, 'AT12B002', false)).id
  into vehicle_archived;
  perform public.archive_vehicle(factory_b, vehicle_archived);
  insert into pg_temp.atlas_12b2a_ids values
    ('vehicle_b', vehicle_active), ('vehicle_archived_b', vehicle_archived);

  select (public.create_challan(
    factory_b, 'B-MAIN', '2026-01-10', customer_id, vehicle_active, 0,
    jsonb_build_array(jsonb_build_object(
      'brick_type_id', brick_primary, 'quantity', 1000, 'rate', 100
    )),
    '[]'::jsonb
  )).id into challan_id;
  insert into pg_temp.atlas_12b2a_ids values ('challan_b', challan_id);
end;
$$;
reset role;
select pg_catalog.set_config('request.jwt.claim.sub', '', true);

-- Factory A positive controls. Every scoped write and read entry point is
-- invoked here with valid owning-tenant data.
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '12c00000-0000-4000-8000-000000000001', true);
select pg_temp.assert_identity('12c00000-0000-4000-8000-000000000001', 'Factory A positive controls');
do $$
declare
  factory_a uuid := pg_temp.fixture_id('factory_a');
  access_result record;
  provision_result record;
  brick_primary uuid;
  brick_unused uuid;
  customer_id uuid;
  vehicle_id uuid;
  challan_main uuid;
  challan_void uuid;
  challan_payment_legacy uuid;
  challan_payment_multi uuid;
  challan_paid_now uuid;
  read_count integer;
begin
  select * into access_result from public.resolve_factory_access();
  if access_result.status <> 'active' or access_result.factory_id <> factory_a then
    raise exception 'FAIL: resolve_factory_access positive control';
  end if;
  select * into provision_result from public.provision_first_factory('Ignored Retry Name');
  if provision_result.factory_id <> factory_a or provision_result.created then
    raise exception 'FAIL: provision_first_factory idempotent positive control';
  end if;

  perform public.update_factory_printable_profile(
    factory_a, 'Atlas 12B2A Factory A', 'Legacy profile verifier',
    'Legacy Address A', '9000000001'
  );
  perform public.update_factory_printable_profile(
    factory_a, 'Atlas 12B2A Factory A', 'Verifier brick factory',
    'Village A', 'Post A', 'Station A', 'District A', 'State A', '9000000001', '22AAAAA0000A1Z5'
  );

  perform public.initialize_cash_book(factory_a, '2026-01-01', 100);
  perform public.create_cash_book_manual_entry(
    factory_a, '12c30000-0000-4000-8000-000000000001', '2026-01-02',
    'in', 10, 'cash', 'Factory A party', 'Factory A cash fixture'
  );
  perform public.create_cash_book_manual_entry(
    factory_a, '12c30000-0000-4000-8000-000000000003', '2026-01-03',
    'out', 1, 'upi', 'Factory A void party', 'Factory A void fixture'
  );
  perform public.void_cash_book_manual_entry(
    factory_a, '12c30000-0000-4000-8000-000000000003'
  );
  insert into pg_temp.atlas_12b2a_ids values
    ('cash_entry_a', '12c30000-0000-4000-8000-000000000001');

  select (public.create_brick_type(factory_a, 'A Primary Brick')).id into brick_primary;
  perform public.rename_brick_type(factory_a, brick_primary, 'A Primary Brick Renamed');
  perform public.set_brick_type_active(factory_a, brick_primary, false);
  perform public.set_brick_type_active(factory_a, brick_primary, true);
  select (public.create_brick_type(factory_a, 'A Delete Brick')).id into brick_unused;
  perform public.delete_unused_brick_type(factory_a, brick_unused);
  insert into pg_temp.atlas_12b2a_ids values ('brick_a', brick_primary);

  select (public.create_customer(factory_a, 'Customer A', 'Address A', '9111111111')).id
  into customer_id;
  perform public.update_customer(factory_a, customer_id, 'Customer A Updated', 'Address A Updated', '9111111111');
  insert into pg_temp.atlas_12b2a_ids values ('customer_a', customer_id);

  select (public.find_or_create_vehicle(factory_a, 'AT12A001', false)).id into vehicle_id;
  perform public.set_vehicle_delivery_wage_tracking(factory_a, vehicle_id, true);
  perform public.archive_vehicle(factory_a, vehicle_id);
  perform public.restore_vehicle(factory_a, vehicle_id);
  insert into pg_temp.atlas_12b2a_ids values ('vehicle_a', vehicle_id);

  select (public.create_challan(
    factory_a, 'A-MAIN', '2026-01-10', customer_id, vehicle_id, 10,
    jsonb_build_array(jsonb_build_object(
      'brick_type_id', brick_primary, 'quantity', 1000, 'rate', 100
    )), '[]'::jsonb
  )).id into challan_main;
  perform public.update_challan(
    factory_a, challan_main, 'A-MAIN-U', '2026-01-10', customer_id, vehicle_id, 10,
    jsonb_build_array(jsonb_build_object(
      'brick_type_id', brick_primary, 'quantity', 1000, 'rate', 110
    )), '[]'::jsonb
  );

  select (public.create_challan(
    factory_a, 'A-VOID', '2026-01-10', customer_id, vehicle_id, 10,
    jsonb_build_array(jsonb_build_object(
      'brick_type_id', brick_primary, 'quantity', 1000, 'rate', 100
    )), '[]'::jsonb
  )).id into challan_void;
  perform public.void_challan(factory_a, challan_void);

  select (public.create_challan(
    factory_a, 'A-PAY-LEGACY', '2026-01-10', customer_id, vehicle_id, 10,
    jsonb_build_array(jsonb_build_object(
      'brick_type_id', brick_primary, 'quantity', 1000, 'rate', 100
    )), '[]'::jsonb
  )).id into challan_payment_legacy;
  perform public.create_customer_payment(
    factory_a, customer_id, '2026-01-10', 10, 'cash', 'Legacy wrapper positive',
    jsonb_build_array(jsonb_build_object('challan_id', challan_payment_legacy, 'amount', 10))
  );

  select (public.create_challan(
    factory_a, 'A-PAY-MULTI', '2026-01-10', customer_id, vehicle_id, 10,
    jsonb_build_array(jsonb_build_object(
      'brick_type_id', brick_primary, 'quantity', 1000, 'rate', 100
    )), '[]'::jsonb
  )).id into challan_payment_multi;
  perform public.create_customer_payment_with_methods(
    factory_a, customer_id, '2026-01-10', 10,
    jsonb_build_array(
      jsonb_build_object('mode', 'cash', 'amount', 5),
      jsonb_build_object('mode', 'upi', 'amount', 5)
    ),
    'Multi-method positive',
    jsonb_build_array(jsonb_build_object('challan_id', challan_payment_multi, 'amount', 10))
  );

  select (public.create_challan_with_received_payment(
    factory_a, 'A-PAID-NOW', '2026-01-10', customer_id, vehicle_id, 10,
    jsonb_build_array(jsonb_build_object(
      'brick_type_id', brick_primary, 'quantity', 1000, 'rate', 100
    )), '[]'::jsonb,
    '2026-01-10', 10, 'cash'
  )).id into challan_paid_now;

  select count(*) into read_count from public.get_cash_book_day_summary(factory_a, '2026-01-10');
  if read_count <> 1 then raise exception 'FAIL: Cash Book summary positive control'; end if;
  select count(*) into read_count from public.list_cash_book_day_entries(factory_a, '2026-01-10');
  if read_count < 3 then raise exception 'FAIL: Cash Book entries positive control'; end if;
  select count(*) into read_count from public.get_challan_payment_state(factory_a, challan_main);
  if read_count <> 1 then raise exception 'FAIL: Challan payment-state positive control'; end if;
  select count(*) into read_count from public.get_customer_sales_summary(factory_a, customer_id);
  if read_count <> 1 then raise exception 'FAIL: customer summary positive control'; end if;

  insert into pg_temp.atlas_12b2a_ids values
    ('challan_a', challan_main),
    ('challan_void_a', challan_void),
    ('challan_payment_legacy_a', challan_payment_legacy),
    ('challan_payment_multi_a', challan_payment_multi),
    ('challan_paid_now_a', challan_paid_now);

  raise notice 'PASS [EXECUTED]: Factory A positive controls executed for all 27 scoped RPC signatures';
end;
$$;
reset role;
select pg_catalog.set_config('request.jwt.claim.sub', '', true);

select pg_temp.test_auth_factory_cross_suite();
select pg_temp.test_cross_factory_write_suite();
select pg_temp.test_cross_factory_read_suite();

-- Valid-but-crossed identifiers exercise child ownership independently from
-- the p_factory_id membership rejection. Each write also proves both synthetic
-- tenant state hashes are unchanged after rejection.
do $$
declare
  factory_a uuid := pg_temp.fixture_id('factory_a');
  factory_b uuid := pg_temp.fixture_id('factory_b');
  brick_a uuid := pg_temp.fixture_id('brick_a');
  brick_b uuid := pg_temp.fixture_id('brick_b');
  customer_a uuid := pg_temp.fixture_id('customer_a');
  customer_b uuid := pg_temp.fixture_id('customer_b');
  vehicle_a uuid := pg_temp.fixture_id('vehicle_a');
  vehicle_b uuid := pg_temp.fixture_id('vehicle_b');
  challan_a uuid := pg_temp.fixture_id('challan_a');
  challan_b uuid := pg_temp.fixture_id('challan_b');
  cash_entry_a uuid := pg_temp.fixture_id('cash_entry_a');
  cash_entry_b uuid := pg_temp.fixture_id('cash_entry_b');
  membership_message constant text := 'You do not have access to this factory\.';
  a_items jsonb := jsonb_build_array(jsonb_build_object(
    'brick_type_id', brick_a, 'quantity', 1000, 'rate', 100
  ));
  b_items jsonb := jsonb_build_array(jsonb_build_object(
    'brick_type_id', brick_b, 'quantity', 1000, 'rate', 100
  ));
begin
  perform pg_temp.expect_isolated_write(
    'Cash Book Factory A plus Factory B entry',
    format('select public.void_cash_book_manual_entry(%L::uuid,%L::uuid)', factory_a, cash_entry_b),
    'P3203', 'Manual Cash Book entry does not belong to this factory\.'
  );
  perform pg_temp.expect_isolated_write(
    'Cash Book reverse Factory B plus Factory A entry',
    format('select public.void_cash_book_manual_entry(%L::uuid,%L::uuid)', factory_b, cash_entry_a),
    '42501', membership_message
  );

  perform pg_temp.expect_isolated_write(
    'Brick Factory A plus Factory B brick',
    format('select public.rename_brick_type(%L::uuid,%L::uuid,%L)', factory_a, brick_b, 'Mixed Brick'),
    'P3400', 'Brick Type does not belong to this factory\.'
  );
  perform pg_temp.expect_isolated_write(
    'Brick reverse Factory B plus Factory A brick',
    format('select public.rename_brick_type(%L::uuid,%L::uuid,%L)', factory_b, brick_a, 'Mixed Brick'),
    '42501', membership_message
  );

  perform pg_temp.expect_isolated_write(
    'Customer Factory A plus Factory B customer',
    format('select public.update_customer(%L::uuid,%L::uuid,%L,%L,%L)',
      factory_a, customer_b, 'Mixed Customer', 'Mixed Address', '9000000099'),
    'P3002', 'Customer does not belong to this factory\.'
  );
  perform pg_temp.expect_isolated_write(
    'Customer reverse Factory B plus Factory A customer',
    format('select public.update_customer(%L::uuid,%L::uuid,%L,%L,%L)',
      factory_b, customer_a, 'Mixed Customer', 'Mixed Address', '9000000099'),
    '42501', membership_message
  );

  perform pg_temp.expect_isolated_write(
    'Vehicle Factory A plus Factory B vehicle',
    format('select public.set_vehicle_delivery_wage_tracking(%L::uuid,%L::uuid,true)', factory_a, vehicle_b),
    'P3102', 'Vehicle does not belong to this factory\.'
  );
  perform pg_temp.expect_isolated_write(
    'Vehicle reverse Factory B plus Factory A vehicle',
    format('select public.set_vehicle_delivery_wage_tracking(%L::uuid,%L::uuid,true)', factory_b, vehicle_a),
    '42501', membership_message
  );

  perform pg_temp.expect_isolated_write(
    'create_challan Factory A plus Factory B customer',
    format('select public.create_challan(%L::uuid,%L,%L::date,%L::uuid,%L::uuid,10,%L::jsonb,%L::jsonb)',
      factory_a, 'MIX-CUSTOMER', '2026-01-10', customer_b, vehicle_a, a_items::text, '[]'),
    'P3002', 'Customer does not belong to this factory\.'
  );
  perform pg_temp.expect_isolated_write(
    'create_challan Factory A plus Factory B vehicle',
    format('select public.create_challan(%L::uuid,%L,%L::date,%L::uuid,%L::uuid,10,%L::jsonb,%L::jsonb)',
      factory_a, 'MIX-VEHICLE', '2026-01-10', customer_a, vehicle_b, a_items::text, '[]'),
    'P3102', 'Vehicle does not belong to this factory\.'
  );
  perform pg_temp.expect_isolated_write(
    'create_challan Factory A plus Factory B brick',
    format('select public.create_challan(%L::uuid,%L,%L::date,%L::uuid,%L::uuid,10,%L::jsonb,%L::jsonb)',
      factory_a, 'MIX-BRICK', '2026-01-10', customer_a, vehicle_a, b_items::text, '[]'),
    'P3004', 'Brick type does not belong to this factory\.'
  );
  perform pg_temp.expect_isolated_write(
    'create_challan reverse Factory B plus Factory A children',
    format('select public.create_challan(%L::uuid,%L,%L::date,%L::uuid,%L::uuid,10,%L::jsonb,%L::jsonb)',
      factory_b, 'MIX-REVERSE', '2026-01-10', customer_a, vehicle_a, a_items::text, '[]'),
    '42501', membership_message
  );

  perform pg_temp.expect_isolated_write(
    'create_challan_with_received_payment Factory A plus Factory B customer',
    format('select public.create_challan_with_received_payment(%L::uuid,%L,%L::date,%L::uuid,%L::uuid,10,%L::jsonb,%L::jsonb,%L::date,10,%L)',
      factory_a, 'MIX-PAID', '2026-01-10', customer_b, vehicle_a, a_items::text, '[]',
      '2026-01-10', 'cash'),
    'P3002', 'Customer does not belong to this factory\.'
  );

  perform pg_temp.expect_isolated_write(
    'update_challan Factory A plus Factory B challan',
    format('select public.update_challan(%L::uuid,%L::uuid,%L,%L::date,%L::uuid,%L::uuid,10,%L::jsonb,%L::jsonb)',
      factory_a, challan_b, 'MIX-HEADER', '2026-01-10', customer_a, vehicle_a, a_items::text, '[]'),
    'P3003', 'Challan does not belong to this factory\.'
  );
  perform pg_temp.expect_isolated_write(
    'update_challan Factory A plus Factory B customer',
    format('select public.update_challan(%L::uuid,%L::uuid,%L,%L::date,%L::uuid,%L::uuid,10,%L::jsonb,%L::jsonb)',
      factory_a, challan_a, 'MIX-CUSTOMER-U', '2026-01-10', customer_b, vehicle_a, a_items::text, '[]'),
    'P3002', 'Customer does not belong to this factory\.'
  );
  perform pg_temp.expect_isolated_write(
    'update_challan Factory A plus Factory B vehicle',
    format('select public.update_challan(%L::uuid,%L::uuid,%L,%L::date,%L::uuid,%L::uuid,10,%L::jsonb,%L::jsonb)',
      factory_a, challan_a, 'MIX-VEHICLE-U', '2026-01-10', customer_a, vehicle_b, a_items::text, '[]'),
    'P3102', 'Vehicle does not belong to this factory\.'
  );
  perform pg_temp.expect_isolated_write(
    'update_challan Factory A plus Factory B brick',
    format('select public.update_challan(%L::uuid,%L::uuid,%L,%L::date,%L::uuid,%L::uuid,10,%L::jsonb,%L::jsonb)',
      factory_a, challan_a, 'MIX-BRICK-U', '2026-01-10', customer_a, vehicle_a, b_items::text, '[]'),
    'P3004', 'Brick type does not belong to this factory\.'
  );

  perform pg_temp.expect_isolated_write(
    'void_challan Factory A plus Factory B challan',
    format('select public.void_challan(%L::uuid,%L::uuid)', factory_a, challan_b),
    'P3003', 'Challan does not belong to this factory\.'
  );
  perform pg_temp.expect_isolated_write(
    'void_challan reverse Factory B plus Factory A challan',
    format('select public.void_challan(%L::uuid,%L::uuid)', factory_b, challan_a),
    '42501', membership_message
  );

  perform pg_temp.expect_isolated_write(
    'customer-payment compatibility wrapper Factory A plus Factory B customer',
    format('select public.create_customer_payment(%L::uuid,%L::uuid,%L::date,10,%L,%L,%L::jsonb)',
      factory_a, customer_b, '2026-01-10', 'cash', 'Mixed customer payment',
      jsonb_build_array(jsonb_build_object('challan_id', challan_a, 'amount', 10))::text),
    'P3002', 'Customer does not belong to this factory\.'
  );
  perform pg_temp.expect_isolated_write(
    'multi-method payment Factory A plus Factory B challan',
    format('select public.create_customer_payment_with_methods(%L::uuid,%L::uuid,%L::date,10,%L::jsonb,%L,%L::jsonb)',
      factory_a, customer_a, '2026-01-10',
      jsonb_build_array(jsonb_build_object('mode', 'cash', 'amount', 10))::text,
      'Mixed challan payment',
      jsonb_build_array(jsonb_build_object('challan_id', challan_b, 'amount', 10))::text),
    'P3102', 'Challan does not belong to this factory\.'
  );
  perform pg_temp.expect_isolated_write(
    'customer payment reverse Factory B plus Factory A objects',
    format('select public.create_customer_payment(%L::uuid,%L::uuid,%L::date,10,%L,%L,%L::jsonb)',
      factory_b, customer_a, '2026-01-10', 'cash', 'Mixed reverse payment',
      jsonb_build_array(jsonb_build_object('challan_id', challan_a, 'amount', 10))::text),
    '42501', membership_message
  );

  perform pg_temp.expect_user_a_error(
    'get_challan_payment_state Factory A plus Factory B challan',
    format('select * from public.get_challan_payment_state(%L::uuid,%L::uuid)', factory_a, challan_b),
    'P3102', 'Challan does not belong to this factory\.'
  );
  perform pg_temp.expect_user_a_error(
    'get_customer_sales_summary Factory A plus Factory B customer',
    format('select * from public.get_customer_sales_summary(%L::uuid,%L::uuid)', factory_a, customer_b),
    'P3002', 'Customer does not belong to this factory\.'
  );

  raise notice 'PASS [EXECUTED]: 24 valid mixed/reverse identifier attacks rejected by membership or tenant-child ownership';
end;
$$;

-- Inactive-member order: the same calls/inputs first succeed while active,
-- privileged authority deactivates A, then each same call fails specifically on
-- membership (or returns the explicit inactive resolver state).
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '12c00000-0000-4000-8000-000000000001', true);
select pg_temp.assert_identity('12c00000-0000-4000-8000-000000000001', 'inactive pre-controls');
do $$
declare
  factory_a uuid := pg_temp.fixture_id('factory_a');
  customer_a uuid := pg_temp.fixture_id('customer_a');
  brick_a uuid := pg_temp.fixture_id('brick_a');
  result record;
  row_count integer;
begin
  select * into result from public.resolve_factory_access();
  if result.status <> 'active' or result.factory_id <> factory_a then
    raise exception 'FAIL: inactive pre-control resolver';
  end if;
  select * into result from public.provision_first_factory('Inactive Same Call');
  if result.factory_id <> factory_a or result.created then
    raise exception 'FAIL: inactive pre-control provisioning';
  end if;
  select count(*) into row_count from public.get_cash_book_day_summary(factory_a, '2026-01-10');
  if row_count <> 1 then raise exception 'FAIL: inactive pre-control Cash Book read'; end if;
  perform public.create_cash_book_manual_entry(
    factory_a, '12c30000-0000-4000-8000-000000000010', '2026-01-04',
    'in', 1, 'cash', 'Inactive same-call party', 'Inactive same-call fixture'
  );
  select count(*) into row_count from public.get_customer_sales_summary(factory_a, customer_a);
  if row_count <> 1 then raise exception 'FAIL: inactive pre-control Sales read'; end if;
  perform public.rename_brick_type(factory_a, brick_a, 'A Inactive Same Call');
  raise notice 'PASS [EXECUTED]: six RPC checks across five required inactive-member categories have matching active pre-controls';
end;
$$;
reset role;
select pg_catalog.set_config('request.jwt.claim.sub', '', true);

do $$
begin
  if current_user in ('authenticated', 'anon') or auth.uid() is not null then
    raise exception 'FAIL: deactivation did not start privileged and identity-cleared';
  end if;
  update public.factory_users set is_active = false
  where user_id = pg_temp.fixture_id('user_a')
    and factory_id = pg_temp.fixture_id('factory_a');
  if not found then raise exception 'FAIL: User A membership was not deactivated'; end if;
end;
$$;

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '12c00000-0000-4000-8000-000000000001', true);
select pg_temp.assert_identity('12c00000-0000-4000-8000-000000000001', 'inactive resolver');
do $$
declare result record;
begin
  select * into result from public.resolve_factory_access();
  if result.status <> 'inactive' or result.factory_id is not null then
    raise exception 'FAIL: resolver did not fail closed to inactive/NULL';
  end if;
end;
$$;
reset role;
select pg_catalog.set_config('request.jwt.claim.sub', '', true);

select pg_temp.expect_user_a_error(
  'inactive provision_first_factory',
  format('select * from public.provision_first_factory(%L)', 'Inactive Same Call'),
  'P0001', '^ATLAS_MEMBERSHIP_INACTIVE$'
);
select pg_temp.expect_user_a_error(
  'inactive Cash Book read',
  format('select * from public.get_cash_book_day_summary(%L::uuid,%L::date)',
    pg_temp.fixture_id('factory_a'), '2026-01-10'),
  '42501', 'You do not have access to this factory\.'
);
select pg_temp.expect_isolated_write(
  'inactive Cash Book write',
  format('select public.create_cash_book_manual_entry(%L::uuid,%L::uuid,%L::date,%L,1,%L,%L,%L)',
    pg_temp.fixture_id('factory_a'), '12c30000-0000-4000-8000-000000000010',
    '2026-01-04', 'in', 'cash', 'Inactive same-call party', 'Inactive same-call fixture'),
  '42501', 'You do not have access to this factory\.'
);
select pg_temp.expect_user_a_error(
  'inactive Sales read',
  format('select * from public.get_customer_sales_summary(%L::uuid,%L::uuid)',
    pg_temp.fixture_id('factory_a'), pg_temp.fixture_id('customer_a')),
  '42501', 'You do not have access to this factory\.'
);
select pg_temp.expect_isolated_write(
  'inactive Sales write',
  format('select public.rename_brick_type(%L::uuid,%L::uuid,%L)',
    pg_temp.fixture_id('factory_a'), pg_temp.fixture_id('brick_a'), 'A Inactive Same Call'),
  '42501', 'You do not have access to this factory\.'
);

reset role;
select pg_catalog.set_config('request.jwt.claim.sub', '', true);
rollback;

-- Compare every public table plus auth.users after rollback. Any mismatch exits
-- non-zero, so setup/runtime failures are never converted to PASS.
do $$
declare
  target record;
  ending_count bigint;
  mismatches text[] := array[]::text[];
begin
  for target in select * from atlas_12b2a_persistent_counts order by schema_name, table_name loop
    execute pg_catalog.format(
      'select count(*) from %I.%I', target.schema_name, target.table_name
    ) into ending_count;
    if ending_count <> target.row_count then
      mismatches := array_append(
        mismatches,
        pg_catalog.format('%s.%s before=%s after=%s',
          target.schema_name, target.table_name, target.row_count, ending_count)
      );
    end if;
  end loop;
  if cardinality(mismatches) > 0 then
    raise exception 'FAIL: rollback persistent-count mismatches: %', mismatches;
  end if;
end;
$$;

select
  27 as scoped_live_rpcs,
  27 as security_definer_rpcs,
  0 as invoker_rpcs,
  5 as read_rpcs,
  22 as write_rpcs,
  0 as mixed_rpcs,
  27 as executed_and_passed,
  0 as not_exercised,
  0 as not_proven,
  0 as failed,
  22 as cross_factory_write_effect_proofs,
  5 as cross_factory_read_proofs,
  24 as mixed_identifier_attacks,
  6 as inactive_rpc_checks,
  5 as inactive_required_categories,
  0 as anon_execute_exposures,
  0 as public_execute_exposures,
  24 as real_writer_rpc_fixture_calls,
  0 as authenticated_direct_write_fixture_rows,
  2 as trigger_generated_fixture_rows,
  2 as privileged_setup_fixture_rows,
  64 as persistent_count_pairs_compared,
  0 as persistent_count_mismatches;

drop table atlas_12b2a_persistent_counts;
drop table atlas_12b2a_rpc_manifest;
