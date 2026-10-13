$ErrorActionPreference = 'Stop'
$root = (Get-Location).Path

function Replace-Text($path, $old, $new) {
  $full = Join-Path $root $path
  $text = Get-Content $full -Raw
  if (-not $text.Contains($old)) {
    throw "Expected text not found in $path`n--- expected ---`n$old"
  }
  $text = $text.Replace($old, $new)
  Set-Content -Path $full -Value $text -NoNewline
  Write-Host "Patched $path"
}

# 1) Authorisation resource kinds added by the domain-depth releases.
Replace-Text 'apps/api/src/platform/authz/authz.service.ts' `
"'platform_migration' | 'platform_rule';" `
"'platform_migration' | 'platform_rule' | 'maintenance_control' | 'reliability_control' | 'compliance_control' | 'master_data_governance' | 'engineering_control' | 'crew_control' | 'ops_control' | 'commercial_control' | 'quality_control' | 'safety_control' | 'analytics_control';"

# 2) DomainError already carries legitimate HTTP statuses beyond the original narrow union.
Replace-Text 'packages/kernel/src/index.ts' `
"constructor(public readonly code: string, message: string, public readonly status: 409 | 422 | 404 = 422)" `
"constructor(public readonly code: string, message: string, public readonly status: number = 422)"

# 3) Master-data resource literal must remain a literal ResourceRef kind.
Replace-Text 'apps/api/src/modules/compliance/master-data.service.ts' `
"private res(operatorId:string,id='*'){return {kind:'master_data_governance',id,attr:{operatorId}};}" `
"private res(operatorId:string,id='*'){return {kind:'master_data_governance' as const,id,attr:{operatorId}};}"

# 4) Audit helpers accept unknown inputs but the audit service requires a JSON object.
$files = @(
  'apps/api/src/modules/amo/maintenance-control.service.ts',
  'apps/api/src/modules/amo/supply-control.service.ts',
  'apps/api/src/modules/engineering/engineering-control.service.ts',
  'apps/api/src/modules/org/commercial-control.service.ts'
)
foreach ($f in $files) {
  $full = Join-Path $root $f
  $text = Get-Content $full -Raw
  $text = $text -replace 'entityId,data\}\)', 'entityId,data:data as Record<string,unknown>})'
  $text = $text -replace 'entityId:id,data\}\)', 'entityId:id,data:data as Record<string,unknown>})'
  Set-Content -Path $full -Value $text -NoNewline
  Write-Host "Patched audit data typing in $f"
}

# 5) QueryResult is not iterable; use rows.
Replace-Text 'apps/api/src/modules/amo/maintenance-control.service.ts' `
"const [prod]=await this.db.db.execute<Record<string,unknown>>(sql``select * from amo.work_package_production where operator_id=`${p.operatorId} and wp_id=`${wpId}``);" `
"const prodResult=await this.db.db.execute<Record<string,unknown>>(sql``select * from amo.work_package_production where operator_id=`${p.operatorId} and wp_id=`${wpId}``);const prod=prodResult.rows[0]??null;"

# 6) Remove genuinely unused Supply imports.
$full = Join-Path $root 'apps/api/src/modules/amo/supply-control.service.ts'
$text = Get-Content $full -Raw
$text = $text.Replace("import { stock, reservations } from './stores.service';", "import { stock } from './stores.service';")
$text = $text -replace ', purchaseOrders,', ', '
$text = $text -replace 'purchaseOrders, ', ''
Set-Content -Path $full -Value $text -NoNewline
Write-Host 'Patched Supply unused imports'

# 7) pgSchema belongs to drizzle-orm/pg-core.
Replace-Text 'apps/api/src/modules/amo/supply-logistics.service.ts' `
"import { and, asc, eq, gte, pgSchema, sql } from 'drizzle-orm';" `
"import { and, asc, eq, gte, sql } from 'drizzle-orm';"
Replace-Text 'apps/api/src/modules/amo/supply-logistics.service.ts' `
"import { date, integer, text, timestamp } from 'drizzle-orm/pg-core';" `
"import { date, integer, pgSchema, text, timestamp } from 'drizzle-orm/pg-core';"

# 8) Supply helper scope: use operatorId parameter, not an out-of-scope Principal p.
$full = Join-Path $root 'apps/api/src/modules/amo/supply.service.ts'
$text = Get-Content $full -Raw
$text = $text.Replace('eq(stock.operatorId, p.operatorId)', 'eq(stock.operatorId, operatorId)')
$text = $text.Replace('{ operatorId: p.operatorId, partNo, location: station, qty }', '{ operatorId, partNo, location: station, qty }')
Set-Content -Path $full -Value $text -NoNewline
Write-Host 'Patched Supply operator scope helpers'

# 9) Dispatch ETD is serialized; normalize before comparing milliseconds.
Replace-Text 'apps/api/src/modules/ops/dispatch.service.ts' `
"Math.abs(new Date(ofp.etd).getTime() - f.etd.getTime()) <= 60_000" `
"Math.abs(new Date(ofp.etd).getTime() - new Date(f.etd).getTime()) <= 60_000"

# 10) Remove unused Query import.
Replace-Text 'apps/api/src/modules/ops/flight-watch.service.ts' `
"import { Body, Controller, Get, Inject, Injectable, Param, Post, Query } from '@nestjs/common';" `
"import { Body, Controller, Get, Inject, Injectable, Param, Post } from '@nestjs/common';"

# 11) Include dutyNo in the pairing-leg projection because DTO mapping reads it.
Replace-Text 'apps/api/src/modules/ops/rostering.service.ts' `
"select({ pairingId: pairingLegs.pairingId, seq: pairingLegs.seq, flight: flights })" `
"select({ pairingId: pairingLegs.pairingId, seq: pairingLegs.seq, dutyNo: pairingLegs.dutyNo, flight: flights })"

# 12) Remove unused isNull import in records control.
$full = Join-Path $root 'apps/api/src/modules/records/records-control.service.ts'
$text = Get-Content $full -Raw
$text = $text -replace ', isNull', ''
$text = $text -replace 'isNull, ', ''
Set-Content -Path $full -Value $text -NoNewline
Write-Host 'Patched Records unused import'

# 13) Analytics: normalize Zod-inferred filters to the persisted Filter contract.
$full = Join-Path $root 'apps/api/src/platform/analytics/analytics.service.ts'
$text = Get-Content $full -Raw
$text = $text.Replace('defaultFilters:b.defaultFilters,rowLevelScope:b.rowLevelScope', 'defaultFilters:b.defaultFilters as Filter[],rowLevelScope:b.rowLevelScope')
$text = $text.Replace('filters:b.filters,sortDefinition:b.sortDefinition', 'filters:b.filters as Filter[],sortDefinition:b.sortDefinition')
Set-Content -Path $full -Value $text -NoNewline
Write-Host 'Patched Analytics filter persistence typing'

# 14) NestJS version does not export TooManyRequestsException; use HttpException(429).
Replace-Text 'apps/api/src/platform/http/rate-limit.guard.ts' `
"import { CanActivate, ExecutionContext, Inject, Injectable, TooManyRequestsException } from '@nestjs/common';" `
"import { CanActivate, ExecutionContext, HttpException, Inject, Injectable } from '@nestjs/common';"
Replace-Text 'apps/api/src/platform/http/rate-limit.guard.ts' `
"throw new TooManyRequestsException(``Rate limit exceeded; retry in `${row.retry_after} seconds``);" `
"throw new HttpException(``Rate limit exceeded; retry in `${row.retry_after} seconds``, 429);"

Write-Host ''
Write-Host 'AeroOS 0.50.0 API typecheck patch applied.' -ForegroundColor Green
Write-Host 'Run: pnpm exec nx reset'
Write-Host 'Then: pnpm typecheck'
