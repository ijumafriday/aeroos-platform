import { Controller, Get, Header, Inject, Injectable, Query } from '@nestjs/common';
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { COMPLIANCE_MATRIX, DATA_TO_REPLACE, type MatrixScope } from '@aeroos/compliance';
import type { ComplianceMatrixDto } from '@aeroos/contracts';
import { DomainError } from '@aeroos/kernel';
import { CurrentPrincipal, type Principal } from '../../platform/auth/principal';
import { AuthzService } from '../../platform/authz/authz.service';
import { DB_TOKEN, type ModuleDb } from '../../platform/database/module-db';
import { auditLog } from '../../platform/database/platform.tables';
import { ComplianceService } from './compliance.service';

const DAY = 86_400_000;
const SCOPES: MatrixScope[] = ['PART-CAMO', 'PART-145', 'PART-ORO', 'PART-CAT', 'PART-M', 'PART-21', 'PLATFORM'];
const csvCell = (v: string | number | null) => {
  const raw = v === null ? '' : String(v);
  const s = typeof v === 'string' && /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw; // never a spreadsheet formula
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * The compliance traceability matrix (packages/compliance/src/matrix.ts) with live evidence: for each requirement,
 * how often its audit actions were recorded for this operator in the period, and when last. An inspector uses it
 * to choose what to sample; it is also put into the evidence pack.
 */
@Injectable()
export class MatrixService {
  constructor(@Inject(DB_TOKEN.platform) private readonly db: ModuleDb, private readonly authz: AuthzService, private readonly compliance: ComplianceService) {}

  /** `chains`: count only entries on these audit chains (an evidence pack counts what it contains). */
  async build(operatorId: string, from: Date, to: Date, scope?: string, chains?: string[]): Promise<ComplianceMatrixDto> {
    if (scope && !SCOPES.includes(scope as MatrixScope)) throw new DomainError('SCOPE', `scope is one of ${SCOPES.join(', ')}`, 422);
    const rows = COMPLIANCE_MATRIX.filter(r => !scope || r.scope === scope);
    const actions = [...new Set(rows.flatMap(r => r.evidence.auditActions ?? []))];
    const counts = actions.length ? await this.db.db.select({ action: auditLog.action, n: sql<string>`count(*)::text`, last: sql<Date | null>`max(${auditLog.at})` })
      .from(auditLog).where(and(eq(auditLog.operatorId, operatorId), inArray(auditLog.action, actions), gte(auditLog.at, from), lt(auditLog.at, to), ...(chains ? [inArray(auditLog.chain, chains.length ? chains : [''])] : []))).groupBy(auditLog.action) : [];
    const by = new Map<string, { n: string; last: Date | null }>(counts.map(c => [c.action, { n: c.n, last: c.last }] as [string, { n: string; last: Date | null }]));
    const statuses = ['IMPLEMENTED', 'SUPPORTED', 'DATA', 'PROCEDURAL'];
    return {
      operatorId, from: from.toISOString(), to: to.toISOString(), chains: chains ?? null,
      rows: rows.map(r => ({
        id: r.id, scope: r.scope, reference: r.reference, title: r.title, exposition: r.exposition, status: r.status, implementation: r.implementation,
        organisation: r.organisation ?? null,
        evidence: {
          tests: r.evidence.tests ?? [], rules: r.evidence.rules ?? [], policies: r.evidence.policies ?? [], routes: r.evidence.routes ?? [],
          auditActions: (r.evidence.auditActions ?? []).map(a => {
            const c = by.get(a);
            return { action: a, count: Number(c?.n ?? 0), last: c?.last ? new Date(c.last).toISOString() : null };
          })
        }
      })),
      summary: statuses.map(s => ({ status: s, count: rows.filter(r => r.status === s).length })),
      dataToReplace: DATA_TO_REPLACE,
      rulepacks: this.compliance.registry.list().map(p => ({ authority: p.authority, version: p.id.split('@')[1] ?? p.id, status: p.status }))
    };
  }

  async matrix(p: Principal, q: { scope?: string; days?: number }): Promise<ComplianceMatrixDto> {
    await this.authz.check(p, { kind: 'compliance_matrix', id: '*', attr: { operatorId: p.operatorId } }, 'read');
    const days = Math.min(Math.max(q.days ?? 365, 1), 1100);
    const to = new Date();
    return this.build(p.operatorId, new Date(to.getTime() - days * DAY), to, q.scope || undefined);
  }

  async csv(p: Principal, q: { scope?: string; days?: number }): Promise<string> {
    const m = await this.matrix(p, q);
    const head = ['id', 'scope', 'reference', 'title', 'exposition', 'status', 'implementation', 'organisation', 'tests', 'rules', 'policies', 'screens', 'audit actions (count, last)'];
    const lines = m.rows.map(r => [
      r.id, r.scope, r.reference, r.title, `${r.exposition.document} ${r.exposition.section}`, r.status, r.implementation, r.organisation,
      r.evidence.tests.map(t => `${t.file}: ${t.name}`).join(' | '), r.evidence.rules.join(' '), r.evidence.policies.join(' '), r.evidence.routes.join(' '),
      r.evidence.auditActions.map(a => `${a.action} (${a.count}${a.last ? `, ${a.last.slice(0, 10)}` : ''})`).join(' | ')
    ].map(csvCell).join(';'));
    return [head.join(';'), ...lines].join('\n') + '\n';
  }
}

@Controller('compliance/matrix')
export class MatrixController {
  constructor(private readonly m: MatrixService) {}
  @Get() matrix(@CurrentPrincipal() p: Principal, @Query('scope') scope?: string, @Query('days') days?: string) { return this.m.matrix(p, { scope, days: days ? Number(days) || undefined : undefined }); }
  @Get('export')
  @Header('content-type', 'text/csv; charset=utf-8')
  @Header('content-disposition', 'attachment; filename="aeroos-compliance-matrix.csv"')
  export(@CurrentPrincipal() p: Principal, @Query('scope') scope?: string) { return this.m.csv(p, { scope }); }
}
