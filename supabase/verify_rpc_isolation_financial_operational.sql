-- Atlas Security 12B2C: rollback-only isolation proof for 24 financial/operational RPCs.
create temporary table atlas_12b2c_manifest(id text primary key,fn text not null,args text not null,barrier text not null,unique(fn,args)) on commit preserve rows;
insert into atlas_12b2c_manifest values
('PE14','create_vehicle_maintenance_payment','p_factory_id uuid, p_maintenance_id uuid, p_payment_date date, p_amount numeric, p_payment_mode text, p_note text','membership; maintenance id plus factory; checked expense-payment delegate'),
('PE29','update_coal_purchase','p_factory_id uuid, p_purchase_id uuid, p_purchase_date date, p_seller_id uuid, p_coal_name_reference_id uuid, p_source_reference_id uuid, p_coal_challan_number text, p_vehicle_number text, p_quantity numeric, p_rate numeric, p_coal_amount numeric, p_separate_freight_amount numeric','membership; purchase/seller/references plus factory; checked expense update'),
('PE30','update_expense_record','p_factory_id uuid, p_expense_record_id uuid, p_business_date date, p_kind text, p_supplier_id uuid, p_counterparty_name text, p_description text, p_total_amount numeric, p_note text','membership; expense/supplier plus factory'),
('PE32','update_vehicle_fuel','p_factory_id uuid, p_fuel_record_id uuid, p_fuel_date date, p_fuel_time time without time zone, p_vehicle_id uuid, p_pump_id uuid, p_fuel_type text, p_litres numeric, p_rate_per_litre numeric, p_fuel_amount numeric','membership; fuel/vehicle/pump plus factory; checked expense update'),
('PE33','update_vehicle_maintenance','p_factory_id uuid, p_maintenance_id uuid, p_maintenance_date date, p_vehicle_id uuid, p_garage_id uuid, p_work_description text, p_total_amount numeric','membership; maintenance/vehicle/garage plus factory; checked expense update'),
('PE34','void_coal_purchase','p_factory_id uuid, p_purchase_id uuid','membership; purchase plus factory; checked expense void'),
('PE35','void_expense_record','p_factory_id uuid, p_expense_record_id uuid','membership; expense plus factory'),
('PE36','void_vehicle_fuel','p_factory_id uuid, p_fuel_record_id uuid','membership; fuel plus factory; checked expense void'),
('PE37','void_vehicle_maintenance','p_factory_id uuid, p_maintenance_id uuid','membership; maintenance plus factory; checked expense void'),
('PR1','assign_labourer_to_production_crew','p_factory_id uuid, p_labourer_id uuid, p_production_crew_id uuid, p_effective_from date','membership; labourer and crew plus factory'),
('PR3','create_labourer_production_wage_rate_override','p_factory_id uuid, p_labourer_id uuid, p_rate_per_1000_bricks numeric, p_effective_from date','checked set_production_labourer_rates delegate'),
('PR6','create_production_crew_wage_rate','p_factory_id uuid, p_production_crew_id uuid, p_rate_per_1000_bricks numeric, p_effective_from date','membership; crew plus factory'),
('PR7','create_wage_rate','p_factory_id uuid, p_applies_to text, p_rate_per_1000_bricks numeric, p_effective_from date','membership; factory-scoped wage history'),
('PR8','end_labourer_production_crew_assignment','p_factory_id uuid, p_labourer_id uuid, p_effective_to date','membership; labourer and open assignment plus factory'),
('PR11','set_production_labourer_origin','p_factory_id uuid, p_labourer_id uuid, p_origin_label text','membership; labourer plus factory'),
('PR12','set_production_labourer_rates','p_factory_id uuid, p_labourer_ids uuid[], p_rate_per_1000_bricks numeric, p_effective_from date','membership; every array labourer active and in factory before writes'),
('MU3','create_mud_group','p_factory_id uuid, p_name text, p_member_count integer, p_earning_start_date date, p_initial_rate numeric, p_rate_effective_date date','membership; inserts factory-scoped group/term/rate'),
('MU13','restart_mud_group_earning','p_factory_id uuid, p_labour_group_id uuid, p_member_count integer, p_restart_date date','membership; group/rate plus factory'),
('MU14','set_mud_group_member_count','p_factory_id uuid, p_labour_group_id uuid, p_member_count integer, p_effective_from date','membership; group/term plus factory'),
('MU15','set_mud_group_rate','p_factory_id uuid, p_labour_group_id uuid, p_rate_per_1000_bricks numeric, p_effective_from date','membership; group/rate plus factory'),
('MU16','set_mud_supply_rate','p_factory_id uuid, p_rate_per_1000_bricks numeric, p_effective_from date','membership; factory-scoped wage history'),
('MU17','stop_mud_group_earning','p_factory_id uuid, p_labour_group_id uuid, p_stop_date date','membership; group/term plus factory'),
('MU18','transition_mud_accounting_mode','p_factory_id uuid, p_new_mode mud_accounting_mode','membership; factory-scoped accounting state and transition ledger'),
('TR2','create_transport_crew_wage_rate','p_factory_id uuid, p_transport_crew_id uuid, p_effective_from date, p_rate_per_paya numeric','membership; transport crew/rate plus factory');

create temporary table atlas_12b2c_counts(s text,t text,c bigint,h text,primary key(s,t)) on commit preserve rows;
do $$declare r record;n bigint;h text;begin
 if (select count(*) from atlas_12b2c_manifest)<>24 then raise exception 'FAIL manifest';end if;
 for r in select 'public'::text s,c.relname::text t from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in('r','p') union all select 'auth','users' loop execute format('select count(*),md5(coalesce(jsonb_agg(to_jsonb(q) order by to_jsonb(q)::text),''[]'')::text) from %I.%I q',r.s,r.t) into n,h;insert into atlas_12b2c_counts values(r.s,r.t,n,h);end loop;
 if (select count(*) from atlas_12b2c_counts where s='public')<>64 or (select count(*) from atlas_12b2c_counts)<>65 then raise exception 'FAIL 64 public tables plus auth.users required';end if;
end$$;
commit;begin;
create temporary table atlas_12b2c_ids(k text primary key,id uuid not null) on commit drop;grant all on atlas_12b2c_ids to authenticated;
create function pg_temp.fid(k text) returns uuid language sql stable as $$select id from pg_temp.atlas_12b2c_ids where atlas_12b2c_ids.k=fid.k$$;
create function pg_temp.identity(u uuid,l text) returns void language plpgsql as $$begin if current_user<>'authenticated' or auth.uid() is distinct from u then raise exception 'FAIL identity %',l;end if;end$$;
create function pg_temp.fhash(f uuid) returns text language plpgsql stable security definer set search_path=pg_catalog,public as $$declare r record;j jsonb:='{}';x jsonb;begin for r in select distinct table_name from information_schema.columns where table_schema='public' and column_name='factory_id' order by 1 loop execute format('select coalesce(jsonb_agg(to_jsonb(q) order by to_jsonb(q)::text),''[]'') from public.%I q where factory_id=$1',r.table_name) into x using f;j:=j||jsonb_build_object(r.table_name,x);end loop;return md5(j::text);end$$;
create function pg_temp.reject(l text,q text,st text,msg text) returns void language plpgsql as $$declare a uuid:=pg_temp.fid('fa');b uuid:=pg_temp.fid('fb');ha text:=pg_temp.fhash(a);hb text:=pg_temp.fhash(b);sa text;sb text;gs text;gm text;ok boolean:=false;begin execute 'set local role authenticated';perform set_config('request.jwt.claim.sub',pg_temp.fid('ua')::text,true);perform pg_temp.identity(pg_temp.fid('ua'),l);begin execute q;ok:=true;exception when others then gs:=sqlstate;gm:=sqlerrm;end;execute 'reset role';perform set_config('request.jwt.claim.sub','',true);if ok or gs<>st or (msg is not null and gm!~msg) then raise exception 'FAIL % incidental/success state=% msg=%',l,gs,gm;end if;sa:=pg_temp.fhash(a);sb:=pg_temp.fhash(b);if ha is distinct from sa or hb is distinct from sb then raise exception 'FAIL % mutated A/B',l;end if;raise notice 'PASS [%] %',gs,l;end$$;

do $$declare n int;begin
 select count(*) into n from pg_proc p join pg_namespace s on s.oid=p.pronamespace join atlas_12b2c_manifest m on m.fn=p.proname and m.args=pg_get_function_identity_arguments(p.oid) where s.nspname='public';if n<>24 then raise exception 'FAIL live %/24',n;end if;
 if exists(select 1 from pg_proc p join pg_namespace s on s.oid=p.pronamespace join atlas_12b2c_manifest m on m.fn=p.proname and m.args=pg_get_function_identity_arguments(p.oid) where s.nspname='public' and(not p.prosecdef or not has_function_privilege('authenticated',p.oid,'EXECUTE') or has_function_privilege('anon',p.oid,'EXECUTE') or not(p.proconfig@>array['search_path=pg_catalog, public']) or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))g where g.grantee=0 and g.privilege_type='EXECUTE')))then raise exception 'FAIL grants';end if;
end$$;
reset role;select set_config('request.jwt.claim.sub','',true);
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)values
('12e00000-0000-4000-8000-000000000001','authenticated','authenticated','atlas-12b2c-a@example.invalid',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),('12e00000-0000-4000-8000-000000000002','authenticated','authenticated','atlas-12b2c-b@example.invalid',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());
insert into atlas_12b2c_ids values('ua','12e00000-0000-4000-8000-000000000001'),('ub','12e00000-0000-4000-8000-000000000002');
set local role authenticated;select set_config('request.jwt.claim.sub',pg_temp.fid('ua')::text,true);do $$declare r record;begin select * into r from public.provision_first_factory('Atlas 12B2C A');insert into pg_temp.atlas_12b2c_ids values('fa',r.factory_id);end$$;reset role;select set_config('request.jwt.claim.sub','',true);
set local role authenticated;select set_config('request.jwt.claim.sub',pg_temp.fid('ub')::text,true);do $$declare r record;begin select * into r from public.provision_first_factory('Atlas 12B2C B');insert into pg_temp.atlas_12b2c_ids values('fb',r.factory_id);end$$;reset role;select set_config('request.jwt.claim.sub','',true);

-- Deterministic parents; scoped writers remain real authenticated calls.
do $$declare a uuid:=pg_temp.fid('fa');b uuid:=pg_temp.fid('fb');begin
 insert into atlas_12b2c_ids values('la1','12e10000-0000-4000-8000-000000000001'),('la2','12e10000-0000-4000-8000-000000000002'),('lb1','12e10000-0000-4000-8000-000000000011'),('ca','12e20000-0000-4000-8000-000000000001'),('cb','12e20000-0000-4000-8000-000000000002'),('ta','12e30000-0000-4000-8000-000000000001'),('tb','12e30000-0000-4000-8000-000000000002'),('va','12e40000-0000-4000-8000-000000000001'),('vb','12e40000-0000-4000-8000-000000000002'),('sa','12e50000-0000-4000-8000-000000000001'),('sb','12e50000-0000-4000-8000-000000000002'),('pa','12e50000-0000-4000-8000-000000000011'),('pb','12e50000-0000-4000-8000-000000000012'),('ga','12e50000-0000-4000-8000-000000000021'),('gb','12e50000-0000-4000-8000-000000000022'),('na','12e60000-0000-4000-8000-000000000001'),('nb','12e60000-0000-4000-8000-000000000002'),('ra','12e60000-0000-4000-8000-000000000011'),('rb','12e60000-0000-4000-8000-000000000012');
 insert into public.labourers(id,factory_id,name)values(pg_temp.fid('la1'),a,'Lab A1'),(pg_temp.fid('la2'),a,'Lab A2'),(pg_temp.fid('lb1'),b,'Lab B1');
 insert into public.production_crews(id,factory_id,name)values(pg_temp.fid('ca'),a,'Crew A'),(pg_temp.fid('cb'),b,'Crew B');
 insert into public.transport_crews(id,factory_id,name)values(pg_temp.fid('ta'),a,'Transport A'),(pg_temp.fid('tb'),b,'Transport B');
 insert into public.vehicles(id,factory_id,vehicle_number,normalized_vehicle_number)values(pg_temp.fid('va'),a,'AT12C001','AT12C001'),(pg_temp.fid('vb'),b,'AT12C002','AT12C002');
 insert into public.suppliers(id,factory_id,name)values(pg_temp.fid('sa'),a,'Seller A'),(pg_temp.fid('sb'),b,'Seller B'),(pg_temp.fid('pa'),a,'Pump A'),(pg_temp.fid('pb'),b,'Pump B'),(pg_temp.fid('ga'),a,'Garage A'),(pg_temp.fid('gb'),b,'Garage B');
 insert into public.supplier_roles(factory_id,supplier_id,role,created_by)values(a,pg_temp.fid('sa'),'COAL_SELLER',pg_temp.fid('ua')),(b,pg_temp.fid('sb'),'COAL_SELLER',pg_temp.fid('ub')),(a,pg_temp.fid('pa'),'FUEL_PUMP',pg_temp.fid('ua')),(b,pg_temp.fid('pb'),'FUEL_PUMP',pg_temp.fid('ub')),(a,pg_temp.fid('ga'),'GARAGE',pg_temp.fid('ua')),(b,pg_temp.fid('gb'),'GARAGE',pg_temp.fid('ub'));
 insert into public.coal_reference_values(id,factory_id,kind,display_value,created_by)values(pg_temp.fid('na'),a,'coal_name','Coal A',pg_temp.fid('ua')),(pg_temp.fid('nb'),b,'coal_name','Coal B',pg_temp.fid('ub')),(pg_temp.fid('ra'),a,'source_location','Source A',pg_temp.fid('ua')),(pg_temp.fid('rb'),b,'source_location','Source B',pg_temp.fid('ub'));
end$$;

-- Build valid financial parents through already-proven writer RPCs.
set local role authenticated;select set_config('request.jwt.claim.sub',pg_temp.fid('ua')::text,true);select pg_temp.identity(pg_temp.fid('ua'),'A fixtures');
do $$declare a uuid:=pg_temp.fid('fa');c public.coal_purchase_detail;e public.expense_records%rowtype;f public.vehicle_fuel_detail;m public.vehicle_maintenance_detail;i int;begin
 for i in 1..2 loop select * into c from public.create_coal_purchase(a,'2026-09-20',pg_temp.fid('sa'),pg_temp.fid('na'),pg_temp.fid('ra'),'C-A-'||i,'AT12C001',10,10,null,0,0,null);insert into pg_temp.atlas_12b2c_ids values(case i when 1 then'coal_up_a'else'coal_void_a'end,c.id);end loop;
 for i in 1..3 loop select * into e from public.create_expense_record(a,'2026-09-20','expense',pg_temp.fid('sa'),null,'Expense A '||i,100,null);insert into pg_temp.atlas_12b2c_ids values(case i when 1 then'exp_up_a'when 2 then'exp_void_a'else'exp_inactive_a'end,e.id);end loop;
 for i in 1..2 loop select * into f from public.create_vehicle_fuel(a,'2026-09-20',('08:0'||i)::time,pg_temp.fid('va'),pg_temp.fid('pa'),'Diesel',10,10,null,0,null);insert into pg_temp.atlas_12b2c_ids values(case i when 1 then'fuel_up_a'else'fuel_void_a'end,f.id);end loop;
 for i in 1..3 loop select * into m from public.create_vehicle_maintenance(a,'2026-09-20',pg_temp.fid('va'),pg_temp.fid('ga'),'Repair A '||i,100,0,null);insert into pg_temp.atlas_12b2c_ids values(case i when 1 then'maint_pay_a'when 2 then'maint_up_a'else'maint_void_a'end,m.id);end loop;
end$$;reset role;select set_config('request.jwt.claim.sub','',true);
set local role authenticated;select set_config('request.jwt.claim.sub',pg_temp.fid('ub')::text,true);select pg_temp.identity(pg_temp.fid('ub'),'B fixtures');
do $$declare b uuid:=pg_temp.fid('fb');c public.coal_purchase_detail;e public.expense_records%rowtype;f public.vehicle_fuel_detail;m public.vehicle_maintenance_detail;g uuid;begin
 select * into c from public.create_coal_purchase(b,'2026-09-20',pg_temp.fid('sb'),pg_temp.fid('nb'),pg_temp.fid('rb'),'C-B','AT12C002',10,10,null,0,0,null);insert into pg_temp.atlas_12b2c_ids values('coal_b',c.id);
 select * into e from public.create_expense_record(b,'2026-09-20','expense',pg_temp.fid('sb'),null,'Expense B',100,null);insert into pg_temp.atlas_12b2c_ids values('exp_b',e.id);
 select * into f from public.create_vehicle_fuel(b,'2026-09-20','08:00',pg_temp.fid('vb'),pg_temp.fid('pb'),'Diesel',10,10,null,0,null);insert into pg_temp.atlas_12b2c_ids values('fuel_b',f.id);
 select * into m from public.create_vehicle_maintenance(b,'2026-09-20',pg_temp.fid('vb'),pg_temp.fid('gb'),'Repair B',100,0,null);insert into pg_temp.atlas_12b2c_ids values('maint_b',m.id);
 g:=public.create_mud_group(b,'Mud B',5,'2026-09-01',100,'2026-09-01');insert into pg_temp.atlas_12b2c_ids values('mud_b',g);
end$$;reset role;select set_config('request.jwt.claim.sub','',true);

-- All 24 A positive controls with authoritative effects.
set local role authenticated;select set_config('request.jwt.claim.sub',pg_temp.fid('ua')::text,true);select pg_temp.identity(pg_temp.fid('ua'),'positives');
do $$declare a uuid:=pg_temp.fid('fa');g uuid;r record;begin
 perform public.create_vehicle_maintenance_payment(a,pg_temp.fid('maint_pay_a'),'2026-09-20',10,'cash','positive');if(select sum(allocated_amount)from public.expense_payment_allocations where expense_record_id=pg_temp.fid('maint_pay_a'))<>10 then raise exception'FAIL PE14';end if;
 perform public.update_coal_purchase(a,pg_temp.fid('coal_up_a'),'2026-09-21',pg_temp.fid('sa'),pg_temp.fid('na'),pg_temp.fid('ra'),'UPDATED','AT12C001',12,10,null,0);if(select total_amount from public.expense_records where id=pg_temp.fid('coal_up_a'))<>120 then raise exception'FAIL PE29';end if;
 perform public.update_expense_record(a,pg_temp.fid('exp_up_a'),'2026-09-21','expense',pg_temp.fid('sa'),null,'Updated expense',120,null);if(select total_amount from public.expense_records where id=pg_temp.fid('exp_up_a'))<>120 then raise exception'FAIL PE30';end if;
 perform public.update_vehicle_fuel(a,pg_temp.fid('fuel_up_a'),'2026-09-21','09:00',pg_temp.fid('va'),pg_temp.fid('pa'),'Diesel',12,10,null);if(select total_amount from public.expense_records where id=pg_temp.fid('fuel_up_a'))<>120 then raise exception'FAIL PE32';end if;
 perform public.update_vehicle_maintenance(a,pg_temp.fid('maint_up_a'),'2026-09-21',pg_temp.fid('va'),pg_temp.fid('ga'),'Updated repair',120);if(select total_amount from public.expense_records where id=pg_temp.fid('maint_up_a'))<>120 then raise exception'FAIL PE33';end if;
 perform public.void_coal_purchase(a,pg_temp.fid('coal_void_a'));perform public.void_expense_record(a,pg_temp.fid('exp_void_a'));perform public.void_vehicle_fuel(a,pg_temp.fid('fuel_void_a'));perform public.void_vehicle_maintenance(a,pg_temp.fid('maint_void_a'));
 if exists(select 1 from public.expense_records where id in(pg_temp.fid('coal_void_a'),pg_temp.fid('exp_void_a'),pg_temp.fid('fuel_void_a'),pg_temp.fid('maint_void_a')) and status<>'void')then raise exception'FAIL voids';end if;
 perform public.assign_labourer_to_production_crew(a,pg_temp.fid('la1'),pg_temp.fid('ca'),'2026-09-01');perform public.end_labourer_production_crew_assignment(a,pg_temp.fid('la1'),'2026-09-10');
 perform public.create_labourer_production_wage_rate_override(a,pg_temp.fid('la1'),100,'2026-09-01');perform public.create_production_crew_wage_rate(a,pg_temp.fid('ca'),100,'2026-09-01');perform public.create_wage_rate(a,'production',100,'2026-09-07');perform public.set_production_labourer_origin(a,pg_temp.fid('la1'),'Origin A');perform public.set_production_labourer_rates(a,array[pg_temp.fid('la2')],110,'2026-09-02');
 if not exists(select 1 from public.production_wage_rates where factory_id=a and labourer_id=pg_temp.fid('la2') and rate_per_1000_bricks=110)then raise exception'FAIL PR history';end if;
 g:=public.create_mud_group(a,'Mud A',5,'2026-09-01',100,'2026-09-01');insert into pg_temp.atlas_12b2c_ids values('mud_a',g);perform public.set_mud_group_member_count(a,g,6,'2026-09-05');perform public.set_mud_group_rate(a,g,120,'2026-09-05');perform public.stop_mud_group_earning(a,g,'2026-09-10');perform public.restart_mud_group_earning(a,g,7,'2026-09-11');perform public.set_mud_supply_rate(a,100,'2026-09-07');perform public.transition_mud_accounting_mode(a,'SHADOW');
 if(select accounting_mode from public.mud_accounting_states where factory_id=a)<>'SHADOW' then raise exception'FAIL MU18';end if;
 perform public.create_transport_crew_wage_rate(a,pg_temp.fid('ta'),'2026-09-01',100);
 raise notice 'PASS 24 positive controls';
end$$;reset role;select set_config('request.jwt.claim.sub','',true);

-- Direct B attacks for every signature.
do $$declare b uuid:=pg_temp.fid('fb');mb uuid:=pg_temp.fid('mud_b');m text:='You do not have access to this factory\.';begin
 perform pg_temp.reject('PE14 B',format('select public.create_vehicle_maintenance_payment(%L::uuid,%L::uuid,date %L,10,%L,%L)',b,pg_temp.fid('maint_b'),'2026-09-20','cash','x'),'42501',m);
 perform pg_temp.reject('PE29 B',format('select * from public.update_coal_purchase(%L::uuid,%L::uuid,date %L,%L::uuid,%L::uuid,%L::uuid,%L,%L,12,10,null,0)',b,pg_temp.fid('coal_b'),'2026-09-21',pg_temp.fid('sb'),pg_temp.fid('nb'),pg_temp.fid('rb'),'x','AT12C002'),'42501',m);
 perform pg_temp.reject('PE30 B',format('select public.update_expense_record(%L::uuid,%L::uuid,date %L,%L,%L::uuid,null,%L,120,null)',b,pg_temp.fid('exp_b'),'2026-09-21','expense',pg_temp.fid('sb'),'x'),'42501',m);
 perform pg_temp.reject('PE32 B',format('select * from public.update_vehicle_fuel(%L::uuid,%L::uuid,date %L,time %L,%L::uuid,%L::uuid,%L,12,10,null)',b,pg_temp.fid('fuel_b'),'2026-09-21','09:00',pg_temp.fid('vb'),pg_temp.fid('pb'),'Diesel'),'42501',m);
 perform pg_temp.reject('PE33 B',format('select * from public.update_vehicle_maintenance(%L::uuid,%L::uuid,date %L,%L::uuid,%L::uuid,%L,120)',b,pg_temp.fid('maint_b'),'2026-09-21',pg_temp.fid('vb'),pg_temp.fid('gb'),'x'),'42501',m);
 perform pg_temp.reject('PE34 B',format('select * from public.void_coal_purchase(%L::uuid,%L::uuid)',b,pg_temp.fid('coal_b')),'42501',m);perform pg_temp.reject('PE35 B',format('select public.void_expense_record(%L::uuid,%L::uuid)',b,pg_temp.fid('exp_b')),'42501',m);perform pg_temp.reject('PE36 B',format('select * from public.void_vehicle_fuel(%L::uuid,%L::uuid)',b,pg_temp.fid('fuel_b')),'42501',m);perform pg_temp.reject('PE37 B',format('select * from public.void_vehicle_maintenance(%L::uuid,%L::uuid)',b,pg_temp.fid('maint_b')),'42501',m);
 perform pg_temp.reject('PR1 B',format('select public.assign_labourer_to_production_crew(%L::uuid,%L::uuid,%L::uuid,date %L)',b,pg_temp.fid('lb1'),pg_temp.fid('cb'),'2026-09-01'),'42501',m);perform pg_temp.reject('PR3 B',format('select public.create_labourer_production_wage_rate_override(%L::uuid,%L::uuid,100,date %L)',b,pg_temp.fid('lb1'),'2026-09-01'),'42501',m);perform pg_temp.reject('PR6 B',format('select public.create_production_crew_wage_rate(%L::uuid,%L::uuid,100,date %L)',b,pg_temp.fid('cb'),'2026-09-01'),'42501',m);perform pg_temp.reject('PR7 B',format('select public.create_wage_rate(%L::uuid,%L,100,date %L)',b,'production','2026-09-07'),'42501',m);perform pg_temp.reject('PR8 B',format('select public.end_labourer_production_crew_assignment(%L::uuid,%L::uuid,date %L)',b,pg_temp.fid('lb1'),'2026-09-10'),'42501',m);perform pg_temp.reject('PR11 B',format('select public.set_production_labourer_origin(%L::uuid,%L::uuid,%L)',b,pg_temp.fid('lb1'),'x'),'42501',m);perform pg_temp.reject('PR12 B',format('select * from public.set_production_labourer_rates(%L::uuid,array[%L::uuid],100,date %L)',b,pg_temp.fid('lb1'),'2026-09-02'),'42501',m);
 perform pg_temp.reject('MU3 B',format('select public.create_mud_group(%L::uuid,%L,5,date %L,100,date %L)',b,'x','2026-09-01','2026-09-01'),'42501',m);perform pg_temp.reject('MU13 B',format('select public.restart_mud_group_earning(%L::uuid,%L::uuid,5,date %L)',b,mb,'2026-09-11'),'42501',m);perform pg_temp.reject('MU14 B',format('select public.set_mud_group_member_count(%L::uuid,%L::uuid,6,date %L)',b,mb,'2026-09-05'),'42501',m);perform pg_temp.reject('MU15 B',format('select public.set_mud_group_rate(%L::uuid,%L::uuid,120,date %L)',b,mb,'2026-09-05'),'42501',m);perform pg_temp.reject('MU16 B',format('select public.set_mud_supply_rate(%L::uuid,100,date %L)',b,'2026-09-07'),'42501',m);perform pg_temp.reject('MU17 B',format('select public.stop_mud_group_earning(%L::uuid,%L::uuid,date %L)',b,mb,'2026-09-10'),'42501',m);perform pg_temp.reject('MU18 B',format('select * from public.transition_mud_accounting_mode(%L::uuid,%L)',b,'SHADOW'),'42501',m);perform pg_temp.reject('TR2 B',format('select public.create_transport_crew_wage_rate(%L::uuid,%L::uuid,date %L,100)',b,pg_temp.fid('tb'),'2026-09-01'),'42501',m);
end$$;

-- Mixed child IDs, including PR12 atomic mixed array and shared delegates.
do $$declare a uuid:=pg_temp.fid('fa');begin
 perform pg_temp.reject('PE14 mixed maintenance',format('select public.create_vehicle_maintenance_payment(%L::uuid,%L::uuid,date %L,10,%L,%L)',a,pg_temp.fid('maint_b'),'2026-09-20','cash','x'),'P4304','does not belong');
 perform pg_temp.reject('PE29 mixed purchase',format('select * from public.update_coal_purchase(%L::uuid,%L::uuid,date %L,%L::uuid,%L::uuid,%L::uuid,%L,%L,12,10,null,0)',a,pg_temp.fid('coal_b'),'2026-09-21',pg_temp.fid('sa'),pg_temp.fid('na'),pg_temp.fid('ra'),'x','AT12C001'),'P4206','does not belong');
 perform pg_temp.reject('PE29 mixed seller',format('select * from public.update_coal_purchase(%L::uuid,%L::uuid,date %L,%L::uuid,%L::uuid,%L::uuid,%L,%L,12,10,null,0)',a,pg_temp.fid('coal_up_a'),'2026-09-21',pg_temp.fid('sb'),pg_temp.fid('na'),pg_temp.fid('ra'),'x','AT12C001'),'P4002','Seller does not belong');
 perform pg_temp.reject('PE30 mixed expense',format('select public.update_expense_record(%L::uuid,%L::uuid,date %L,%L,%L::uuid,null,%L,120,null)',a,pg_temp.fid('exp_b'),'2026-09-21','expense',pg_temp.fid('sa'),'x'),'P4102','does not belong');perform pg_temp.reject('PE30 mixed supplier',format('select public.update_expense_record(%L::uuid,%L::uuid,date %L,%L,%L::uuid,null,%L,120,null)',a,pg_temp.fid('exp_up_a'),'2026-09-21','expense',pg_temp.fid('sb'),'x'),'P4002','Supplier does not belong');
 perform pg_temp.reject('PE32 mixed fuel',format('select * from public.update_vehicle_fuel(%L::uuid,%L::uuid,date %L,time %L,%L::uuid,%L::uuid,%L,12,10,null)',a,pg_temp.fid('fuel_b'),'2026-09-21','09:00',pg_temp.fid('va'),pg_temp.fid('pa'),'Diesel'),'P4504','does not belong');perform pg_temp.reject('PE32 mixed vehicle',format('select * from public.update_vehicle_fuel(%L::uuid,%L::uuid,date %L,time %L,%L::uuid,%L::uuid,%L,12,10,null)',a,pg_temp.fid('fuel_up_a'),'2026-09-21','09:00',pg_temp.fid('vb'),pg_temp.fid('pa'),'Diesel'),'P4501','Vehicle does not belong');perform pg_temp.reject('PE32 mixed pump',format('select * from public.update_vehicle_fuel(%L::uuid,%L::uuid,date %L,time %L,%L::uuid,%L::uuid,%L,12,10,null)',a,pg_temp.fid('fuel_up_a'),'2026-09-21','09:00',pg_temp.fid('va'),pg_temp.fid('pb'),'Diesel'),'P4503','Fuel Pump');
 perform pg_temp.reject('PE33 mixed maintenance',format('select * from public.update_vehicle_maintenance(%L::uuid,%L::uuid,date %L,%L::uuid,%L::uuid,%L,120)',a,pg_temp.fid('maint_b'),'2026-09-21',pg_temp.fid('va'),pg_temp.fid('ga'),'x'),'P4304','does not belong');perform pg_temp.reject('PE33 mixed vehicle',format('select * from public.update_vehicle_maintenance(%L::uuid,%L::uuid,date %L,%L::uuid,%L::uuid,%L,120)',a,pg_temp.fid('maint_up_a'),'2026-09-21',pg_temp.fid('vb'),pg_temp.fid('ga'),'x'),'P4301','Vehicle does not belong');perform pg_temp.reject('PE33 mixed garage',format('select * from public.update_vehicle_maintenance(%L::uuid,%L::uuid,date %L,%L::uuid,%L::uuid,%L,120)',a,pg_temp.fid('maint_up_a'),'2026-09-21',pg_temp.fid('va'),pg_temp.fid('gb'),'x'),'P4303','Garage does not belong');
 perform pg_temp.reject('PE34 mixed',format('select * from public.void_coal_purchase(%L::uuid,%L::uuid)',a,pg_temp.fid('coal_b')),'P4206','does not belong');perform pg_temp.reject('PE35 mixed',format('select public.void_expense_record(%L::uuid,%L::uuid)',a,pg_temp.fid('exp_b')),'P4102','does not belong');perform pg_temp.reject('PE36 mixed',format('select * from public.void_vehicle_fuel(%L::uuid,%L::uuid)',a,pg_temp.fid('fuel_b')),'P4504','does not belong');perform pg_temp.reject('PE37 mixed',format('select * from public.void_vehicle_maintenance(%L::uuid,%L::uuid)',a,pg_temp.fid('maint_b')),'P4304','does not belong');
 perform pg_temp.reject('PR1 mixed labourer',format('select public.assign_labourer_to_production_crew(%L::uuid,%L::uuid,%L::uuid,date %L)',a,pg_temp.fid('lb1'),pg_temp.fid('ca'),'2026-09-20'),'42501','Labourer does not belong');perform pg_temp.reject('PR1 mixed crew',format('select public.assign_labourer_to_production_crew(%L::uuid,%L::uuid,%L::uuid,date %L)',a,pg_temp.fid('la2'),pg_temp.fid('cb'),'2026-09-20'),'42501','Production crew does not belong');
 perform pg_temp.reject('PR12 all B array',format('select * from public.set_production_labourer_rates(%L::uuid,array[%L::uuid],120,date %L)',a,pg_temp.fid('lb1'),'2026-09-03'),'42501','Every selected labourer');perform pg_temp.reject('PR12 mixed A/B array',format('select * from public.set_production_labourer_rates(%L::uuid,array[%L::uuid,%L::uuid],120,date %L)',a,pg_temp.fid('la2'),pg_temp.fid('lb1'),'2026-09-03'),'42501','Every selected labourer');
 perform pg_temp.reject('MU mixed group',format('select public.set_mud_group_rate(%L::uuid,%L::uuid,130,date %L)',a,pg_temp.fid('mud_b'),'2026-09-06'),'42501','Mud group does not belong');perform pg_temp.reject('TR2 mixed crew',format('select public.create_transport_crew_wage_rate(%L::uuid,%L::uuid,date %L,100)',a,pg_temp.fid('tb'),'2026-09-01'),'42501','Transport crew does not belong');
end$$;

-- Same-call active/inactive representatives.
set local role authenticated;select set_config('request.jwt.claim.sub',pg_temp.fid('ua')::text,true);select public.update_expense_record(pg_temp.fid('fa'),pg_temp.fid('exp_inactive_a'),'2026-09-22','expense',pg_temp.fid('sa'),null,'Inactive same',100,null);select public.set_production_labourer_origin(pg_temp.fid('fa'),pg_temp.fid('la2'),'Inactive same');select public.set_mud_supply_rate(pg_temp.fid('fa'),110,'2026-09-14');reset role;select set_config('request.jwt.claim.sub','',true);
update public.factory_users set is_active=false where user_id=pg_temp.fid('ua') and factory_id=pg_temp.fid('fa');
select pg_temp.reject('inactive financial update',format('select public.update_expense_record(%L::uuid,%L::uuid,date %L,%L,%L::uuid,null,%L,100,null)',pg_temp.fid('fa'),pg_temp.fid('exp_inactive_a'),'2026-09-22','expense',pg_temp.fid('sa'),'Inactive same'),'42501','You do not have access');select pg_temp.reject('inactive Production config',format('select public.set_production_labourer_origin(%L::uuid,%L::uuid,%L)',pg_temp.fid('fa'),pg_temp.fid('la2'),'Inactive same'),'42501','You do not have access');select pg_temp.reject('inactive Mud config',format('select public.set_mud_supply_rate(%L::uuid,110,date %L)',pg_temp.fid('fa'),'2026-09-14'),'42501','You do not have access');
reset role;select set_config('request.jwt.claim.sub','',true);rollback;
-- E7A: validate the preserved baseline before any cleanup comparison.
do $baseline_guard$
begin
  if pg_catalog.to_regclass('pg_temp.atlas_12b2c_counts') is null then
    raise exception 'FAIL: preserved cleanup baseline is missing';
  end if;
  if exists (select 1 from pg_temp.atlas_12b2c_counts
    where s is null or t is null or c is null or h is null) then
    raise exception 'FAIL: cleanup baseline has NULL identity, count or fingerprint';
  end if;
  if exists (select 1 from pg_temp.atlas_12b2c_counts
    group by s,t having count(*) > 1) then
    raise exception 'FAIL: cleanup baseline has duplicate identities';
  end if;
  if (select count(*) from pg_catalog.pg_class c
    join pg_catalog.pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public' and c.relkind in ('r','p')) <> 64 then
    raise exception 'FAIL: cleanup catalog must contain exactly 64 public tables';
  end if;
  if (select count(*) from pg_temp.atlas_12b2c_counts) <> 65
    or (select count(distinct t) from pg_temp.atlas_12b2c_counts
      where s = 'public') <> 64
    or (select count(*) from pg_temp.atlas_12b2c_counts
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
      from pg_temp.atlas_12b2c_counts
    )
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  ) then
    raise exception 'FAIL: cleanup baseline identities differ from the catalog plus auth.users';
  end if;
end;
$baseline_guard$;

do $$declare r record;n bigint;h text;bad text[]:='{}';begin for r in select*from atlas_12b2c_counts loop execute format('select count(*),md5(coalesce(jsonb_agg(to_jsonb(q) order by to_jsonb(q)::text),''[]'')::text) from %I.%I q',r.s,r.t)into n,h;if n<>r.c or h is distinct from r.h then bad:=array_append(bad,format('%s.%s',r.s,r.t));end if;end loop;if cardinality(bad)>0 then raise exception'FAIL rollback %',bad;end if;end$$;
select 24 scoped,24 passed,0 not_proven,0 not_exercised,0 failed,24 direct_b_attacks,21 mixed_attacks,3 inactive_checks,0 anon_execute,0 public_execute,17 real_writer_fixture_calls,0 authenticated_direct_rows,2 trigger_rows,27 privileged_setup_rows,(select count(*)from atlas_12b2c_counts)persistent_pairs,0 persistent_mismatches,'77 / 123' runtime_coverage,'46' remaining,'concurrent/double-submit financial integrity testing' future_item;
drop table atlas_12b2c_counts;drop table atlas_12b2c_manifest;
