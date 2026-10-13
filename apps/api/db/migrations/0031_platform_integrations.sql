-- Open-platform integrations: outbound subscriptions and durable delivery queue.
create table if not exists platform.webhook_subscriptions (
  id uuid primary key,
  operator_id text not null,
  name text not null,
  endpoint text not null,
  event_types text[] not null,
  active boolean not null default true,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint webhook_event_types_not_empty check (cardinality(event_types) > 0),
  constraint webhook_name_not_blank check (length(trim(name)) > 0)
);
create index if not exists webhook_subscriptions_operator_idx on platform.webhook_subscriptions(operator_id, active);

create table if not exists platform.webhook_deliveries (
  id uuid primary key,
  operator_id text not null,
  subscription_id uuid not null references platform.webhook_subscriptions(id) on delete cascade,
  event_id uuid not null,
  event_type text not null,
  payload jsonb not null,
  status text not null default 'PENDING' check (status in ('PENDING','DELIVERED','FAILED')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_status integer,
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  unique(subscription_id, event_id)
);
create index if not exists webhook_deliveries_due_idx on platform.webhook_deliveries(status, next_attempt_at);
create index if not exists webhook_deliveries_operator_idx on platform.webhook_deliveries(operator_id, created_at desc);

grant select, insert, update, delete on platform.webhook_subscriptions, platform.webhook_deliveries to platform_svc;

alter table platform.webhook_subscriptions enable row level security;
drop policy if exists aeroos_tenant_isolation on platform.webhook_subscriptions;
create policy aeroos_tenant_isolation on platform.webhook_subscriptions
  using (current_setting('aeroos.system', true) = 'true' or operator_id = nullif(current_setting('aeroos.operator_id', true), ''))
  with check (current_setting('aeroos.system', true) = 'true' or operator_id = nullif(current_setting('aeroos.operator_id', true), ''));

alter table platform.webhook_deliveries enable row level security;
drop policy if exists aeroos_tenant_isolation on platform.webhook_deliveries;
create policy aeroos_tenant_isolation on platform.webhook_deliveries
  using (current_setting('aeroos.system', true) = 'true' or operator_id = nullif(current_setting('aeroos.operator_id', true), ''))
  with check (current_setting('aeroos.system', true) = 'true' or operator_id = nullif(current_setting('aeroos.operator_id', true), ''));
