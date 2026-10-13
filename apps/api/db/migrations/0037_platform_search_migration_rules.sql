-- Enterprise search preferences, governed migration staging, and bounded event rules.
create extension if not exists pg_trgm;

-- Trigram indexes keep federated domain-owned search fast without copying regulated rows to a global index.
create index if not exists ops_flights_search_no_trgm on ops.flights using gin (flight_no gin_trgm_ops);
create index if not exists ops_flights_search_tail_trgm on ops.flights using gin (tail gin_trgm_ops);
create index if not exists org_personnel_search_name_trgm on org.personnel using gin (name gin_trgm_ops);
create index if not exists org_personnel_search_username_trgm on org.personnel using gin (username gin_trgm_ops);
create index if not exists org_documents_search_title_trgm on org.controlled_documents using gin (title gin_trgm_ops);
create index if not exists org_occurrences_search_title_trgm on org.occurrences using gin (title gin_trgm_ops);
create index if not exists org_quality_audits_search_title_trgm on org.quality_audits using gin (title gin_trgm_ops);
create index if not exists camo_fleet_search_reg_trgm on camo.fleet using gin (reg gin_trgm_ops);
create index if not exists camo_mel_search_title_trgm on camo.mel_items using gin (title gin_trgm_ops);
create index if not exists camo_requirements_search_title_trgm on camo.requirements using gin (title gin_trgm_ops);
create index if not exists camo_work_packages_search_title_trgm on camo.work_packages using gin (title gin_trgm_ops);
create index if not exists amo_task_cards_search_title_trgm on amo.task_cards using gin (title gin_trgm_ops);
create index if not exists amo_parts_search_description_trgm on amo.parts using gin (description gin_trgm_ops);
create index if not exists records_binders_search_title_trgm on records.binders using gin (title gin_trgm_ops);
create index if not exists engineering_installed_search_part_trgm on engineering.installed_items using gin (part_no gin_trgm_ops);

create table if not exists platform.saved_searches (
  id uuid primary key,
  operator_id text not null,
  subject text not null,
  name text not null,
  query text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(operator_id, subject, name),
  constraint saved_search_name_not_blank check (length(trim(name)) > 0),
  constraint saved_search_query_not_blank check (length(trim(query)) > 0)
);
create index if not exists saved_search_subject_idx on platform.saved_searches(operator_id, subject, updated_at desc);

create table if not exists platform.migration_jobs (
  id uuid primary key,
  operator_id text not null,
  target text not null,
  strategy text not null check (strategy in ('INSERT_ONLY','UPSERT')),
  status text not null default 'DRAFT' check (status in ('DRAFT','VALIDATED','APPLYING','APPLIED','FAILED','CANCELLED')),
  source_name text not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  validated_by text,
  validated_at timestamptz,
  applied_by text,
  apply_started_at timestamptz,
  applied_at timestamptz,
  error text,
  summary jsonb not null default '{}'::jsonb
);
create index if not exists migration_jobs_operator_idx on platform.migration_jobs(operator_id, created_at desc);

create table if not exists platform.migration_rows (
  job_id uuid not null references platform.migration_jobs(id) on delete cascade,
  operator_id text not null,
  row_no integer not null check (row_no > 0),
  raw jsonb not null,
  normalized jsonb,
  status text not null default 'STAGED' check (status in ('STAGED','VALID','INVALID','APPLIED','SKIPPED','FAILED')),
  error text,
  primary key(job_id, row_no)
);
create index if not exists migration_rows_status_idx on platform.migration_rows(operator_id, job_id, status, row_no);

create table if not exists platform.decision_rules (
  id uuid primary key,
  operator_id text not null,
  name text not null,
  event_type text not null,
  status text not null default 'DRAFT' check (status in ('DRAFT','ACTIVE','RETIRED')),
  priority integer not null default 100 check (priority between 1 and 1000),
  condition jsonb not null,
  action jsonb not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  activated_by text,
  activated_at timestamptz,
  retired_by text,
  retired_at timestamptz,
  change_reason text
);
create unique index if not exists decision_rules_one_active_name_idx on platform.decision_rules(operator_id, name) where status = 'ACTIVE';
create index if not exists decision_rules_active_idx on platform.decision_rules(operator_id, event_type, priority) where status = 'ACTIVE';

create table if not exists platform.rule_executions (
  id bigserial primary key,
  operator_id text not null,
  rule_id uuid not null references platform.decision_rules(id),
  event_id uuid not null,
  event_type text not null,
  matched boolean not null,
  outcome text not null,
  error text,
  executed_at timestamptz not null default now(),
  unique(rule_id, event_id)
);
create index if not exists rule_executions_operator_idx on platform.rule_executions(operator_id, executed_at desc);

 grant select, insert, update, delete on platform.saved_searches, platform.migration_jobs, platform.migration_rows, platform.decision_rules, platform.rule_executions to platform_svc;
 grant usage, select on sequence platform.rule_executions_id_seq to platform_svc;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['saved_searches','migration_jobs','migration_rows','decision_rules','rule_executions']
  LOOP
    EXECUTE format('ALTER TABLE platform.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS aeroos_tenant_isolation ON platform.%I', t);
    EXECUTE format(
      'CREATE POLICY aeroos_tenant_isolation ON platform.%I USING (current_setting(''aeroos.system'', true) = ''true'' OR operator_id = NULLIF(current_setting(''aeroos.operator_id'', true), '''')) WITH CHECK (current_setting(''aeroos.system'', true) = ''true'' OR operator_id = NULLIF(current_setting(''aeroos.operator_id'', true), ''''))', t
    );
  END LOOP;
END $$;
