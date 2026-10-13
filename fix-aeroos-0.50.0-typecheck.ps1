$ErrorActionPreference = 'Stop'

function Replace-Exact([string]$Path, [string]$Old, [string]$New) {
  $text = Get-Content -Raw -LiteralPath $Path
  if (-not $text.Contains($Old)) { throw "Expected text not found in $Path" }
  $text = $text.Replace($Old, $New)
  Set-Content -LiteralPath $Path -Value $text -NoNewline
}

# 1) Resolve duplicate MsnRange barrel export.
Replace-Exact 'packages/mro-domain/src/configuration.ts' `
'export interface MsnRange { from: string; to: string }
export interface Effectivity { tails?: string[]; msnRanges?: MsnRange[] }' `
'export interface ConfigurationMsnRange { from: string; to: string }
export interface Effectivity { tails?: string[]; msnRanges?: ConfigurationMsnRange[] }'

# 2) Normalize richer work-package values to the stable released-event contract.
Replace-Exact 'packages/mro-domain/src/work-package.ts' `
"        wpId: wp.id, tail: wp.tail, aircraftType: wp.aircraftType, title: wp.title, station: wp.station, checkType: wp.checkType, priority: wp.priority," `
"        wpId: wp.id, tail: wp.tail, aircraftType: wp.aircraftType, title: wp.title, station: wp.station,`n        checkType: wp.checkType === 'A_CHECK' ? 'A' : wp.checkType === 'C_CHECK' ? 'C' : 'OTHER',`n        priority: wp.priority === 'NORMAL' ? 'ROUTINE' : wp.priority,"

# 3) Satisfy Card's required title prop on summary metric cards.
$metricFiles = @(
  'apps/web/src/features/crew/CrewControl.tsx',
  'apps/web/src/features/engineering/EngineeringControl.tsx',
  'apps/web/src/features/ops/OperationsControl.tsx',
  'apps/web/src/features/programme/ReliabilityControl.tsx',
  'apps/web/src/features/quality/QualityControl.tsx',
  'apps/web/src/features/records/TechnicalRecords.tsx',
  'apps/web/src/features/safety/SafetyControl.tsx'
)
foreach ($file in $metricFiles) {
  $text = Get-Content -Raw -LiteralPath $file
  $before = $text
  $text = $text.Replace('return <Card><div style={{fontSize:24,fontWeight:800}}>{n}</div><div className="sub">{l}</div></Card>', 'return <Card title={l}><div style={{fontSize:24,fontWeight:800}}>{n}</div></Card>')
  $text = $text.Replace('return <Card><div style={{fontSize:24,fontWeight:800}}>{n??0}</div><div className="sub">{l}</div></Card>', 'return <Card title={l}><div style={{fontSize:24,fontWeight:800}}>{n??0}</div></Card>')
  if ($text -eq $before) { throw "Metric Card pattern not found in $file" }
  Set-Content -LiteralPath $file -Value $text -NoNewline
}

# 4) Supply UI type/cleanup fixes.
Replace-Exact 'apps/web/src/features/stores/SupplyControl.tsx' `
"import { useMemo, useState } from 'react';" `
"import { useState } from 'react';"

Replace-Exact 'apps/web/src/features/stores/SupplyControl.tsx' `
'type Policy={id:string;partNo:string;station:string;minQty:number;maxQty:number;reorderQty:number;leadDays:number;serviceLevel:string;preferredVendorId:string|null};' `
'type Policy={id:string;partNo:string;station:string;minQty:number;maxQty:number;reorderQty:number;leadDays:number;serviceLevel:string;preferredVendorId:string|null;active:boolean};'

Replace-Exact 'apps/web/src/features/stores/SupplyControl.tsx' `
'ent.error??rec.error??add.error??voidEnt.error??reconcile.error??cancel.error' `
'ent.error??rec.error??add.error??voidEnt.error??reconcile.error'

Write-Host 'AeroOS 0.50.0 typecheck fixes applied.' -ForegroundColor Green
Write-Host 'Next: pnpm exec nx reset; pnpm typecheck' -ForegroundColor Cyan
