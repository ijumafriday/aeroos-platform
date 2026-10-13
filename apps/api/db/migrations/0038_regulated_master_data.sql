-- 0.27: governed regulatory/master data. Existing seeded/legacy operational values are not
-- considered approved merely because they exist in a table; production use requires an
-- EFFECTIVE governance record with provenance and independent approval.
create table if not exists compliance.master_data_sets (
  id uuid primary key,
  operator_id text not null,
  key text not null,
  domain text not null check (domain in ('AIRWORTHINESS','ENGINEERING','OPERATIONS','CREW')),
  title text not null,
  source_ref text not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'DRAFT' check (status in ('DRAFT','VALIDATED','APPROVED','EFFECTIVE','SUPERSEDED','WITHDRAWN')),
  revision integer not null check (revision > 0),
  created_by text not null,
  created_at timestamptz not null default now(),
  validated_by text,
  validated_at timestamptz,
  approved_by text,
  approved_at timestamptz,
  effective_from timestamptz,
  superseded_by uuid references compliance.master_data_sets(id),
  withdrawal_reason text,
  metadata jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  unique(operator_id, key, revision),
  constraint master_data_title_nonblank check (length(trim(title)) > 0),
  constraint master_data_source_nonblank check (length(trim(source_ref)) > 0),
  constraint master_data_independent_validation check (validated_by is null or validated_by <> created_by),
  constraint master_data_independent_approval check (approved_by is null or approved_by <> created_by)
);
create unique index if not exists master_data_one_effective_key_idx on compliance.master_data_sets(operator_id, key) where status='EFFECTIVE';
create index if not exists master_data_operator_status_idx on compliance.master_data_sets(operator_id, status, domain, key);

grant select, insert, update on compliance.master_data_sets to compliance_svc;
alter table compliance.master_data_sets enable row level security;
drop policy if exists aeroos_tenant_isolation on compliance.master_data_sets;
create policy aeroos_tenant_isolation on compliance.master_data_sets
using (current_setting('aeroos.system', true)='true' or operator_id=nullif(current_setting('aeroos.operator_id', true),''))
with check (current_setting('aeroos.system', true)='true' or operator_id=nullif(current_setting('aeroos.operator_id', true),''));

-- Register every known operator's legacy/seeded data as DRAFT. This is deliberately not EFFECTIVE:
-- an operator must establish provenance, hash the approved source package and approve it before
-- regulated production actions can rely on it.
insert into compliance.master_data_sets(id,operator_id,key,domain,title,source_ref,content_sha256,status,revision,created_by,metadata)
select gen_random_uuid(), p.operator_id, x.key, x.domain, x.title, x.source_ref, repeat('0',64), 'DRAFT', 1, 'system:migration-0038', jsonb_build_object('legacyUnverified',true)
from compliance.operator_profiles p
cross join (values
 ('ops.aircraft_types','OPERATIONS','Aircraft type mass, balance and performance data','Approved Weight & Balance Manual / AFM / FCOM'),
 ('ops.aircraft_weights','OPERATIONS','Aircraft basic empty mass and arm','Approved weighing report'),
 ('ops.runway_limits','OPERATIONS','Runway regulated take-off and landing limits','Approved performance data / RTOW source'),
 ('ops.routes_permits','OPERATIONS','Route and overflight permit master data','Approved AIP / flight-planning source'),
 ('camo.maintenance_programme','AIRWORTHINESS','Approved maintenance programme tasks and intervals','Approved AMP'),
 ('camo.srm_limits','ENGINEERING','Structural damage and repair limits','Approved SRM chapters 51–57'),
 ('camo.engine_limits','ENGINEERING','Engine trend and oil-consumption limits','Approved OEM ECTM / AMM'),
 ('camo.mel','AIRWORTHINESS','Operator MEL catalogue and categories','Approved operator MEL'),
 ('compliance.ftl','CREW','Approved FTL scheme and authority rulepack','Approved FTL scheme')
) as x(key,domain,title,source_ref)
on conflict(operator_id,key,revision) do nothing;
