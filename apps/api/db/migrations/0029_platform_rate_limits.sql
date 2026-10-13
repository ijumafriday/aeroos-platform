-- Distributed API rate-limit counters. PostgreSQL makes the limit effective across API replicas.
create table if not exists platform.rate_limit_windows (
  bucket text not null,
  window_start timestamptz not null,
  count integer not null check (count > 0),
  primary key (bucket, window_start)
);
create index if not exists rate_limit_windows_expiry_idx on platform.rate_limit_windows(window_start);
grant select, insert, update, delete on platform.rate_limit_windows to platform_svc;
