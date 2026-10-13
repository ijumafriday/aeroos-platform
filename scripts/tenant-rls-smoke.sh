#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL for aeroos_owner is required}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/tests/integration/tenant-rls.sql"
echo 'PASS tenant RLS isolation'
