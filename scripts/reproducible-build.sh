#!/usr/bin/env bash
set -euo pipefail

# Resolve a working Python 3 interpreter portably.
PYTHON_BIN=""
for candidate in python3 python; do
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c "import sys; raise SystemExit(0 if sys.version_info.major == 3 else 1)" >/dev/null 2>&1; then
    PYTHON_BIN="$candidate"
    break
  fi
done
[ -n "$PYTHON_BIN" ] || { echo "FAIL: working Python 3 interpreter is required"; exit 1; }

cd "$(dirname "$0")/.."
[ -f pnpm-lock.yaml ] || { echo 'FAIL: pnpm-lock.yaml is mandatory for reproducible builds' >&2; exit 2; }
command -v pnpm >/dev/null || { echo 'FAIL: pnpm is not installed' >&2; exit 2; }
expected=$(node -p "require('./package.json').packageManager")
actual="pnpm@$(pnpm --version)"
[ "$actual" = "$expected" ] || { echo "FAIL: package manager mismatch: expected $expected, got $actual" >&2; exit 2; }
pnpm install --frozen-lockfile
pnpm lint
pnpm check
pnpm build
pnpm typecheck
pnpm test
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
"$PYTHON_BIN" scripts/package-release.py "$work/a.zip" >/dev/null
"$PYTHON_BIN" scripts/package-release.py "$work/b.zip" >/dev/null
ha=$(sha256sum "$work/a.zip" | awk '{print $1}')
hb=$(sha256sum "$work/b.zip" | awk '{print $1}')
[ "$ha" = "$hb" ] || { echo "FAIL: source package is not reproducible: $ha != $hb" >&2; exit 1; }
echo "PASS: reproducible AeroOS source package $ha"
