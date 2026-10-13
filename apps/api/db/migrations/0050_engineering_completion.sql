-- AeroOS 0.43.0 — Engineering domain completion.
CREATE TABLE engineering.config_items (
 id text PRIMARY KEY, operator_id text NOT NULL, item_type text NOT NULL CHECK(item_type IN ('SOFTWARE','CABIN_LAYOUT','EQUIPMENT','MOD_PACKAGE')), code text NOT NULL, revision text NOT NULL, description text NOT NULL,
 aircraft_type text NOT NULL, effectivity jsonb NOT NULL DEFAULT '{}'::jsonb, approved_status text NOT NULL DEFAULT 'DRAFT' CHECK(approved_status IN ('DRAFT','APPROVED','SUPERSEDED')), checksum_sha256 char(64), created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), approved_by text, approved_at timestamptz,
 UNIQUE(operator_id,item_type,code,revision));
CREATE TABLE engineering.interchangeability_rules (
 id text PRIMARY KEY, operator_id text NOT NULL, aircraft_type text NOT NULL, position_code text NOT NULL, primary_part_no text NOT NULL, alternate_part_no text NOT NULL, direction text NOT NULL CHECK(direction IN ('ONE_WAY','TWO_WAY')), conditions text NOT NULL, required_mods jsonb NOT NULL DEFAULT '[]'::jsonb, effectivity jsonb NOT NULL DEFAULT '{}'::jsonb, status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','APPROVED','REVOKED')), created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), approved_by text, approved_at timestamptz,
 UNIQUE(operator_id,aircraft_type,position_code,primary_part_no,alternate_part_no));
CREATE TABLE engineering.engineering_orders (
 id text PRIMARY KEY, operator_id text NOT NULL, eo_no text NOT NULL, revision integer NOT NULL DEFAULT 1, title text NOT NULL, aircraft_type text NOT NULL, ata text NOT NULL, reason text NOT NULL, effectivity jsonb NOT NULL DEFAULT '{}'::jsonb,
 drawings jsonb NOT NULL DEFAULT '[]'::jsonb, materials jsonb NOT NULL DEFAULT '[]'::jsonb, instructions text NOT NULL, status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','REVIEW','APPROVED','RELEASED','CLOSED','CANCELLED')),
 created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), reviewed_by text, reviewed_at timestamptz, approved_by text, approved_at timestamptz, released_by text, released_at timestamptz, closure_evidence text, closed_by text, closed_at timestamptz, UNIQUE(operator_id,eo_no,revision));
CREATE TABLE engineering.eo_embodiments (
 id text PRIMARY KEY, operator_id text NOT NULL, eo_id text NOT NULL REFERENCES engineering.engineering_orders(id) ON DELETE CASCADE, tail text NOT NULL, planned_work_package text, status text NOT NULL DEFAULT 'PLANNED' CHECK(status IN ('PLANNED','IN_WORK','ACCOMPLISHED','REJECTED')), accomplishment_ref text, accomplished_by text, accomplished_at timestamptz, conformity_verified_by text, conformity_verified_at timestamptz, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(operator_id,eo_id,tail));
CREATE TABLE engineering.sb_campaigns (
 id text PRIMARY KEY, operator_id text NOT NULL, sb_ref text NOT NULL, revision text NOT NULL, title text NOT NULL, aircraft_type text NOT NULL, classification text NOT NULL CHECK(classification IN ('MANDATORY','RECOMMENDED','OPTIONAL')), technical_disposition text NOT NULL, commercial_disposition text NOT NULL, compliance_basis text NOT NULL,
 kit_part_numbers jsonb NOT NULL DEFAULT '[]'::jsonb, effectivity jsonb NOT NULL DEFAULT '{}'::jsonb, status text NOT NULL DEFAULT 'EVALUATION' CHECK(status IN ('EVALUATION','APPROVED','CAMPAIGN','COMPLETE','REJECTED')), created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), approved_by text, approved_at timestamptz, UNIQUE(operator_id,sb_ref,revision));
CREATE TABLE engineering.sb_fleet_status (
 id text PRIMARY KEY, operator_id text NOT NULL, campaign_id text NOT NULL REFERENCES engineering.sb_campaigns(id) ON DELETE CASCADE, tail text NOT NULL, status text NOT NULL DEFAULT 'APPLICABLE' CHECK(status IN ('NOT_APPLICABLE','APPLICABLE','PLANNED','KIT_ORDERED','IN_WORK','EMBODIED','DECLINED')), kit_ref text, work_package_ref text, accomplishment_ref text, decision_note text, updated_by text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(operator_id,campaign_id,tail));
CREATE TABLE engineering.structural_damage (
 id text PRIMARY KEY, operator_id text NOT NULL, tail text NOT NULL, ata text NOT NULL, structure_zone text NOT NULL, surface text NOT NULL, x_pct numeric(6,3) NOT NULL CHECK(x_pct BETWEEN 0 AND 100), y_pct numeric(6,3) NOT NULL CHECK(y_pct BETWEEN 0 AND 100), damage_type text NOT NULL CHECK(damage_type IN ('DENT','CRACK','CORROSION','GOUGE','DELAMINATION','LIGHTNING','OTHER')), dimensions jsonb NOT NULL DEFAULT '{}'::jsonb,
 srm_ref text NOT NULL, inspection_ref text NOT NULL, disposition text NOT NULL, repair_ref text, status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','MONITOR','REPAIR_REQUIRED','REPAIRED','CLOSED')), next_inspection_due date, photo_evidence jsonb NOT NULL DEFAULT '[]'::jsonb, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), closed_by text, closed_at timestamptz);
CREATE INDEX eng_eo_status_idx ON engineering.engineering_orders(operator_id,status,aircraft_type);
CREATE INDEX eng_sb_status_idx ON engineering.sb_campaigns(operator_id,status,aircraft_type);
CREATE INDEX eng_damage_tail_idx ON engineering.structural_damage(operator_id,tail,status,ata);
GRANT SELECT,INSERT,UPDATE ON engineering.config_items,engineering.interchangeability_rules,engineering.engineering_orders,engineering.eo_embodiments,engineering.sb_campaigns,engineering.sb_fleet_status,engineering.structural_damage TO engineering_svc;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['config_items','interchangeability_rules','engineering_orders','eo_embodiments','sb_campaigns','sb_fleet_status','structural_damage'] LOOP
  EXECUTE format('ALTER TABLE engineering.%I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('ALTER TABLE engineering.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY aeroos_tenant_isolation ON engineering.%I USING (current_setting(''aeroos.system'', true) = ''true'' OR operator_id = NULLIF(current_setting(''aeroos.operator_id'', true), '''')) WITH CHECK (current_setting(''aeroos.system'', true) = ''true'' OR operator_id = NULLIF(current_setting(''aeroos.operator_id'', true), ''''))',t);
 END LOOP;
END $$;
