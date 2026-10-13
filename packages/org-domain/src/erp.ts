import type { JournalDto } from '@aeroos/contracts';

export type ErpJournalFormat='CSV_JOURNAL_V1'|'JSON_JOURNAL_V1';
export interface ErpExportInput{format:ErpJournalFormat;entityId:string;entityName:string;period:string;baseCurrency:string;journals:JournalDto[];accountMap:Record<string,string>;costCentreMap:Record<string,string>}

const esc=(v:unknown)=>`"${String(v??'').replace(/"/g,'""')}"`;

/** Deterministic ERP journal rendering. Mapping changes external codes only; source journal identity is retained. */
export function erpExportContent(x:ErpExportInput):string{
  const mapped=[...x.journals].sort((a,b)=>a.id.localeCompare(b.id)).map(j=>({...j,lines:j.lines.map(l=>({...l,account:x.accountMap[l.account]??l.account,costCentre:l.costCentre?(x.costCentreMap[l.costCentre]??l.costCentre):null}))}));
  if(x.format==='JSON_JOURNAL_V1') return JSON.stringify({schema:'aeroos.erp.journal.v1',entity:x.entityId,entityName:x.entityName,period:x.period,baseCurrency:x.baseCurrency,journals:mapped},null,2)+'\n';
  const rows=['entity,period,journal,date,source,source_ref,memo,account,cost_centre,debit_cents,credit_cents'];
  for(const j of mapped) for(const l of j.lines) rows.push([x.entityId,x.period,j.id,j.date,j.source,j.sourceRef,j.memo,l.account,l.costCentre??'',l.debitCents,l.creditCents].map(esc).join(','));
  return rows.join('\n')+'\n';
}
