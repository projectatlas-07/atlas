-- Atlas Security 12B2D: real authenticated entry points; synthetic data only.
-- Run with: npx supabase db query --linked --file supabase/verify_rpc_isolation_master_sensitive_reads.sql
-- Never run against Main. This file does NOT create persistent functions/migrations.
-- Counts below distinguish successful writer INVOCATIONS from direct/trigger-created ROWS.
-- Session-only sequences retain execution counters across ROLLBACK; no business data is committed.
create temporary table atlas_12b2d_manifest(
  id text primary key, fn text not null, args text not null, barrier text not null,
  unique(fn,args)
) on commit preserve rows;
insert into atlas_12b2d_manifest values
('MU10','get_mud_group_settlement_account','p_factory_id uuid, p_labour_group_id uuid, p_as_of_date date','active membership; factory settlement-mode check; checked calculate_mud_group_settlement_account delegate validates group id AND factory_id; balances scoped'),
('PE3','create_coal_reference_value','p_factory_id uuid, p_kind text, p_display_value text','active membership; insert and uniqueness fallback use factory_id'),
('PE31','update_supplier','p_factory_id uuid, p_supplier_id uuid, p_name text, p_address text, p_mobile text','active membership; supplier update uses id AND factory_id'),
('PE7','create_or_assign_supplier_role','p_factory_id uuid, p_role text, p_name text, p_address text, p_mobile text','active membership; normalized-name match uses factory_id; ID-only supplier read uses matched IDs; role insertion carries factory_id'),
('PE8','create_supplier','p_factory_id uuid, p_name text, p_address text, p_mobile text','active membership; supplier insert carries factory_id'),
('PR9','get_production_labourer_account','p_factory_id uuid, p_labourer_id uuid, p_as_of_date date','active membership; checked calculate_production_labourer_account delegate validates labourer id AND factory_id; earnings/withdrawals scoped'),
('SO1','archive_soil_worker','p_factory_id uuid, p_soil_worker_id uuid','active membership; worker lookup/update uses id AND factory_id'),
('SO10','restore_soil_worker','p_factory_id uuid, p_soil_worker_id uuid','active membership; worker lookup/update uses id AND factory_id'),
('SO4','create_soil_worker_trolley_rate','p_factory_id uuid, p_soil_worker_id uuid, p_rate_per_trolley numeric, p_effective_from date','active membership; worker and prior rate use factory_id; ID-only prior-rate update uses that scoped result'),
('SO5','create_soil_worker_with_initial_trolley_rate','p_factory_id uuid, p_name text, p_initial_rate_per_trolley numeric, p_initial_effective_from date','active membership; inserts worker and initial rate with caller-authorized factory_id'),
('SO6','delete_unused_soil_worker','p_factory_id uuid, p_soil_worker_id uuid','active membership; worker, dependency guards, rate deletion and worker deletion factory-scoped'),
('SO7','get_soil_financial_summary','p_factory_id uuid, p_soil_worker_id uuid','active membership; worker id AND factory_id; checked SO8 earnings delegate; adjustments/payments scoped'),
('SO8','get_soil_total_earned','p_factory_id uuid, p_soil_worker_id uuid','active membership; worker id AND factory_id; earnings scoped'),
('SO9','resolve_soil_worker_trolley_rate','p_factory_id uuid, p_soil_worker_id uuid, p_work_date date','active membership; worker id AND factory_id; date-range rate rows scoped'),
('ST1','archive_staff_worker','p_factory_id uuid, p_staff_worker_id uuid','active membership; worker lookup/update uses id AND factory_id'),
('ST2','create_staff_worker_with_reference_salary','p_factory_id uuid, p_name text, p_staff_category_id uuid, p_reference_salary numeric','active membership; category id AND factory_id checked before worker insertion'),
('ST3','delete_staff_category','p_factory_id uuid, p_staff_category_id uuid','active membership; category, dependent workers and deletion factory-scoped'),
('ST4','delete_staff_worker','p_factory_id uuid, p_staff_worker_id uuid','active membership; worker, payment guard and deletion factory-scoped'),
('ST7','restore_staff_worker','p_factory_id uuid, p_staff_worker_id uuid','active membership; worker lookup/update uses id AND factory_id'),
('ST8','update_staff_category','p_factory_id uuid, p_staff_category_id uuid, p_name text','active membership; category lookup/update uses id AND factory_id'),
('ST9','update_staff_reference_salary','p_factory_id uuid, p_staff_worker_id uuid, p_reference_salary numeric','active membership; worker lookup/update uses id AND factory_id'),
('TR4','get_transport_worker_available_balance','p_factory_id uuid, p_transport_worker_id uuid, p_as_of_date date','active membership; worker id AND factory_id; earnings/withdrawals scoped'),
('TR5','save_transport_daily_entry','p_factory_id uuid, p_transport_crew_id uuid, p_work_date date, p_paya_quantity numeric, p_transport_worker_ids uuid[]','active membership; crew and every array worker factory-scoped; active assignments or owned historical attendance checked before writes');

create temporary table atlas_12b2d_baseline(s text,t text,c bigint,h text,primary key(s,t))
on commit preserve rows;
create temporary sequence atlas_12b2d_writers;
create temporary sequence atlas_12b2d_privileged;
create temporary sequence atlas_12b2d_triggers;
create temporary sequence atlas_12b2d_positive;
create temporary sequence atlas_12b2d_rejected;
-- No authenticated direct-write fixture path is used.
do $$
declare r record; n bigint; h text; live_count integer;
begin
  select count(*) into live_count
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  join atlas_12b2d_manifest m on m.fn=p.proname
    and m.args=pg_get_function_identity_arguments(p.oid)
  where n.nspname='public';
  if live_count<>23 or (select count(*) from atlas_12b2d_manifest)<>23 then
    raise exception 'FAIL exact live signature count';
  end if;
  if exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    join atlas_12b2d_manifest m on m.fn=p.proname
      and m.args=pg_get_function_identity_arguments(p.oid)
    where n.nspname='public' and (
      not p.prosecdef or not has_function_privilege('authenticated',p.oid,'EXECUTE')
      or has_function_privilege('anon',p.oid,'EXECUTE')
      or not coalesce(p.proconfig@>array['search_path=pg_catalog, public'],false)
      or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
                where a.grantee=0 and a.privilege_type='EXECUTE')
    )
  ) then raise exception 'FAIL security-definer/grants/search_path contract'; end if;
  for r in
    select 'public'::text s,c.relname::text t
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in('r','p')
    union all select 'auth','users'
  loop
    -- Full-row hashes stay inside SQL; never output credentials or personal data.
    execute format('select count(*),md5(coalesce(jsonb_agg(to_jsonb(q) order by to_jsonb(q)::text),''[]'')::text) from %I.%I q',r.s,r.t)
      into n,h;
    insert into atlas_12b2d_baseline values(r.s,r.t,n,h);
  end loop;
  if (select count(*) from atlas_12b2d_baseline where s='public')<>64
    or (select count(*) from atlas_12b2d_baseline)<>65 then
    raise exception 'FAIL expected 64 public tables plus auth.users';
  end if;
  if exists(select 1 from auth.users where id in(
    '12f00000-0000-4000-8000-000000000001','12f00000-0000-4000-8000-000000000002')) then
    raise exception 'FAIL synthetic user collision';
  end if;
end$$;
create temporary table atlas_12b2d_plan(id text,label text primary key,category text,q text,code text,message text,user_key text) on commit preserve rows;
insert into atlas_12b2d_plan values
('SO1','SO1 direct B','DIRECT','select * from public.archive_soil_worker(pg_temp.fid(''fb''),pg_temp.fid(''soil_b''))','42501','You do not have access to this factory.','ua'),
('SO4','SO4 direct B','DIRECT','select * from public.create_soil_worker_trolley_rate(pg_temp.fid(''fb''),pg_temp.fid(''soil_b''),35,date ''2026-09-30'')','42501','You do not have access to this factory.','ua'),
('SO5','SO5 direct B','DIRECT','select * from public.create_soil_worker_with_initial_trolley_rate(pg_temp.fid(''fb''),''New isolation worker'',19,date ''2026-09-01'')','42501','You do not have access to this factory.','ua'),
('SO6','SO6 direct B','DIRECT','select * from public.delete_unused_soil_worker(pg_temp.fid(''fb''),pg_temp.fid(''soil_del_b''))','42501','You do not have access to this factory.','ua'),
('SO10','SO10 direct B','DIRECT','select * from public.restore_soil_worker(pg_temp.fid(''fb''),pg_temp.fid(''soil_restore_b''))','42501','You do not have access to this factory.','ua'),
('ST1','ST1 direct B','DIRECT','select * from public.archive_staff_worker(pg_temp.fid(''fb''),pg_temp.fid(''staff_b''))','42501','You do not have access to this factory.','ua'),
('ST2','ST2 direct B','DIRECT','select * from public.create_staff_worker_with_reference_salary(pg_temp.fid(''fb''),''New isolation staff'',pg_temp.fid(''cat_b''),1800)','42501','You do not have access to this factory.','ua'),
('ST3','ST3 direct B','DIRECT','select * from public.delete_staff_category(pg_temp.fid(''fb''),pg_temp.fid(''cat_del_b''))','42501','You do not have access to this factory.','ua'),
('ST4','ST4 direct B','DIRECT','select * from public.delete_staff_worker(pg_temp.fid(''fb''),pg_temp.fid(''staff_del_b''))','42501','You do not have access to this factory.','ua'),
('ST7','ST7 direct B','DIRECT','select * from public.restore_staff_worker(pg_temp.fid(''fb''),pg_temp.fid(''staff_restore_b''))','42501','You do not have access to this factory.','ua'),
('ST8','ST8 direct B','DIRECT','select * from public.update_staff_category(pg_temp.fid(''fb''),pg_temp.fid(''cat_b''),''Isolated Category'')','42501','You do not have access to this factory.','ua'),
('ST9','ST9 direct B','DIRECT','select * from public.update_staff_reference_salary(pg_temp.fid(''fb''),pg_temp.fid(''staff_b''),1700)','42501','You do not have access to this factory.','ua'),
('TR5','TR5 direct B','DIRECT','select * from public.save_transport_daily_entry(pg_temp.fid(''fb''),pg_temp.fid(''crew_b''),date ''2026-09-22'',4,array[pg_temp.fid(''tw_b'')])','42501','You do not have access to this factory.','ua'),
('PE3','PE3 direct B','DIRECT','select * from public.create_coal_reference_value(pg_temp.fid(''fb''),''coal_name'',''Isolated Coal'')','42501','You do not have access to this factory.','ua'),
('PE7','PE7 direct B','DIRECT','select * from public.create_or_assign_supplier_role(pg_temp.fid(''fb''),''GARAGE'',''Supplier b'',null,null)','42501','You do not have access to this factory.','ua'),
('PE8','PE8 direct B','DIRECT','select * from public.create_supplier(pg_temp.fid(''fb''),''Isolated Supplier'',''Isolated Address'',null)','42501','You do not have access to this factory.','ua'),
('PE31','PE31 direct B','DIRECT','select * from public.update_supplier(pg_temp.fid(''fb''),pg_temp.fid(''supplier_b''),''Isolated Updated Supplier'',''Isolated Address'',null)','42501','You do not have access to this factory.','ua'),
('PR9','PR9 direct B','DIRECT','select * from public.get_production_labourer_account(pg_temp.fid(''fb''),pg_temp.fid(''prod_b''),date ''2026-09-29'')','42501','You do not have access to this factory.','ua'),
('MU10','MU10 direct B','DIRECT','select * from public.get_mud_group_settlement_account(pg_temp.fid(''fb''),pg_temp.fid(''mud_b''),date ''2026-09-29'')','42501','You do not have access to this factory.','ua'),
('SO7','SO7 direct B','DIRECT','select * from public.get_soil_financial_summary(pg_temp.fid(''fb''),pg_temp.fid(''soil_b''))','42501','You do not have access to this factory.','ua'),
('SO8','SO8 direct B','DIRECT','select * from public.get_soil_total_earned(pg_temp.fid(''fb''),pg_temp.fid(''soil_b''))','42501','You do not have access to this factory.','ua'),
('SO9','SO9 direct B','DIRECT','select * from public.resolve_soil_worker_trolley_rate(pg_temp.fid(''fb''),pg_temp.fid(''soil_b''),date ''2026-09-20'')','42501','You do not have access to this factory.','ua'),
('TR4','TR4 direct B','DIRECT','select * from public.get_transport_worker_available_balance(pg_temp.fid(''fb''),pg_temp.fid(''tw_b''),date ''2026-09-29'')','42501','You do not have access to this factory.','ua'),
('PE7','PE7 direct B new supplier','DIRECT','select * from public.create_or_assign_supplier_role(pg_temp.fid(''fb''),''GARAGE'',''New Isolated Garage B'',null,null)','42501','You do not have access to this factory.','ua'),
('SO1','SO1 A factory B child','MIXED','select * from public.archive_soil_worker(pg_temp.fid(''fa''),pg_temp.fid(''soil_b''))','P2602','Soil worker does not belong to this factory.','ua'),
('SO4','SO4 A factory B child','MIXED','select * from public.create_soil_worker_trolley_rate(pg_temp.fid(''fa''),pg_temp.fid(''soil_b''),35,date ''2026-09-30'')','P2602','Soil worker does not belong to this factory.','ua'),
('SO6','SO6 A factory B child','MIXED','select * from public.delete_unused_soil_worker(pg_temp.fid(''fa''),pg_temp.fid(''soil_del_b''))','P2602','Soil worker does not belong to this factory.','ua'),
('SO10','SO10 A factory B child','MIXED','select * from public.restore_soil_worker(pg_temp.fid(''fa''),pg_temp.fid(''soil_restore_b''))','P2602','Soil worker does not belong to this factory.','ua'),
('ST1','ST1 A factory B child','MIXED','select * from public.archive_staff_worker(pg_temp.fid(''fa''),pg_temp.fid(''staff_b''))','P2502','Staff worker does not belong to this factory.','ua'),
('ST2','ST2 A factory B child','MIXED','select * from public.create_staff_worker_with_reference_salary(pg_temp.fid(''fa''),''New isolation staff'',pg_temp.fid(''cat_b''),1800)','42501','Staff category does not belong to this factory.','ua'),
('ST3','ST3 A factory B child','MIXED','select * from public.delete_staff_category(pg_temp.fid(''fa''),pg_temp.fid(''cat_del_b''))','P2504','Staff category does not belong to this factory.','ua'),
('ST4','ST4 A factory B child','MIXED','select * from public.delete_staff_worker(pg_temp.fid(''fa''),pg_temp.fid(''staff_del_b''))','P2502','Staff worker does not belong to this factory.','ua'),
('ST7','ST7 A factory B child','MIXED','select * from public.restore_staff_worker(pg_temp.fid(''fa''),pg_temp.fid(''staff_restore_b''))','P2502','Staff worker does not belong to this factory.','ua'),
('ST8','ST8 A factory B child','MIXED','select * from public.update_staff_category(pg_temp.fid(''fa''),pg_temp.fid(''cat_b''),''Isolated Category'')','P2504','Staff category does not belong to this factory.','ua'),
('ST9','ST9 A factory B child','MIXED','select * from public.update_staff_reference_salary(pg_temp.fid(''fa''),pg_temp.fid(''staff_b''),1700)','P2502','Staff worker does not belong to this factory.','ua'),
('TR5','TR5 A factory B child','MIXED','select * from public.save_transport_daily_entry(pg_temp.fid(''fa''),pg_temp.fid(''crew_a''),date ''2026-09-22'',4,array[pg_temp.fid(''tw_b'')])','42501','One or more transport workers do not belong to this factory.','ua'),
('PE31','PE31 A factory B child','MIXED','select * from public.update_supplier(pg_temp.fid(''fa''),pg_temp.fid(''supplier_b''),''Isolated Updated Supplier'',''Isolated Address'',null)','P4002','Supplier does not belong to this factory.','ua'),
('PR9','PR9 A factory B child','MIXED','select * from public.get_production_labourer_account(pg_temp.fid(''fa''),pg_temp.fid(''prod_b''),date ''2026-09-29'')','42501','Labourer does not belong to this factory.','ua'),
('MU10','MU10 A factory B child','MIXED','select * from public.get_mud_group_settlement_account(pg_temp.fid(''fa''),pg_temp.fid(''mud_b''),date ''2026-09-29'')','42501','Mud group does not belong to this factory.','ua'),
('SO7','SO7 A factory B child','MIXED','select * from public.get_soil_financial_summary(pg_temp.fid(''fa''),pg_temp.fid(''soil_b''))','P2602','Soil worker does not belong to this factory.','ua'),
('SO8','SO8 A factory B child','MIXED','select * from public.get_soil_total_earned(pg_temp.fid(''fa''),pg_temp.fid(''soil_b''))','P2602','Soil worker does not belong to this factory.','ua'),
('SO9','SO9 A factory B child','MIXED','select * from public.resolve_soil_worker_trolley_rate(pg_temp.fid(''fa''),pg_temp.fid(''soil_b''),date ''2026-09-20'')','P2602','Soil worker does not belong to this factory.','ua'),
('TR4','TR4 A factory B child','MIXED','select * from public.get_transport_worker_available_balance(pg_temp.fid(''fa''),pg_temp.fid(''tw_b''),date ''2026-09-29'')','42501','Transport worker does not belong to this factory.','ua'),
('TR5','TR5 A crew mixed A B array','MIXED','select * from public.save_transport_daily_entry(pg_temp.fid(''fa''),pg_temp.fid(''crew_a''),date ''2026-09-22'',4,array[pg_temp.fid(''tw_a''),pg_temp.fid(''tw_b'')])','42501','One or more transport workers do not belong to this factory.','ua'),
('TR5','TR5 B crew A workers','MIXED','select * from public.save_transport_daily_entry(pg_temp.fid(''fa''),pg_temp.fid(''crew_b''),date ''2026-09-22'',4,array[pg_temp.fid(''tw_a''),pg_temp.fid(''tw_a2'')])','42501','Transport crew does not belong to this factory.','ua'),
('PR9','PR9 B caller A child','REVERSE','select * from public.get_production_labourer_account(pg_temp.fid(''fb''),pg_temp.fid(''prod_a''),date ''2026-09-29'')','42501','Labourer does not belong to this factory.','ub'),
('MU10','MU10 B caller A child','REVERSE','select * from public.get_mud_group_settlement_account(pg_temp.fid(''fb''),pg_temp.fid(''mud_a''),date ''2026-09-29'')','42501','Mud group does not belong to this factory.','ub'),
('SO7','SO7 B caller A child','REVERSE','select * from public.get_soil_financial_summary(pg_temp.fid(''fb''),pg_temp.fid(''soil_a''))','P2602','Soil worker does not belong to this factory.','ub'),
('SO8','SO8 B caller A child','REVERSE','select * from public.get_soil_total_earned(pg_temp.fid(''fb''),pg_temp.fid(''soil_a''))','P2602','Soil worker does not belong to this factory.','ub'),
('SO9','SO9 B caller A child','REVERSE','select * from public.resolve_soil_worker_trolley_rate(pg_temp.fid(''fb''),pg_temp.fid(''soil_a''),date ''2026-09-20'')','P2602','Soil worker does not belong to this factory.','ub'),
('TR4','TR4 B caller A child','REVERSE','select * from public.get_transport_worker_available_balance(pg_temp.fid(''fb''),pg_temp.fid(''tw_a''),date ''2026-09-29'')','42501','Transport worker does not belong to this factory.','ub'),
('SO4','SO4 B caller A child','REVERSE','select * from public.create_soil_worker_trolley_rate(pg_temp.fid(''fb''),pg_temp.fid(''soil_a''),35,date ''2026-09-30'')','P2602','Soil worker does not belong to this factory.','ub'),
('ST2','ST2 B caller A child','REVERSE','select * from public.create_staff_worker_with_reference_salary(pg_temp.fid(''fb''),''New isolation staff'',pg_temp.fid(''cat_a''),1800)','42501','Staff category does not belong to this factory.','ub'),
('ST9','ST9 B caller A child','REVERSE','select * from public.update_staff_reference_salary(pg_temp.fid(''fb''),pg_temp.fid(''staff_a''),1700)','P2502','Staff worker does not belong to this factory.','ub'),
('PE31','PE31 B caller A child','REVERSE','select * from public.update_supplier(pg_temp.fid(''fb''),pg_temp.fid(''supplier_a''),''Isolated Updated Supplier'',''Isolated Address'',null)','P4002','Supplier does not belong to this factory.','ub'),
('TR5','TR5 B caller A child','REVERSE','select * from public.save_transport_daily_entry(pg_temp.fid(''fb''),pg_temp.fid(''crew_b''),date ''2026-09-22'',4,array[pg_temp.fid(''tw_a'')])','42501','One or more transport workers do not belong to this factory.','ub'),
('SO5','SO5 inactive same call','INACTIVE','select * from public.create_soil_worker_with_initial_trolley_rate(pg_temp.fid(''fa''),''Inactive repeat Soil'',21,date ''2026-09-01'')','42501','You do not have access to this factory.','ua'),
('ST9','ST9 inactive same call','INACTIVE','select * from public.update_staff_reference_salary(pg_temp.fid(''fa''),pg_temp.fid(''staff_a''),1500)','42501','You do not have access to this factory.','ua'),
('TR5','TR5 inactive same call','INACTIVE','select * from public.save_transport_daily_entry(pg_temp.fid(''fa''),pg_temp.fid(''crew_a''),date ''2026-09-28'',2,array[pg_temp.fid(''tw_a''),pg_temp.fid(''tw_a2'')])','42501','You do not have access to this factory.','ua'),
('PR9','PR9 inactive same call','INACTIVE','select * from public.get_production_labourer_account(pg_temp.fid(''fa''),pg_temp.fid(''prod_a''),date ''2026-09-29'')','42501','You do not have access to this factory.','ua');

-- Only temporary metadata has been created at this point.
commit;
begin;

create temporary table atlas_12b2d_ids(k text primary key,id uuid not null) on commit drop;
create temporary table atlas_12b2d_pass(id text primary key) on commit drop;
create temporary table atlas_12b2d_rejections(
  id text, label text primary key, code text, class text
) on commit drop;
grant select,insert on atlas_12b2d_ids to authenticated;
create function pg_temp.fid(k text) returns uuid language sql stable as
$$select id from pg_temp.atlas_12b2d_ids x where x.k=fid.k$$;
create function pg_temp.check_it(ok boolean,label text) returns void language plpgsql as
$$begin if ok is distinct from true then raise exception 'FAIL %',label; end if; end$$;
create function pg_temp.clear_identity() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{}',true);
  perform pg_temp.check_it(current_user<>'authenticated' and auth.uid() is null,'privileged context cleared');
end$$;
create function pg_temp.identity(u uuid) returns void language plpgsql as $$
begin
  perform pg_temp.check_it(current_user='authenticated' and auth.uid()=u,'authenticated role and intended JWT');
end$$;
-- SECURITY INVOKER: entry-point calls execute as authenticated, not as the CLI administrator.
create function pg_temp.run(u uuid,q text,writer boolean default false) returns jsonb
language plpgsql as $$
declare j jsonb;
begin
  perform pg_temp.clear_identity();
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub',u::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
  perform pg_temp.identity(u);
  execute 'select coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) from ('||q||') t' into j;
  perform pg_temp.identity(u);
  perform pg_temp.clear_identity();
  if writer then perform nextval('pg_temp.atlas_12b2d_writers'); end if;
  return j;
end$$;
create function pg_temp.seed(q text) returns void language plpgsql as $$
declare n integer;i integer;
begin
  perform pg_temp.clear_identity();
  execute q;
  get diagnostics n=row_count;
  for i in 1..n loop perform nextval('pg_temp.atlas_12b2d_privileged'); end loop;
end$$;
create function pg_temp.pass(test_id text) returns void language plpgsql as $$
begin
  insert into pg_temp.atlas_12b2d_pass values(test_id);
  perform nextval('pg_temp.atlas_12b2d_positive');
end$$;
-- Canonical full-row snapshots: factory profile plus ALL factory_id-bearing public tables.
-- Used only under the cleared privileged verifier context.
create function pg_temp.fhash(f uuid) returns text language plpgsql stable as $$
declare r record;j jsonb; x jsonb;
begin
  select to_jsonb(q) into j from public.factories q where id=f;
  for r in
    select c.relname t from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in('r','p')
      and exists(select 1 from pg_attribute a where a.attrelid=c.oid
                 and a.attname='factory_id' and not a.attisdropped)
    order by c.relname
  loop
    execute format('select coalesce(jsonb_agg(to_jsonb(q) order by to_jsonb(q)::text),''[]'') from public.%I q where factory_id=$1',r.t)
      into x using f;
    j:=j||jsonb_build_object(r.t,x);
  end loop;
  return md5(j::text);
end$$;
create function pg_temp.reject(test_id text,label text,q text,expected_code text,expected_message text,u uuid default null)
returns void language plpgsql as $$
declare a uuid:=pg_temp.fid('fa');b uuid:=pg_temp.fid('fb');
ha text;hb text;gs text;gm text;returned boolean:=false;
begin
  perform pg_temp.clear_identity();
  perform pg_temp.check_it(exists(select 1 from pg_temp.atlas_12b2d_pass where id=test_id),
                           label||' has prior valid A positive');
  ha:=pg_temp.fhash(a);hb:=pg_temp.fhash(b);
  begin
    perform pg_temp.run(coalesce(u,pg_temp.fid('ua')),q,false);
    returned:=true;
  exception when others then gs:=sqlstate;gm:=sqlerrm;
  end;
  perform pg_temp.clear_identity();
  if returned or gs is distinct from expected_code or gm is distinct from expected_message then
    -- Intentionally do not print arbitrary provider/database error details.
    raise exception 'FAIL %: success or incidental rejection (SQLSTATE %)',label,gs;
  end if;
  perform pg_temp.check_it(ha=pg_temp.fhash(a) and hb=pg_temp.fhash(b),label||' zero A/B full-row mutation');
  insert into pg_temp.atlas_12b2d_rejections values(test_id,label,gs,expected_message);
  perform nextval('pg_temp.atlas_12b2d_rejected');
end$$;

select pg_temp.clear_identity();
select pg_temp.seed($q$insert into auth.users(
 id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
('12f00000-0000-4000-8000-000000000001','authenticated','authenticated','atlas-12b2d-a@example.invalid',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
('12f00000-0000-4000-8000-000000000002','authenticated','authenticated','atlas-12b2d-b@example.invalid',now(),'{"provider":"email","providers":["email"]}','{}',now(),now())$q$);
insert into atlas_12b2d_ids values
('ua','12f00000-0000-4000-8000-000000000001'),('ub','12f00000-0000-4000-8000-000000000002');

do $$
declare s text;j jsonb;f uuid;
begin
  foreach s in array array['a','b'] loop
    j:=pg_temp.run(pg_temp.fid('u'||s),'select * from public.provision_first_factory(''Atlas 12B2D '||upper(s)||''')',true);
    f:=(j->0->>'factory_id')::uuid;
    insert into pg_temp.atlas_12b2d_ids values('f'||s,f);
    perform pg_temp.check_it(
      exists(select 1 from public.factory_users where factory_id=f and user_id=pg_temp.fid('u'||s) and is_active)
      and exists(select 1 from public.mud_accounting_states where factory_id=f),
      'real provisioning active membership and Mud initialization');
    perform nextval('pg_temp.atlas_12b2d_triggers');
  end loop;
end$$;

-- Privileged prerequisites are in already-proven/future scopes, never scoped RPC substitutes.
-- Master parents, source production history and its rates are deterministic fixtures.
insert into atlas_12b2d_ids(k,id)
select k,gen_random_uuid() from unnest(array[
'prod_a','prod_b','mud_source_a','mud_source_b','cat_a','cat_b','cat_del_a','cat_del_b',
'crew_a','crew_b','tw_a','tw_a2','tw_b']) k;
select pg_temp.seed($q$insert into public.labourers(id,factory_id,name) values
(pg_temp.fid('prod_a'),pg_temp.fid('fa'),'Production A'),
(pg_temp.fid('prod_b'),pg_temp.fid('fb'),'Production B'),
(pg_temp.fid('mud_source_a'),pg_temp.fid('fa'),'Mud source A'),
(pg_temp.fid('mud_source_b'),pg_temp.fid('fb'),'Mud source B')$q$);
select pg_temp.seed($q$insert into public.production_wage_rates(factory_id,labourer_id,rate_per_1000_bricks,effective_from) values
(pg_temp.fid('fa'),pg_temp.fid('prod_a'),100,'2026-09-01'),
(pg_temp.fid('fb'),pg_temp.fid('prod_b'),200,'2026-09-01')$q$);
select pg_temp.seed($q$insert into public.production_entries(id,factory_id,labourer_id,production_date,quantity) values
(gen_random_uuid(),pg_temp.fid('fa'),pg_temp.fid('prod_a'),'2026-09-16',3000),
(gen_random_uuid(),pg_temp.fid('fb'),pg_temp.fid('prod_b'),'2026-09-16',7000)$q$);
select pg_temp.seed($q$insert into public.production_entries(id,factory_id,labourer_id,production_date,quantity)
select gen_random_uuid(),pg_temp.fid('fa'),pg_temp.fid('mud_source_a'),date '2026-09-21'+g,1000
from generate_series(0,6) g$q$);
select pg_temp.seed($q$insert into public.production_entries(id,factory_id,labourer_id,production_date,quantity)
select gen_random_uuid(),pg_temp.fid('fb'),pg_temp.fid('mud_source_b'),date '2026-09-21'+g,2000
from generate_series(0,6) g$q$);
select pg_temp.seed($q$insert into public.withdrawals(factory_id,labourer_id,withdrawal_date,amount) values
(pg_temp.fid('fa'),pg_temp.fid('prod_a'),'2026-09-17',50),
(pg_temp.fid('fb'),pg_temp.fid('prod_b'),'2026-09-17',90)$q$);
select pg_temp.seed($q$insert into public.staff_categories(id,factory_id,name) values
(pg_temp.fid('cat_a'),pg_temp.fid('fa'),'Staff A'),(pg_temp.fid('cat_b'),pg_temp.fid('fb'),'Staff B'),
(pg_temp.fid('cat_del_a'),pg_temp.fid('fa'),'Unused A'),(pg_temp.fid('cat_del_b'),pg_temp.fid('fb'),'Unused B')$q$);
select pg_temp.seed($q$insert into public.transport_crews(id,factory_id,name) values
(pg_temp.fid('crew_a'),pg_temp.fid('fa'),'Crew A'),(pg_temp.fid('crew_b'),pg_temp.fid('fb'),'Crew B')$q$);
select pg_temp.seed($q$insert into public.transport_workers(id,factory_id,name) values
(pg_temp.fid('tw_a'),pg_temp.fid('fa'),'Transport A1'),
(pg_temp.fid('tw_a2'),pg_temp.fid('fa'),'Transport A2'),
(pg_temp.fid('tw_b'),pg_temp.fid('fb'),'Transport B')$q$);
select pg_temp.seed($q$insert into public.transport_crew_assignments(factory_id,transport_worker_id,transport_crew_id) values
(pg_temp.fid('fa'),pg_temp.fid('tw_a'),pg_temp.fid('crew_a')),
(pg_temp.fid('fa'),pg_temp.fid('tw_a2'),pg_temp.fid('crew_a')),
(pg_temp.fid('fb'),pg_temp.fid('tw_b'),pg_temp.fid('crew_b'))$q$);

-- Real scoped creation paths establish Soil/Staff/Supplier prerequisites for BOTH tenants.
do $$
declare s text;f uuid;u uuid;j jsonb;i uuid;
begin
 foreach s in array array['a','b'] loop
  f:=pg_temp.fid('f'||s);u:=pg_temp.fid('u'||s);
  j:=pg_temp.run(u,format('select * from public.create_soil_worker_with_initial_trolley_rate(%L::uuid,%L,%s,date ''2026-09-01'')',f,'Soil '||s,case s when 'a' then 10 else 30 end),true);
  i:=(j->0->>'id')::uuid;insert into pg_temp.atlas_12b2d_ids values('soil_'||s,i);
  perform pg_temp.check_it(exists(select 1 from public.soil_workers where id=i and factory_id=f and is_active)
    and exists(select 1 from public.soil_worker_trolley_rates where factory_id=f and soil_worker_id=i
      and rate_per_trolley=case s when 'a' then 10 else 30 end and effective_from='2026-09-01' and effective_to is null),
    'SO5 actual worker and initial-rate effects');
  if s='a' then perform pg_temp.pass('SO5'); end if;
  j:=pg_temp.run(u,format('select * from public.create_soil_worker_with_initial_trolley_rate(%L::uuid,%L,15,date ''2026-09-01'')',f,'Unused Soil '||s),true);
  insert into pg_temp.atlas_12b2d_ids values('soil_del_'||s,(j->0->>'id')::uuid);
  j:=pg_temp.run(u,format('select * from public.create_soil_worker_with_initial_trolley_rate(%L::uuid,%L,17,date ''2026-09-01'')',f,'Archived Soil '||s),true);
  i:=(j->0->>'id')::uuid;insert into pg_temp.atlas_12b2d_ids values('soil_restore_'||s,i);
  perform pg_temp.run(u,format('select public.archive_soil_worker(%L::uuid,%L::uuid)',f,i),true);
  j:=pg_temp.run(u,format('select * from public.create_staff_worker_with_reference_salary(%L::uuid,%L,%L::uuid,%s)',f,'Staff '||s,pg_temp.fid('cat_'||s),case s when 'a' then 1200 else 2300 end),true);
  i:=(j->0->>'id')::uuid;insert into pg_temp.atlas_12b2d_ids values('staff_'||s,i);
  perform pg_temp.check_it(exists(select 1 from public.staff_workers where id=i and factory_id=f
    and staff_category_id=pg_temp.fid('cat_'||s) and reference_salary=case s when 'a' then 1200 else 2300 end and is_active),'ST2 worker/category/salary');
  if s='a' then perform pg_temp.pass('ST2'); end if;
  j:=pg_temp.run(u,format('select * from public.create_staff_worker_with_reference_salary(%L::uuid,%L,%L::uuid,1400)',f,'Unused Staff '||s,pg_temp.fid('cat_'||s)),true);
  insert into pg_temp.atlas_12b2d_ids values('staff_del_'||s,(j->0->>'id')::uuid);
  j:=pg_temp.run(u,format('select * from public.create_staff_worker_with_reference_salary(%L::uuid,%L,%L::uuid,1600)',f,'Archived Staff '||s,pg_temp.fid('cat_'||s)),true);
  i:=(j->0->>'id')::uuid;insert into pg_temp.atlas_12b2d_ids values('staff_restore_'||s,i);
  perform pg_temp.run(u,format('select public.archive_staff_worker(%L::uuid,%L::uuid)',f,i),true);
  j:=pg_temp.run(u,format('select * from public.create_supplier(%L::uuid,%L,%L,null)',f,'Supplier '||s,'Address '||s),true);
  i:=(j->0->>'id')::uuid;insert into pg_temp.atlas_12b2d_ids values('supplier_'||s,i);
  perform pg_temp.check_it(exists(select 1 from public.suppliers where id=i and factory_id=f and name='Supplier '||s and address='Address '||s),'PE8 actual supplier profile');
  if s='a' then perform pg_temp.pass('PE8');end if;
 end loop;
end$$;

-- Positive lifecycle/master controls check actual persisted effects, not just successful return.
do $$
declare a uuid:=pg_temp.fid('fa');u uuid:=pg_temp.fid('ua');j jsonb;i uuid;
begin
 perform pg_temp.run(u,format('select public.archive_soil_worker(%L::uuid,%L::uuid)',a,pg_temp.fid('soil_a')),true);
 perform pg_temp.check_it((select not is_active from public.soil_workers where id=pg_temp.fid('soil_a')),'SO1 archive');
 perform pg_temp.pass('SO1');
 perform pg_temp.run(u,format('select public.restore_soil_worker(%L::uuid,%L::uuid)',a,pg_temp.fid('soil_restore_a')),true);
 perform pg_temp.check_it((select is_active from public.soil_workers where id=pg_temp.fid('soil_restore_a')),'SO10 restore');
 perform pg_temp.pass('SO10');
 -- Restore the account worker for real earnings setup.
 perform pg_temp.run(u,format('select public.restore_soil_worker(%L::uuid,%L::uuid)',a,pg_temp.fid('soil_a')),true);
 perform pg_temp.run(u,format('select * from public.create_soil_worker_trolley_rate(%L::uuid,%L::uuid,12,date ''2026-09-20'')',a,pg_temp.fid('soil_a')),true);
 perform pg_temp.check_it((select count(*)=2 from public.soil_worker_trolley_rates where factory_id=a and soil_worker_id=pg_temp.fid('soil_a'))
  and exists(select 1 from public.soil_worker_trolley_rates where factory_id=a and soil_worker_id=pg_temp.fid('soil_a') and rate_per_trolley=10 and effective_to='2026-09-19')
  and exists(select 1 from public.soil_worker_trolley_rates where factory_id=a and soil_worker_id=pg_temp.fid('soil_a') and rate_per_trolley=12 and effective_from='2026-09-20' and effective_to is null),'SO4 rate history');
 perform pg_temp.pass('SO4');
 perform pg_temp.run(u,format('select public.archive_staff_worker(%L::uuid,%L::uuid)',a,pg_temp.fid('staff_a')),true);
 perform pg_temp.check_it((select not is_active from public.staff_workers where id=pg_temp.fid('staff_a')),'ST1 archive');
 perform pg_temp.pass('ST1');
 perform pg_temp.run(u,format('select public.restore_staff_worker(%L::uuid,%L::uuid)',a,pg_temp.fid('staff_restore_a')),true);
 perform pg_temp.check_it((select is_active from public.staff_workers where id=pg_temp.fid('staff_restore_a')),'ST7 restore');
 perform pg_temp.pass('ST7');
 perform pg_temp.run(u,format('select public.update_staff_category(%L::uuid,%L::uuid,''Updated Staff A'')',a,pg_temp.fid('cat_a')),true);
 perform pg_temp.check_it((select name='Updated Staff A' from public.staff_categories where id=pg_temp.fid('cat_a')),'ST8 name');
 perform pg_temp.pass('ST8');
 perform pg_temp.run(u,format('select public.update_staff_reference_salary(%L::uuid,%L::uuid,1500)',a,pg_temp.fid('staff_a')),true);
 perform pg_temp.check_it((select reference_salary=1500 from public.staff_workers where id=pg_temp.fid('staff_a')),'ST9 salary');
 perform pg_temp.pass('ST9');
 j:=pg_temp.run(u,format('select * from public.create_coal_reference_value(%L::uuid,''coal_name'',''Coal A'')',a),true);
 i:=(j->0->>'id')::uuid;
 perform pg_temp.check_it(exists(select 1 from public.coal_reference_values where id=i and factory_id=a and display_value='Coal A' and kind='coal_name'),'PE3 reference');
 perform pg_temp.pass('PE3');
 -- Existing-supplier path must reuse the exact A ID and not create another supplier.
 j:=pg_temp.run(u,format('select * from public.create_or_assign_supplier_role(%L::uuid,''COAL_SELLER'',''Supplier a'',null,null)',a),true);
 perform pg_temp.check_it((j->0->>'id')::uuid=pg_temp.fid('supplier_a')
  and (select count(*)=1 from public.suppliers where factory_id=a and lower(name)='supplier a')
  and exists(select 1 from public.supplier_roles where factory_id=a and supplier_id=pg_temp.fid('supplier_a') and role='COAL_SELLER'),'PE7 reuse/assign');
 j:=pg_temp.run(u,format('select * from public.create_or_assign_supplier_role(%L::uuid,''GARAGE'',''New Garage A'',''Garage Address'',null)',a),true);
 i:=(j->0->>'id')::uuid;
 perform pg_temp.check_it(i<>pg_temp.fid('supplier_a')
  and exists(select 1 from public.suppliers where id=i and factory_id=a and name='New Garage A' and address='Garage Address')
  and exists(select 1 from public.supplier_roles where factory_id=a and supplier_id=i and role='GARAGE'),'PE7 creation/assign');
 perform pg_temp.pass('PE7');
 perform pg_temp.run(u,format('select * from public.update_supplier(%L::uuid,%L::uuid,''Updated Supplier A'',''Updated Address'',null)',a,pg_temp.fid('supplier_a')),true);
 perform pg_temp.check_it(exists(select 1 from public.suppliers where id=pg_temp.fid('supplier_a') and factory_id=a and name='Updated Supplier A' and address='Updated Address'),'PE31 profile');
 perform pg_temp.pass('PE31');
end$$;

-- Both A and B delete targets must actually be deletable.
-- B-owner probes execute real deletes inside deliberate subtransaction rollback,
-- so the subsequently attacked B fixtures are byte-for-byte unchanged.
do $$
declare s text;f uuid;u uuid;q text;j jsonb;before_b text;
begin
 foreach s in array array['a','b'] loop
  f:=pg_temp.fid('f'||s);u:=pg_temp.fid('u'||s);
  perform pg_temp.check_it(
    not exists(select 1 from public.soil_daily_trolley_entries where soil_worker_id=pg_temp.fid('soil_del_'||s))
    and not exists(select 1 from public.soil_earnings where soil_worker_id=pg_temp.fid('soil_del_'||s))
    and not exists(select 1 from public.soil_payments where soil_worker_id=pg_temp.fid('soil_del_'||s))
    and not exists(select 1 from public.soil_financial_adjustments where soil_worker_id=pg_temp.fid('soil_del_'||s))
    and not exists(select 1 from public.staff_payments where staff_worker_id=pg_temp.fid('staff_del_'||s))
    and not exists(select 1 from public.staff_workers where staff_category_id=pg_temp.fid('cat_del_'||s)),
    'all three '||s||' guarded-delete targets genuinely unused');
  before_b:=pg_temp.fhash(f);
  begin
   j:=pg_temp.run(u,format('select public.delete_unused_soil_worker(%L::uuid,%L::uuid)',f,pg_temp.fid('soil_del_'||s)),true);
   perform pg_temp.check_it((j->0->>'delete_unused_soil_worker')::uuid=pg_temp.fid('soil_del_'||s)
    and not exists(select 1 from public.soil_workers where id=pg_temp.fid('soil_del_'||s))
    and not exists(select 1 from public.soil_worker_trolley_rates where soil_worker_id=pg_temp.fid('soil_del_'||s)),
    'SO6 real deletion including setup rates');
   j:=pg_temp.run(u,format('select public.delete_staff_worker(%L::uuid,%L::uuid)',f,pg_temp.fid('staff_del_'||s)),true);
   perform pg_temp.check_it((j->0->>'delete_staff_worker')::uuid=pg_temp.fid('staff_del_'||s)
    and not exists(select 1 from public.staff_workers where id=pg_temp.fid('staff_del_'||s)),'ST4 real deletion');
   j:=pg_temp.run(u,format('select public.delete_staff_category(%L::uuid,%L::uuid)',f,pg_temp.fid('cat_del_'||s)),true);
   perform pg_temp.check_it((j->0->>'delete_staff_category')::uuid=pg_temp.fid('cat_del_'||s)
    and not exists(select 1 from public.staff_categories where id=pg_temp.fid('cat_del_'||s)),'ST3 real deletion');
   if s='b' then raise exception 'Deliberate B owner-probe rollback' using errcode='ZX001';end if;
  exception when sqlstate 'ZX001' then
   perform pg_temp.clear_identity();
  end;
  if s='a' then
   perform pg_temp.pass('SO6');perform pg_temp.pass('ST4');perform pg_temp.pass('ST3');
  else
   perform pg_temp.check_it(before_b=pg_temp.fhash(f),'B delete-probe restored entire factory');
  end if;
 end loop;
end$$;

-- TR5 real positive A, with TWO assigned A workers; B has a valid owner-created entry.
do $$
declare s text;f uuid;u uuid;j jsonb;workers uuid[];qty numeric;
begin
 foreach s in array array['a','b'] loop
  f:=pg_temp.fid('f'||s);u:=pg_temp.fid('u'||s);
  workers:=case s when 'a' then array[pg_temp.fid('tw_a'),pg_temp.fid('tw_a2')] else array[pg_temp.fid('tw_b')] end;
  qty:=case s when 'a' then 2 else 3 end;
  j:=pg_temp.run(u,format('select * from public.save_transport_daily_entry(%L::uuid,%L::uuid,date ''2026-09-21'',%s,%L::uuid[])',f,pg_temp.fid('crew_'||s),qty,workers),true);
  insert into pg_temp.atlas_12b2d_ids values('entry_'||s,(j->0->>'daily_entry_id')::uuid);
  perform pg_temp.check_it(
   (j->0->>'attendance_count')::integer=cardinality(workers) and (j->0->>'saved_paya_quantity')::numeric=qty
   and exists(select 1 from public.transport_daily_entries where id=pg_temp.fid('entry_'||s) and factory_id=f and transport_crew_id=pg_temp.fid('crew_'||s) and work_date='2026-09-21' and paya_quantity=qty)
   and (select count(*)=cardinality(workers) from public.transport_daily_attendance where factory_id=f and transport_daily_entry_id=pg_temp.fid('entry_'||s))
   and not exists(select 1 from public.transport_daily_attendance where factory_id=f and transport_daily_entry_id=pg_temp.fid('entry_'||s)
     and (transport_worker_id<>all(workers) or transport_crew_id<>pg_temp.fid('crew_'||s) or work_date<>'2026-09-21')),
   'TR5 real entry and exact attendance evidence '||s);
  if s='a' then perform pg_temp.pass('TR5');end if;
 end loop;
end$$;

-- Real account-source writer paths in previously tested scope.
-- No synthetic read returns or direct settlement-mode bypass.
do $$
declare s text;f uuid;u uuid;j jsonb;r numeric;g uuid;qty numeric;
begin
 foreach s in array array['a','b'] loop
  f:=pg_temp.fid('f'||s);u:=pg_temp.fid('u'||s);
  perform pg_temp.run(u,format('select * from public.initialize_cash_book(%L::uuid,date ''2026-09-01'',10000)',f),true);
  r:=case s when 'a' then 100 else 200 end;
  j:=pg_temp.run(u,format('select public.create_mud_group(%L::uuid,%L,5,date ''2026-09-21'',%s,date ''2026-09-21'')',f,'Mud '||s,r),true);
  g:=(j->0->>'create_mud_group')::uuid;insert into pg_temp.atlas_12b2d_ids values('mud_'||s,g);
  perform pg_temp.run(u,format('select * from public.set_mud_supply_rate(%L::uuid,%s,date ''2026-09-21'')',f,r),true);
  perform pg_temp.run(u,format('select * from public.calculate_mud_supply_wages(%L::uuid,%L::uuid,date ''2026-09-21'')',f,g),true);
  perform pg_temp.check_it(exists(select 1 from public.weekly_earnings where factory_id=f and labour_group_id=g and amount=case s when 'a' then 700 else 2800 end),'distinct real legacy Mud earnings');
  perform pg_temp.run(u,format('select * from public.create_labour_group_withdrawal(%L::uuid,%L::uuid,date ''2026-09-27'',%s)',f,g,case s when 'a' then 100 else 200 end),true);
  perform pg_temp.run(u,format('select * from public.transition_mud_accounting_mode(%L::uuid,''SHADOW'')',f),true);
  perform pg_temp.run(u,format('select * from public.execute_mud_settlement_cutover(%L::uuid,date ''2026-09-27'')',f),true);
  perform pg_temp.check_it(exists(select 1 from public.mud_accounting_states where factory_id=f and accounting_mode='SETTLEMENT')
    and exists(select 1 from public.mud_group_legacy_openings where factory_id=f and labour_group_id=g
      and locked_weekly_earned=case s when 'a' then 700 else 2800 end),'real Mud cutover and distinct opening');
  qty:=case s when 'a' then 10 else 20 end;
  perform pg_temp.run(u,format('select * from public.save_soil_daily_trolley_entries(%L::uuid,date ''2026-09-20'',%L::jsonb)',f,
    jsonb_build_array(jsonb_build_object('soil_worker_id',pg_temp.fid('soil_'||s),'trolley_quantity',qty))::text),true);
  perform pg_temp.run(u,format('select * from public.create_soil_financial_adjustment(%L::uuid,%L::uuid,''ADDITION'',date ''2026-09-20'',%s,''Verifier addition'')',f,pg_temp.fid('soil_'||s),case s when 'a' then 20 else 70 end),true);
  perform pg_temp.run(u,format('select * from public.create_soil_financial_adjustment(%L::uuid,%L::uuid,''DEDUCTION'',date ''2026-09-20'',%s,''Verifier deduction'')',f,pg_temp.fid('soil_'||s),case s when 'a' then 5 else 15 end),true);
  perform pg_temp.run(u,format('select * from public.create_soil_payment(%L::uuid,%L::uuid,date ''2026-09-20'',%s)',f,pg_temp.fid('soil_'||s),case s when 'a' then 10 else 40 end),true);
  perform pg_temp.run(u,format('select * from public.create_transport_crew_wage_rate(%L::uuid,%L::uuid,date ''2026-09-21'',%s)',f,pg_temp.fid('crew_'||s),case s when 'a' then 100 else 300 end),true);
  perform pg_temp.run(u,format('select * from public.calculate_transport_weekly_wages(%L::uuid,date ''2026-09-21'')',f),true);
  perform pg_temp.run(u,format('select * from public.create_transport_worker_withdrawal(%L::uuid,%L::uuid,date ''2026-09-27'',%s)',f,pg_temp.fid('tw_'||s),case s when 'a' then 10 else 70 end),true);
 end loop;
end$$;

-- Sensitive positives execute BOTH tenant contexts and assert exact, distinct values.
-- Common zeros/cutoff dates are not treated as discriminators; every monetary discriminator differs.
do $$
declare s text;f uuid;u uuid;j jsonb;expected jsonb;r numeric;
begin
 foreach s in array array['a','b'] loop
  f:=pg_temp.fid('f'||s);u:=pg_temp.fid('u'||s);
  j:=pg_temp.run(u,format('select * from public.get_production_labourer_account(%L::uuid,%L::uuid,date ''2026-09-29'')',f,pg_temp.fid('prod_'||s)));
  expected:=case s when 'a' then '{"settled_earned":0,"live_earned":300,"total_earned":300,"total_withdrawn":50,"available_balance":250,"latest_settlement_cutoff":null}'::jsonb
    else '{"settled_earned":0,"live_earned":1400,"total_earned":1400,"total_withdrawn":90,"available_balance":1310,"latest_settlement_cutoff":null}'::jsonb end;
  perform pg_temp.check_it(j=jsonb_build_array(expected),'PR9 exact distinct account '||s);
  if s='a' then perform pg_temp.pass('PR9');end if;
  j:=pg_temp.run(u,format('select * from public.get_mud_group_settlement_account(%L::uuid,%L::uuid,date ''2026-09-29'')',f,pg_temp.fid('mud_'||s)));
  expected:=case s when 'a' then '{"settled_earned":700,"live_earned":0,"total_earned":700,"total_withdrawn":100,"available_balance":600,"latest_settlement_cutoff":"2026-09-27"}'::jsonb
    else '{"settled_earned":2800,"live_earned":0,"total_earned":2800,"total_withdrawn":200,"available_balance":2600,"latest_settlement_cutoff":"2026-09-27"}'::jsonb end;
  perform pg_temp.check_it(j=jsonb_build_array(expected),'MU10 exact distinct settlement account '||s);
  if s='a' then perform pg_temp.pass('MU10');end if;
  j:=pg_temp.run(u,format('select * from public.get_soil_financial_summary(%L::uuid,%L::uuid)',f,pg_temp.fid('soil_'||s)));
  expected:=case s when 'a' then '{"total_earned":120,"total_additions":20,"total_deductions":5,"total_paid":10,"available_balance":125}'::jsonb
    else '{"total_earned":600,"total_additions":70,"total_deductions":15,"total_paid":40,"available_balance":615}'::jsonb end;
  perform pg_temp.check_it(j=jsonb_build_array(expected),'SO7 exact distinct financial summary '||s);
  if s='a' then perform pg_temp.pass('SO7');end if;
  j:=pg_temp.run(u,format('select * from public.get_soil_total_earned(%L::uuid,%L::uuid)',f,pg_temp.fid('soil_'||s)));
  perform pg_temp.check_it(j=jsonb_build_array(jsonb_build_object('total_earned',case s when 'a' then 120 else 600 end)),'SO8 exact distinct earnings '||s);
  if s='a' then perform pg_temp.pass('SO8');end if;
  j:=pg_temp.run(u,format('select * from public.resolve_soil_worker_trolley_rate(%L::uuid,%L::uuid,date ''2026-09-20'')',f,pg_temp.fid('soil_'||s)));
  r:=case s when 'a' then 12 else 30 end;
  perform pg_temp.check_it(jsonb_array_length(j)=1 and (j->0->>'rate_per_trolley')::numeric=r
    and (j->0->>'factory_id')::uuid=f and (j->0->>'soil_worker_id')::uuid=pg_temp.fid('soil_'||s)
    and j=jsonb_build_array((select to_jsonb(t) from public.soil_worker_trolley_rates t where id=(j->0->>'id')::uuid)),'SO9 exact distinct rate '||s);
  j:=pg_temp.run(u,format('select * from public.get_transport_worker_available_balance(%L::uuid,%L::uuid,date ''2026-09-29'')',f,pg_temp.fid('tw_'||s)));
  expected:=case s when 'a' then '{"total_earned":100,"total_withdrawn":10,"available_balance":90}'::jsonb
    else '{"total_earned":900,"total_withdrawn":70,"available_balance":830}'::jsonb end;
  perform pg_temp.check_it(j=jsonb_build_array(expected),'TR4 exact distinct available balance '||s);
  if s='a' then perform pg_temp.pass('SO9');perform pg_temp.pass('TR4');end if;
 end loop;
end$$;

-- Run all planned direct, mixed and reverse attacks only after valid A positives.
do $$
declare r record;
begin
 perform pg_temp.check_it((select count(*)=23 from pg_temp.atlas_12b2d_pass),'all 23 positive signatures executed');
 for r in select * from atlas_12b2d_plan where category<>'INACTIVE' order by category,label loop
  perform pg_temp.reject(r.id,r.label,r.q,r.code,r.message,pg_temp.fid(r.user_key));
 end loop;
 perform pg_temp.check_it(
  not exists(select 1 from public.transport_daily_entries where factory_id in(pg_temp.fid('fa'),pg_temp.fid('fb')) and work_date='2026-09-22')
  and not exists(select 1 from public.transport_daily_attendance where factory_id in(pg_temp.fid('fa'),pg_temp.fid('fb')) and work_date='2026-09-22'),
  'TR5 no partial entry/attendance on virgin mixed-array date');
 perform pg_temp.check_it(
  exists(select 1 from public.soil_workers where id=pg_temp.fid('soil_del_b'))
  and exists(select 1 from public.staff_workers where id=pg_temp.fid('staff_del_b'))
  and exists(select 1 from public.staff_categories where id=pg_temp.fid('cat_del_b')),
  'all genuinely deletable B targets retained');
end$$;

-- Same exact valid call before/after membership deactivation.
do $$
declare r record;j jsonb;
begin
 for r in select * from atlas_12b2d_plan where category='INACTIVE' order by label loop
  if r.id='TR5' then
   -- Keep finalized September 21 finances intact; compare authorization in the next writable week.
   perform pg_temp.check_it(
    not exists(select 1 from public.transport_weekly_earnings where factory_id=pg_temp.fid('fa') and week_start='2026-09-28')
    and not exists(select 1 from public.transport_daily_entries where factory_id=pg_temp.fid('fa') and transport_crew_id=pg_temp.fid('crew_a') and work_date='2026-09-28'),
    'active/inactive daily-entry comparison has an unfinalized, unused source date');
  end if;
  j:=pg_temp.run(pg_temp.fid('ua'),r.q,r.id<>'PR9');
  if r.id='SO5' then
   perform pg_temp.check_it(exists(select 1 from public.soil_workers where id=(j->0->>'id')::uuid and factory_id=pg_temp.fid('fa') and name='Inactive repeat Soil'),'active Soil repeat succeeds');
  elsif r.id='ST9' then
   perform pg_temp.check_it((select reference_salary=1500 from public.staff_workers where id=pg_temp.fid('staff_a')),'active salary repeat succeeds');
  elsif r.id='TR5' then
   perform pg_temp.check_it((j->0->>'attendance_count')::integer=2 and (j->0->>'saved_paya_quantity')::numeric=2
    and exists(select 1 from public.transport_daily_entries where id=(j->0->>'daily_entry_id')::uuid and factory_id=pg_temp.fid('fa') and transport_crew_id=pg_temp.fid('crew_a') and work_date='2026-09-28' and paya_quantity=2)
    and (select count(*)=2 from public.transport_daily_attendance where factory_id=pg_temp.fid('fa') and transport_daily_entry_id=(j->0->>'daily_entry_id')::uuid)
    and not exists(select 1 from public.transport_daily_attendance where transport_daily_entry_id=(j->0->>'daily_entry_id')::uuid
      and (factory_id<>pg_temp.fid('fa') or transport_crew_id<>pg_temp.fid('crew_a') or work_date<>'2026-09-28' or transport_worker_id<>all(array[pg_temp.fid('tw_a'),pg_temp.fid('tw_a2')]))),
    'active daily-entry repeat succeeds');
  else
   perform pg_temp.check_it((j->0->>'total_earned')::numeric=300 and (j->0->>'available_balance')::numeric=250,'active account repeat succeeds');
  end if;
 end loop;
 perform pg_temp.clear_identity();
 update public.factory_users set is_active=false
 where user_id=pg_temp.fid('ua') and factory_id=pg_temp.fid('fa');
 perform pg_temp.check_it((select not is_active from public.factory_users where user_id=pg_temp.fid('ua')),'membership deactivated');
 for r in select * from atlas_12b2d_plan where category='INACTIVE' order by label loop
  perform pg_temp.reject(r.id,r.label,r.q,r.code,r.message);
 end loop;
 -- Fail loudly if any planned test did not execute or used an incidental error class.
 perform pg_temp.check_it(
  (select count(*)=23 from atlas_12b2d_pass)
  and not exists(select 1 from atlas_12b2d_manifest m where not exists(select 1 from atlas_12b2d_pass p where p.id=m.id))
  and (select count(*) from atlas_12b2d_rejections)=(select count(*) from atlas_12b2d_plan)
  and not exists(select 1 from atlas_12b2d_plan p left join atlas_12b2d_rejections rejected on rejected.label=p.label
    where rejected.label is null or rejected.id<>p.id or rejected.code<>p.code or rejected.class<>p.message),
  'complete executed positive and rejection ledger');
end$$;
select pg_temp.clear_identity();
rollback;

-- Persistent proof: all 64 public tables AND auth.users unchanged in count AND full-row hash.
-- E7A: validate the preserved baseline before any cleanup comparison.
do $baseline_guard$
begin
  if pg_catalog.to_regclass('pg_temp.atlas_12b2d_baseline') is null then
    raise exception 'FAIL: preserved cleanup baseline is missing';
  end if;
  if exists (select 1 from pg_temp.atlas_12b2d_baseline
    where s is null or t is null or c is null or h is null) then
    raise exception 'FAIL: cleanup baseline has NULL identity, count or fingerprint';
  end if;
  if exists (select 1 from pg_temp.atlas_12b2d_baseline
    group by s,t having count(*) > 1) then
    raise exception 'FAIL: cleanup baseline has duplicate identities';
  end if;
  if (select count(*) from pg_catalog.pg_class c
    join pg_catalog.pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public' and c.relkind in ('r','p')) <> 64 then
    raise exception 'FAIL: cleanup catalog must contain exactly 64 public tables';
  end if;
  if (select count(*) from pg_temp.atlas_12b2d_baseline) <> 65
    or (select count(distinct t) from pg_temp.atlas_12b2d_baseline
      where s = 'public') <> 64
    or (select count(*) from pg_temp.atlas_12b2d_baseline
      where s = 'auth' and t = 'users') <> 1 then
    raise exception 'FAIL: cleanup baseline requires 64 public identities plus one auth.users identity';
  end if;
  if exists (
    with expected as (
      select ns.nspname::text as schema_name,c.relname::text as table_name
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace ns on ns.oid = c.relnamespace
      where ns.nspname = 'public' and c.relkind in ('r','p')
      union all select 'auth','users'
    ), actual as (
      select s as schema_name,t as table_name
      from pg_temp.atlas_12b2d_baseline
    )
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  ) then
    raise exception 'FAIL: cleanup baseline identities differ from the catalog plus auth.users';
  end if;
end;
$baseline_guard$;

do $$
declare r record;n bigint;h text;
begin
 for r in select * from atlas_12b2d_baseline order by s,t loop
  execute format('select count(*),md5(coalesce(jsonb_agg(to_jsonb(q) order by to_jsonb(q)::text),''[]'')::text) from %I.%I q',r.s,r.t) into n,h;
  if n<>r.c or h is distinct from r.h then raise exception 'FAIL rollback mismatch %.%',r.s,r.t;end if;
 end loop;
 if exists(select 1 from auth.users where id in('12f00000-0000-4000-8000-000000000001','12f00000-0000-4000-8000-000000000002'))
 or exists(select 1 from public.factories where name in('Atlas 12B2D A','Atlas 12B2D B')) then
  raise exception 'FAIL synthetic fixtures remain';
 end if;
end$$;

-- These are NONTRANSACTIONAL SESSION-ONLY execution counters, not guessed totals.
-- Any missing positive/case/rollback assertion above prevents this successful result.
select
 (select count(*) from atlas_12b2d_manifest) as scoped_live_rpcs,
 (select case when is_called then last_value else 0 end from atlas_12b2d_positive) as executed_and_passed,
 0 as not_proven,0 as not_exercised,0 as failed,
 (select case when is_called then last_value else 0 end from atlas_12b2d_writers) as real_writer_rpc_successful_invocations,
 0 as authenticated_direct_write_fixture_rows,
 (select case when is_called then last_value else 0 end from atlas_12b2d_triggers) as trigger_generated_fixture_rows,
 (select case when is_called then last_value else 0 end from atlas_12b2d_privileged) as privileged_setup_fixture_rows,
 (select case when is_called then last_value else 0 end from atlas_12b2d_rejected) as rejected_calls_with_full_a_b_snapshot_proof,
 (select jsonb_object_agg(category,n) from (select category,count(*) n from atlas_12b2d_plan group by category) x) as attack_counts,
 23 as security_definer,23 as authenticated_execute,0 as anon_execute,0 as public_execute,
 64 as public_tables_restored,true as auth_users_restored,true as full_row_hashes_restored,
 77 as rpc_coverage_before,100 as rpc_coverage_after,123 as rpc_inventory,23 as remaining,
 (select jsonb_agg(jsonb_build_object('id',m.id,'signature',m.fn||'('||m.args||')',
   'status','EXECUTED + PASSED','barrier',m.barrier) order by m.id) from atlas_12b2d_manifest m) as barrier_matrix,
 (select jsonb_agg(jsonb_build_object('id',p.id,'test',p.label,'code',p.code,'class',p.message)
   order by p.category,p.label) from atlas_12b2d_plan p) as executed_rejection_classes,
 '12B2E: read/report + disabled compatibility surface; financial concurrency/double-submit is a separate milestone.' as next_ledger;
