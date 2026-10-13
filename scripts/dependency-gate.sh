#!/usr/bin/env bash
# Hard dependency-reproducibility gate. This script intentionally has no unlocked fallback.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f pnpm-lock.yaml ] || { echo 'FAIL  pnpm-lock.yaml is required; dependency resolution must never occur implicitly' >&2; exit 2; }
expected="$(node -p "require('./package.json').packageManager")"
case "$expected" in pnpm@*) ;; *) echo "FAIL  packageManager must pin pnpm exactly (found: $expected)" >&2; exit 2;; esac
expected_version="${expected#pnpm@}"
actual="$(pnpm --version 2>/dev/null || true)"
[ "$actual" = "$expected_version" ] || { echo "FAIL  expected pnpm $expected_version, found ${actual:-unavailable}" >&2; exit 2; }

pnpm install --frozen-lockfile --lockfile-only --ignore-scripts

echo "PASS  dependency lock present, current, and pnpm version pinned at $expected_version"
