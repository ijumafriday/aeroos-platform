BEGIN;
INSERT INTO compliance.operator_profiles(operator_id,name,authority) VALUES
  ('RLSA','RLS tenant A','KCAA'),('RLSB','RLS tenant B','KCAA')
ON CONFLICT (operator_id) DO NOTHING;
SET ROLE compliance_svc;
SELECT set_config('aeroos.operator_id','RLSA',true), set_config('aeroos.system','false',true);
DO $$
DECLARE visible int;
BEGIN
  SELECT count(*) INTO visible FROM compliance.operator_profiles WHERE operator_id IN ('RLSA','RLSB');
  IF visible <> 1 THEN RAISE EXCEPTION 'RLS isolation failed: tenant A saw % rows', visible; END IF;
  IF EXISTS (SELECT 1 FROM compliance.operator_profiles WHERE operator_id='RLSB') THEN
    RAISE EXCEPTION 'RLS isolation failed: tenant A can see tenant B';
  END IF;
END $$;
RESET ROLE;

INSERT INTO engineering.configuration_baselines(id,operator_id,aircraft_type,name,revision,status,created_by,version) VALUES
  ('RLS-CFG-A','RLSA','B737-800','RLS A',1,'DRAFT','test',1),
  ('RLS-CFG-B','RLSB','B737-800','RLS B',1,'DRAFT','test',1);
SET ROLE engineering_svc;
SELECT set_config('aeroos.operator_id','RLSA',true), set_config('aeroos.system','false',true);
DO $$
DECLARE visible int;
BEGIN
  SELECT count(*) INTO visible FROM engineering.configuration_baselines WHERE id IN ('RLS-CFG-A','RLS-CFG-B');
  IF visible <> 1 THEN RAISE EXCEPTION 'Engineering RLS isolation failed: tenant A saw % rows', visible; END IF;
  IF EXISTS (SELECT 1 FROM engineering.configuration_baselines WHERE id='RLS-CFG-B') THEN
    RAISE EXCEPTION 'Engineering RLS isolation failed: tenant A can see tenant B';
  END IF;
END $$;
RESET ROLE;

INSERT INTO records.binders(id,operator_id,subject_type,subject_id,title,status,created_by,created_at) VALUES
  ('RLS-REC-A','RLSA','AIRCRAFT','5Y-RLA','A records','OPEN','test',now()),
  ('RLS-REC-B','RLSB','AIRCRAFT','5Y-RLB','B records','OPEN','test',now());
SET ROLE records_svc;
SELECT set_config('aeroos.operator_id','RLSA',true), set_config('aeroos.system','false',true);
DO $$
DECLARE visible int;
BEGIN
  SELECT count(*) INTO visible FROM records.binders WHERE id IN ('RLS-REC-A','RLS-REC-B');
  IF visible <> 1 THEN RAISE EXCEPTION 'Records RLS isolation failed: tenant A saw % rows', visible; END IF;
END $$;
RESET ROLE;

INSERT INTO amo.parts(part_no,description,unit,min_stock,standard_part) VALUES ('RLS-PART','RLS test part','EA',0,false) ON CONFLICT(part_no) DO NOTHING;
INSERT INTO amo.stock(operator_id,part_no,location,qty) VALUES ('RLSA','RLS-PART','RLS-A',2),('RLSB','RLS-PART','RLS-B',3);
SET ROLE amo_svc;
SELECT set_config('aeroos.operator_id','RLSA',true), set_config('aeroos.system','false',true);
DO $$
DECLARE visible int; total_qty int;
BEGIN
  SELECT count(*), coalesce(sum(qty),0) INTO visible,total_qty FROM amo.stock WHERE part_no='RLS-PART';
  IF visible <> 1 OR total_qty <> 2 THEN RAISE EXCEPTION 'Stock RLS isolation failed: rows %, qty %', visible,total_qty; END IF;
END $$;
RESET ROLE;
ROLLBACK;

-- 0.25 platform governance tables are tenant-owned too.
BEGIN;
SET ROLE aeroos_owner;
INSERT INTO platform.migration_jobs(id,operator_id,target,strategy,status,source_name,created_by)
VALUES ('11111111-1111-1111-1111-111111111111','RLSA','camo.fleet','INSERT_ONLY','DRAFT','A','test'),
       ('22222222-2222-2222-2222-222222222222','RLSB','camo.fleet','INSERT_ONLY','DRAFT','B','test');
RESET ROLE;
SET ROLE platform_svc;
SELECT set_config('aeroos.operator_id','RLSA',true), set_config('aeroos.system','false',true);
DO $$
DECLARE visible int;
BEGIN
  SELECT count(*) INTO visible FROM platform.migration_jobs WHERE id IN ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222');
  IF visible <> 1 THEN RAISE EXCEPTION 'Platform migration RLS isolation failed: tenant A saw % rows', visible; END IF;
END $$;
RESET ROLE;
ROLLBACK;

-- 0.27 regulated master-data governance is tenant-owned.
BEGIN;
SET ROLE aeroos_owner;
INSERT INTO compliance.master_data_sets(id,operator_id,key,domain,title,source_ref,content_sha256,status,revision,created_by)
VALUES ('33333333-3333-3333-3333-333333333333','RLSA','camo.mel','AIRWORTHINESS','A MEL','approved A',repeat('a',64),'DRAFT',99,'test'),
       ('44444444-4444-4444-4444-444444444444','RLSB','camo.mel','AIRWORTHINESS','B MEL','approved B',repeat('b',64),'DRAFT',99,'test');
RESET ROLE;
SET ROLE compliance_svc;
SELECT set_config('aeroos.operator_id','RLSA',true), set_config('aeroos.system','false',true);
DO $$
DECLARE visible int;
BEGIN
  SELECT count(*) INTO visible FROM compliance.master_data_sets WHERE id IN ('33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444');
  IF visible <> 1 THEN RAISE EXCEPTION 'Master-data RLS isolation failed: tenant A saw % rows', visible; END IF;
END $$;
RESET ROLE;
ROLLBACK;

-- 0.28 P1 closure tables remain tenant-owned.
BEGIN;
SET ROLE aeroos_owner;
INSERT INTO amo.warehouse_bins(id,operator_id,station,warehouse,bin_code,quarantine,active,created_by)
VALUES ('55555555-5555-5555-5555-555555555555','RLSA','HKJK','RLS','A1',false,true,'test'),
       ('66666666-6666-6666-6666-666666666666','RLSB','HKJK','RLS','B1',false,true,'test');
RESET ROLE;
SET ROLE amo_svc;
SELECT set_config('aeroos.operator_id','RLSA',true), set_config('aeroos.system','false',true);
DO $$
DECLARE visible int;
BEGIN
  SELECT count(*) INTO visible FROM amo.warehouse_bins WHERE id IN ('55555555-5555-5555-5555-555555555555','66666666-6666-6666-6666-666666666666');
  IF visible <> 1 THEN RAISE EXCEPTION 'Warehouse RLS isolation failed: tenant A saw % rows', visible; END IF;
END $$;
RESET ROLE;
ROLLBACK;

BEGIN;
SET ROLE aeroos_owner;
INSERT INTO ops.cabin_requirements(operator_id,aircraft_type,sccm_required,cc_required,updated_by)
VALUES ('RLSA','RLS-A320',1,3,'test'),('RLSB','RLS-A320',1,4,'test');
RESET ROLE;
SET ROLE ops_svc;
SELECT set_config('aeroos.operator_id','RLSA',true), set_config('aeroos.system','false',true);
DO $$
DECLARE visible int; cc int;
BEGIN
  SELECT count(*), max(cc_required) INTO visible,cc FROM ops.cabin_requirements WHERE aircraft_type='RLS-A320';
  IF visible <> 1 OR cc <> 3 THEN RAISE EXCEPTION 'Cabin requirement RLS isolation failed: rows %, cc %', visible,cc; END IF;
END $$;
RESET ROLE;
ROLLBACK;

-- 0.29 P2 closure: personal workspace views and ERP integration artifacts are tenant-owned.
BEGIN;
SET ROLE aeroos_owner;
INSERT INTO platform.user_views(id,operator_id,subject,route,name,search,is_default)
VALUES ('77777777-7777-7777-7777-777777777777','RLSA','user:test','/org/personnel','A view','{}',false),
       ('88888888-8888-8888-8888-888888888888','RLSB','user:test','/org/personnel','B view','{}',false);
RESET ROLE;
SET ROLE platform_svc;
SELECT set_config('aeroos.operator_id','RLSA',true), set_config('aeroos.system','false',true);
DO $$ DECLARE visible int; BEGIN
  SELECT count(*) INTO visible FROM platform.user_views WHERE id IN ('77777777-7777-7777-7777-777777777777','88888888-8888-8888-8888-888888888888');
  IF visible <> 1 THEN RAISE EXCEPTION 'User-view RLS isolation failed: tenant A saw % rows', visible; END IF;
END $$;
RESET ROLE;
ROLLBACK;

BEGIN;
SET ROLE aeroos_owner;
INSERT INTO org.legal_entities(id,name,country,currency,parent_id,operator_id) VALUES
  ('RLS-ENT-A','RLS Entity A','KE','USD',NULL,'RLSA'),('RLS-ENT-B','RLS Entity B','KE','USD',NULL,'RLSB') ON CONFLICT(id) DO NOTHING;
INSERT INTO org.erp_profiles(id,operator_id,entity_id,name,format,created_by,updated_by)
VALUES ('99999999-9999-9999-9999-999999999999','RLSA','RLS-ENT-A','ERP A','CSV_JOURNAL_V1','test','test'),
       ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','RLSB','RLS-ENT-B','ERP B','CSV_JOURNAL_V1','test','test');
RESET ROLE;
SET ROLE org_svc;
SELECT set_config('aeroos.operator_id','RLSA',true), set_config('aeroos.system','false',true);
DO $$ DECLARE visible int; BEGIN
  SELECT count(*) INTO visible FROM org.erp_profiles WHERE id IN ('99999999-9999-9999-9999-999999999999','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  IF visible <> 1 THEN RAISE EXCEPTION 'ERP-profile RLS isolation failed: tenant A saw % rows', visible; END IF;
END $$;
RESET ROLE;
ROLLBACK;

-- 0.36 D003: regulated Operations reference data is tenant-owned and inaccessible cross-tenant.
BEGIN;
SET ROLE aeroos_owner;
INSERT INTO ops.aircraft_types(operator_id,type,icao_type,wake,seats,mzfw,mtow,mlw,max_fuel,lemac,mac,fwd_limit,aft_limit,crew_arm,pax_arm,hold_fwd_arm,hold_aft_arm,fuel_arm,burn_kg_per_hour,hold_kg_per_min,cruise_kt,data_origin,source_ref)
VALUES ('RLSA','RLS-TYPE','RLST','M',10,1000,1200,1100,200,1,1,10,30,1,2,1,3,2,100,2,200,'PROVENANCED','RLS A'),
       ('RLSB','RLS-TYPE','RLST','M',10,1000,1300,1100,200,1,1,10,30,1,2,1,3,2,100,2,200,'PROVENANCED','RLS B');
INSERT INTO ops.runway_limits(operator_id,airport,type,rtow_kg,rlw_kg,note) VALUES
 ('RLSA','HKJK','RLS-TYPE',1150,1050,'A'),('RLSB','HKJK','RLS-TYPE',1250,1050,'B');
INSERT INTO ops.routes(operator_id,dep,arr,route,cruise_level,countries) VALUES
 ('RLSA','HKJK','HTDA','A-ROUTE',330,ARRAY['KE','TZ']),('RLSB','HKJK','HTDA','B-ROUTE',350,ARRAY['KE','TZ']);
INSERT INTO ops.permit_rules(operator_id,country,permit_required,note) VALUES
 ('RLSA','TZ',false,'A'),('RLSB','TZ',true,'B');
RESET ROLE;
SET ROLE ops_svc;
SELECT set_config('aeroos.operator_id','RLSA',true), set_config('aeroos.system','false',true);
DO $$ DECLARE n int; mtow int; rtow int; route text; permit boolean; BEGIN
 SELECT count(*),max(a.mtow) INTO n,mtow FROM ops.aircraft_types a WHERE type='RLS-TYPE';
 IF n<>1 OR mtow<>1200 THEN RAISE EXCEPTION 'Aircraft type RLS failed rows %, mtow %',n,mtow; END IF;
 SELECT max(rtow_kg) INTO rtow FROM ops.runway_limits WHERE airport='HKJK' AND type='RLS-TYPE';
 IF rtow<>1150 THEN RAISE EXCEPTION 'Runway RLS failed %',rtow; END IF;
 SELECT max(r.route) INTO route FROM ops.routes r WHERE dep='HKJK' AND arr='HTDA';
 IF route<>'A-ROUTE' THEN RAISE EXCEPTION 'Route RLS failed %',route; END IF;
 SELECT bool_or(permit_required) INTO permit FROM ops.permit_rules WHERE country='TZ';
 IF permit THEN RAISE EXCEPTION 'Permit rule RLS failed'; END IF;
END $$;
RESET ROLE;
ROLLBACK;

-- 0.37 MNT completion: Maintenance station capability remains tenant-isolated.
BEGIN;
SET ROLE aeroos_owner;
INSERT INTO amo.maintenance_station_capabilities(id,operator_id,station,aircraft_type,maintenance_level,scope,authority_ref,effective_from,active,approved_by,approved_at)
VALUES ('b1111111-1111-1111-1111-111111111111','RLSA','HKJK','A320','LINE','["TRANSIT"]'::jsonb,'RLS-AUTH-A',current_date,true,'test',now()),
       ('b2222222-2222-2222-2222-222222222222','RLSB','HKJK','A320','LINE','["BASE"]'::jsonb,'RLS-AUTH-B',current_date,true,'test',now());
RESET ROLE;
SET ROLE amo_svc;
SELECT set_config('aeroos.operator_id','RLSA',true), set_config('aeroos.system','false',true);
DO $$ DECLARE visible int; auth text; BEGIN
  SELECT count(*),max(authority_ref) INTO visible,auth FROM amo.maintenance_station_capabilities
   WHERE id IN ('b1111111-1111-1111-1111-111111111111','b2222222-2222-2222-2222-222222222222');
  IF visible <> 1 OR auth <> 'RLS-AUTH-A' THEN
    RAISE EXCEPTION 'Maintenance capability RLS isolation failed: rows %, authority %', visible, auth;
  END IF;
END $$;
RESET ROLE;
ROLLBACK;

-- 0.38 Supply completion: supply-control planning records remain tenant-isolated.
BEGIN;
SET ROLE aeroos_owner;
INSERT INTO amo.replenishment_policies(id,operator_id,part_no,station,min_qty,max_qty,reorder_qty,lead_days,service_level,preferred_vendor_id,active,created_by,created_at,updated_at)
VALUES ('c1111111-1111-1111-1111-111111111111','RLSA','RLS-SUP-PART','HKJK',1,5,2,7,0.95,NULL,true,'test',now(),now()),
       ('c2222222-2222-2222-2222-222222222222','RLSB','RLS-SUP-PART','HKJK',2,8,3,9,0.95,NULL,true,'test',now(),now());
RESET ROLE;
SET ROLE amo_svc;
SELECT set_config('aeroos.operator_id','RLSA',true), set_config('aeroos.system','false',true);
DO $$ DECLARE visible int; mx int; BEGIN
  SELECT count(*),max(max_qty) INTO visible,mx FROM amo.replenishment_policies
   WHERE id IN ('c1111111-1111-1111-1111-111111111111','c2222222-2222-2222-2222-222222222222');
  IF visible <> 1 OR mx <> 5 THEN
    RAISE EXCEPTION 'Supply replenishment RLS isolation failed: rows %, max %', visible, mx;
  END IF;
END $$;
RESET ROLE;
ROLLBACK;

-- 0.39 Technical Records completion: intake and legal-hold records remain tenant-isolated.
BEGIN;
SET ROLE aeroos_owner;
INSERT INTO records.ingest_batches(id,operator_id,source_system,source_ref,custodian,received_at,source_manifest_sha256,status,created_by)
VALUES ('RIN-RLSA','RLSA','Legacy','A','Custodian',now(),repeat('a',64),'OPEN','test'),
       ('RIN-RLSB','RLSB','Legacy','B','Custodian',now(),repeat('b',64),'OPEN','test');
INSERT INTO records.legal_holds(id,operator_id,scope_type,scope_id,reason,authority_ref,status,placed_by)
VALUES ('RH-RLSA','RLSA','SUBJECT','5Y-AAA','Case A','AUTH-A','ACTIVE','test'),
       ('RH-RLSB','RLSB','SUBJECT','5Y-BBB','Case B','AUTH-B','ACTIVE','test');
RESET ROLE;
SET ROLE records_svc;
SELECT set_config('aeroos.operator_id','RLSA',true), set_config('aeroos.system','false',true);
DO $$ DECLARE batches int; holds int; ref text; BEGIN
 SELECT count(*) INTO batches FROM records.ingest_batches WHERE id IN ('RIN-RLSA','RIN-RLSB');
 SELECT count(*),max(authority_ref) INTO holds,ref FROM records.legal_holds WHERE id IN ('RH-RLSA','RH-RLSB');
 IF batches <> 1 OR holds <> 1 OR ref <> 'AUTH-A' THEN
   RAISE EXCEPTION 'Technical Records RLS isolation failed: batches %, holds %, ref %', batches, holds, ref;
 END IF;
END $$;
RESET ROLE;
ROLLBACK;
