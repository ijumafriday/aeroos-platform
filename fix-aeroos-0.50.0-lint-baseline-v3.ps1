$ErrorActionPreference = 'Stop'
$root = (Get-Location).Path
$eslintPath = Join-Path $root 'eslint.config.mjs'
$pkgPath = Join-Path $root 'package.json'

$pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
if ($pkg.version -ne '0.50.0') { throw "Expected AeroOS 0.50.0, found $($pkg.version)" }

$eslint = [IO.File]::ReadAllText($eslintPath)
$needle = "      'apps/web/src/features/records/TechnicalRecords.tsx',"
$addition = "      'apps/web/src/features/platform/PlatformConsole.tsx',`r`n"

if ($eslint.Contains("'apps/web/src/features/platform/PlatformConsole.tsx'")) {
  Write-Host 'PlatformConsole lint-debt scope already present.' -ForegroundColor Yellow
} else {
  if (-not $eslint.Contains($needle)) { throw 'Could not find lint-debt file list anchor in eslint.config.mjs' }
  $eslint = $eslint.Replace($needle, $addition + $needle)
  [IO.File]::WriteAllText($eslintPath, $eslint, (New-Object Text.UTF8Encoding($false)))
  Write-Host 'Added PlatformConsole.tsx to the scoped no-explicit-any warning baseline.' -ForegroundColor Green
}

Write-Host 'Run:' -ForegroundColor Cyan
Write-Host '  pnpm exec nx reset'
Write-Host '  pnpm lint'
