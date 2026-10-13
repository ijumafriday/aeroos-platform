import { createHash, randomUUID } from 'node:crypto';
import { Body, Controller, Get, Header, Inject, Injectable, Param, Post, Query } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { bigint, bigserial, boolean, date, integer, jsonb, numeric, pgSchema, serial, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import type { EnterpriseDto, ErpIntegrationDto, EventEnvelope, JournalDto, LedgerDto } from '@aeroos/contracts';
import { DomainError } from '@aeroos/kernel';
import {
  ACC, assertBalanced, checkClose, erpExportContent, invoicePosting, journalCsv, paymentPosting, periodOf, postingPeriod, profitAndLoss, receiptPosting, trialBalance,
  type Account, type AccountType, type JournalLine, type Posting
} from '@aeroos/org-domain';
import { actorOf, CurrentPrincipal, type Principal } from '../../platform/auth/principal';
import { AuditService } from '../../platform/audit/audit.service';
import { AuthzService } from '../../platform/authz/authz.service';
import { DB_TOKEN, type ModuleDb } from '../../platform/database/module-db';
import { InboxService } from '../../platform/events/outbox';
import { ZodPipe } from '../../platform/http/http';
import { correctiveActions, findings, occurrences } from './org.tables';

const org = pgSchema('org');
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const legalEntities = org.table('legal_entities', {
  id: text('id').primaryKey(), name: text('name').notNull(), country: text('country').notNull(), currency: text('currency').notNull(),
  parentId: text('parent_id'), operatorId: text('operator_id').notNull(), orgNumber: text('org_number')
});
export const entityApprovals = org.table('entity_approvals', {
  id: serial('id').primaryKey(), entityId: text('entity_id').notNull(), kind: text('kind').notNull(), reference: text('reference').notNull(),
  authority: text('authority').notNull(), validUntil: date('valid_until', { mode: 'string' }), scope: text('scope').notNull()
});
export const costCentres = org.table('cost_centres', {
  code: text('code').primaryKey(), entityId: text('entity_id').notNull(), name: text('name').notNull(), kind: text('kind').notNull(), manager: text('manager'), active: boolean('active').notNull().default(true)
});
export const glAccounts = org.table('gl_accounts', { code: text('code').primaryKey(), name: text('name').notNull(), type: text('type').notNull() });
export const glPeriods = org.table('gl_periods', {
  entityId: text('entity_id').notNull(), period: text('period').notNull(), status: text('status').notNull(), closedBy: text('closed_by'), closedAt: ts('closed_at')
});
export const journalEntries = org.table('journal_entries', {
  id: text('id').primaryKey(), entityId: text('entity_id').notNull(), operatorId: text('operator_id').notNull(), entryDate: date('entry_date', { mode: 'string' }).notNull(),
  period: text('period').notNull(), source: text('source').notNull(), sourceRef: text('source_ref').notNull(), memo: text('memo').notNull(),
  currency: text('currency').notNull(), basePerUnit: numeric('base_per_unit', { precision: 14, scale: 6 }).notNull(), postedBy: text('posted_by').notNull(), postedAt: ts('posted_at').notNull().defaultNow()
});
export const journalLines = org.table('journal_lines', {
  id: bigserial('id', { mode: 'number' }).primaryKey(), entryId: text('entry_id').notNull(), account: text('account').notNull(), costCentre: text('cost_centre'),
  debitCents: bigint('debit_cents', { mode: 'number' }).notNull(), creditCents: bigint('credit_cents', { mode: 'number' }).notNull()
});

export const erpProfiles = org.table('erp_profiles', {
  id: uuid('id').primaryKey(), operatorId: text('operator_id').notNull(), entityId: text('entity_id').notNull(), name: text('name').notNull(), format: text('format').notNull(),
  accountMap: jsonb('account_map').$type<Record<string,string>>().notNull().default({}), costCentreMap: jsonb('cost_centre_map').$type<Record<string,string>>().notNull().default({}), active: boolean('active').notNull().default(true),
  createdBy: text('created_by').notNull(), createdAt: ts('created_at').notNull().defaultNow(), updatedBy: text('updated_by').notNull(), updatedAt: ts('updated_at').notNull().defaultNow()
});
export const erpExportBatches = org.table('erp_export_batches', {
  id: uuid('id').primaryKey(), operatorId: text('operator_id').notNull(), entityId: text('entity_id').notNull(), profileId: uuid('profile_id').notNull(), period: text('period').notNull(), format: text('format').notNull(),
  status: text('status').notNull().default('GENERATED'), content: text('content').notNull(), contentSha256: text('content_sha256').notNull(), journalCount: integer('journal_count').notNull(),
  debitCents: bigint('debit_cents', { mode: 'number' }).notNull(), creditCents: bigint('credit_cents', { mode: 'number' }).notNull(), generatedBy: text('generated_by').notNull(), generatedAt: ts('generated_at').notNull().defaultNow(),
  acknowledgementRef: text('acknowledgement_ref'), acknowledgementNote: text('acknowledgement_note'), acknowledgedBy: text('acknowledged_by'), acknowledgedAt: ts('acknowledged_at')
});

const CHAIN = 'org';
const BASE = 'USD';
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Enterprise structure and the general ledger (ADR-0025). Automatic postings come from AMO events (invoices,
 * credit notes, payments, goods receipts) exactly once per source document; finance posts manual journals,
 * closes periods in order and exports journals for the ERP.
 */
@Injectable()
export class FinanceService {
  constructor(
    @Inject(DB_TOKEN.org) private readonly db: ModuleDb,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
    private readonly inbox: InboxService
  ) {}

  private ledgerRes(operatorId: string, id = '*') { return { kind: 'ledger' as const, id, attr: { operatorId } }; }
  private entRes(operatorId: string) { return { kind: 'enterprise' as const, id: '*', attr: { operatorId } }; }

  /* ------------------------------------------------------------------ enterprise */

  async enterprise(p: Principal): Promise<EnterpriseDto> {
    await this.authz.check(p, this.entRes(p.operatorId), 'read');
    const ents = await this.db.db.select().from(legalEntities).where(eq(legalEntities.operatorId, p.operatorId)).orderBy(asc(legalEntities.id));
    const ids = ents.map(e => e.id);
    const [apps, ccs, perms] = await Promise.all([
      ids.length ? this.db.db.select().from(entityApprovals).where(inArray(entityApprovals.entityId, ids)).orderBy(asc(entityApprovals.kind)) : [],
      ids.length ? this.db.db.select().from(costCentres).where(inArray(costCentres.entityId, ids)).orderBy(asc(costCentres.code)) : [],
      this.authz.decide(p, this.entRes(p.operatorId), ['manage'])
    ]);
    const t = Date.parse(`${today()}T00:00:00Z`);
    return {
      entities: ents.map(e => ({
        id: e.id, name: e.name, country: e.country, currency: e.currency, parentId: e.parentId, orgNumber: e.orgNumber,
        approvals: apps.filter(a => a.entityId === e.id).map(a => ({ kind: a.kind, reference: a.reference, authority: a.authority, validUntil: a.validUntil, scope: a.scope,
          daysLeft: a.validUntil ? Math.round((Date.parse(`${a.validUntil}T00:00:00Z`) - t) / 86_400_000) : null })),
        costCentres: ccs.filter(c => c.entityId === e.id).map(c => ({ code: c.code, name: c.name, kind: c.kind, manager: c.manager, active: c.active }))
      })),
      permissions: { manage: perms.manage }
    };
  }

  async addCostCentre(p: Principal, b: { code: string; entityId: string; name: string; kind: string; manager?: string }) {
    await this.authz.check(p, this.entRes(p.operatorId), 'manage');
    const [e] = await this.db.db.select().from(legalEntities).where(and(eq(legalEntities.id, b.entityId), eq(legalEntities.operatorId, p.operatorId)));
    if (!e) throw new DomainError('ENTITY_NOT_FOUND', `Entity ${b.entityId} not found`, 404);
    await this.db.transaction(async () => {
      const [dup] = await this.db.db.select({ c: costCentres.code }).from(costCentres).where(eq(costCentres.code, b.code));
      if (dup) throw new DomainError('EXISTS', `Cost centre ${b.code} exists`, 409);
      await this.db.db.insert(costCentres).values({ code: b.code, entityId: e.id, name: b.name.trim(), kind: b.kind, manager: b.manager?.trim() || null });
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'cost_centre.created', entityType: 'cost_centre', entityId: b.code, data: b });
    });
    return this.enterprise(p);
  }

  /* ------------------------------------------------------------------ posting */

  private async closedPeriods(entityId: string) {
    const rows = await this.db.db.select().from(glPeriods).where(eq(glPeriods.entityId, entityId));
    return new Set<string>(rows.filter(r => r.status === 'CLOSED').map(r => r.period));
  }

  /** Book one posting (inside the caller's transaction); idempotent per (source, sourceRef). Returns the entry id or null if already booked. */
  private async book(entityId: string, operatorId: string, source: string, sourceRef: string, posting: Posting, currency: string, basePerUnit: number, by: string): Promise<string | null> {
    assertBalanced(posting.lines);
    const [exists] = await this.db.db.select({ id: journalEntries.id }).from(journalEntries).where(and(eq(journalEntries.source, source), eq(journalEntries.sourceRef, sourceRef)));
    if (exists) return null;
    // serialise against the period close of this entity
    await this.db.db.execute(sql`select pg_advisory_xact_lock(hashtext(${'ledger:' + entityId}))`);
    const target = postingPeriod(posting.date, await this.closedPeriods(entityId));
    await this.db.db.insert(glPeriods).values({ entityId, period: target.period, status: 'OPEN' }).onConflictDoNothing();
    const r = await this.db.db.execute<{ n: string }>(sql`select nextval('org.journal_seq')::text as n`);
    const id = `JE-${r.rows[0].n.padStart(6, '0')}`;
    await this.db.db.insert(journalEntries).values({
      id, entityId, operatorId, entryDate: posting.date, period: target.period, source, sourceRef,
      memo: target.late ? `${posting.memo} [dated ${posting.date}, ${periodOf(posting.date)} closed]` : posting.memo, currency, basePerUnit: String(basePerUnit), postedBy: by
    });
    await this.db.db.insert(journalLines).values(posting.lines.map(l => ({ entryId: id, account: l.account, costCentre: l.costCentre, debitCents: l.debitCents, creditCents: l.creditCents })));
    return id;
  }

  /**
   * The revenue cost centre of a third-party invoice: the one named on the order if it is an active MRO-sales centre
   * of this operator's own entities, otherwise the operator's default MRO-sales centre (never another tenant's).
   */
  private async revenueCentre(operatorId: string, code: string | null): Promise<{ c: typeof costCentres.$inferSelect; note: string | null } | null> {
    const rows = await this.db.db.select({ c: costCentres }).from(costCentres).innerJoin(legalEntities, eq(legalEntities.id, costCentres.entityId))
      .where(and(eq(legalEntities.operatorId, operatorId), eq(costCentres.kind, 'MRO_SALES'), eq(costCentres.active, true))).orderBy(asc(costCentres.code));
    const named = code ? rows.find(r => r.c.code === code) : undefined;
    if (named) return { c: named.c, note: null };
    if (!rows.length) return null;
    return { c: rows[0].c, note: code ? `cost centre ${code} is not an MRO-sales centre of this operator — booked to ${rows[0].c.code}` : null };
  }
  /** The operator's stores cost centre (goods receipts land in its entity). */
  private async storesCentre(operatorId: string) {
    const rows = await this.db.db.select({ c: costCentres }).from(costCentres).innerJoin(legalEntities, eq(legalEntities.id, costCentres.entityId))
      .where(and(eq(legalEntities.operatorId, operatorId), eq(costCentres.kind, 'STORES'), eq(costCentres.active, true))).orderBy(asc(costCentres.code)).limit(1);
    return rows[0]?.c ?? null;
  }

  async onAmoEvent(env: EventEnvelope) {
    if (!['amo.invoice.issued', 'amo.payment.received', 'amo.goods.received'].includes(env.type)) return;
    await this.inbox.once(this.db, 'org.ledger', env, async () => {
      if (env.type === 'amo.invoice.issued') {
        const d = (env as EventEnvelope<'amo.invoice.issued'>).data;
        const rc = await this.revenueCentre(env.operatorId, d.costCentre || null);
        // no MRO-sales cost centre at all: fail, so the event is retried and dead-lettered (replayable) instead of lost
        if (!rc) throw new Error(`${d.invoiceId}: operator ${env.operatorId} has no active MRO-sales cost centre — create one and replay the event`);
        const posting = invoicePosting({ invoiceId: d.invoiceId, customer: d.customerName, issuedAt: d.issuedOn, currency: d.currency, basePerUnit: d.basePerUnit,
          labourCents: d.labourCents, partsCents: d.partsCents, serviceCents: d.serviceCents, vatCents: d.vatCents, credit: d.kind === 'CREDIT_NOTE' }, rc.c.code);
        if (!posting) return; // zero-value invoice: nothing to post
        await this.book(rc.c.entityId, env.operatorId, env.type, d.invoiceId, rc.note ? { ...posting, memo: `${posting.memo} [${rc.note}]` } : posting, d.currency, d.basePerUnit, 'system:ledger');
      } else if (env.type === 'amo.payment.received') {
        const d = (env as EventEnvelope<'amo.payment.received'>).data;
        // the payment goes to the entity that booked the invoice
        const [inv] = await this.db.db.select().from(journalEntries)
          .where(and(eq(journalEntries.source, 'amo.invoice.issued'), eq(journalEntries.sourceRef, d.invoiceId), eq(journalEntries.operatorId, env.operatorId)));
        if (!inv) throw new Error(`Payment ${d.reference}: invoice ${d.invoiceId} is not in the ledger yet — retry`);
        // the settling payment clears what is left of the receivable in base currency (no rounding residue)
        let remaining: number | null = null;
        if (d.settles) {
          const r = await this.db.db.execute<{ due: string }>(sql`
            select (coalesce(sum(l.debit_cents) filter (where e.id = ${inv.id}), 0)
                  - coalesce(sum(l.credit_cents) filter (where e.source = 'amo.payment.received'), 0))::text as due
            from org.journal_lines l join org.journal_entries e on e.id = l.entry_id
            where l.account = ${ACC.receivables} and (e.id = ${inv.id} or (e.source = 'amo.payment.received' and e.source_ref like ${d.invoiceId + ':%'}))`);
          remaining = Number(r.rows[0]?.due ?? 0);
        }
        const posting = paymentPosting({ invoiceId: d.invoiceId, customer: d.customerName, at: d.receivedOn, amountCents: d.amountCents, basePerUnit: d.basePerUnit, reference: d.reference, remainingBaseCents: remaining });
        if (!posting) return;
        await this.book(inv.entityId, env.operatorId, env.type, `${d.invoiceId}:${d.reference}`, posting, d.currency, d.basePerUnit, 'system:ledger');
      } else {
        const d = (env as EventEnvelope<'amo.goods.received'>).data;
        const cc = await this.storesCentre(env.operatorId);
        if (!cc) throw new Error(`Goods receipt ${d.receiptId}: operator ${env.operatorId} has no active stores cost centre — create one and replay the event`);
        const posting = receiptPosting({ receiptId: d.receiptId, poId: d.poId, partNo: d.partNo, qty: d.qty, amountBaseCents: d.amountBaseCents, at: d.receivedAt }, cc.code);
        if (!posting) return;
        await this.book(cc.entityId, env.operatorId, env.type, d.receiptId, posting, d.currency, d.basePerUnit, 'system:ledger');
      }
    });
  }

  /* ------------------------------------------------------------------ ledger views */

  private async entityOf(p: Principal, id?: string) {
    const ents = await this.db.db.select().from(legalEntities).where(eq(legalEntities.operatorId, p.operatorId)).orderBy(asc(legalEntities.id));
    if (!ents.length) throw new DomainError('NO_ENTITY', 'No legal entity for this operator', 404);
    const e = id ? ents.find(x => x.id === id) : ents.find(x => x.parentId !== null) ?? ents[0];
    if (!e) throw new DomainError('ENTITY_NOT_FOUND', `Entity ${id} not found`, 404);
    return { e, ents };
  }

  private async linesFor(entityId: string, period: string) {
    return this.db.db.select({ l: journalLines, e: journalEntries }).from(journalLines).innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .where(and(eq(journalEntries.entityId, entityId), eq(journalEntries.period, period)));
  }

  async ledger(p: Principal, entityId?: string, periodQ?: string): Promise<LedgerDto> {
    await this.authz.check(p, this.ledgerRes(p.operatorId), 'read');
    const { e, ents } = await this.entityOf(p, entityId);
    const period = periodQ && /^\d{4}-\d{2}$/.test(periodQ) ? periodQ : periodOf(today());
    const [periods, accounts, rows, ccs, perms] = await Promise.all([
      this.db.db.select().from(glPeriods).where(eq(glPeriods.entityId, e.id)).orderBy(desc(glPeriods.period)),
      this.db.db.select().from(glAccounts).orderBy(asc(glAccounts.code)),
      this.linesFor(e.id, period),
      this.db.db.select().from(costCentres).where(eq(costCentres.entityId, e.id)).orderBy(asc(costCentres.code)),
      this.authz.decide(p, this.ledgerRes(p.operatorId, e.id), ['post', 'close', 'integrate'])
    ]);
    const acc: Account[] = accounts.map(a => ({ code: a.code, name: a.name, type: a.type as AccountType }));
    const booked = rows.map(r => ({ account: r.l.account, costCentre: r.l.costCentre, debitCents: r.l.debitCents, creditCents: r.l.creditCents, period }));
    const name = new Map(acc.map(a => [a.code, a.name]));
    const entries = new Map<string, JournalDto>();
    for (const r of rows) {
      const j: JournalDto = entries.get(r.e.id) ?? { id: r.e.id, entityId: r.e.entityId, date: r.e.entryDate, period: r.e.period, source: r.e.source, sourceRef: r.e.sourceRef, memo: r.e.memo,
        postedBy: r.e.postedBy, postedAt: r.e.postedAt.toISOString(), lines: [] };
      j.lines.push({ account: r.l.account, accountName: name.get(r.l.account) ?? r.l.account, costCentre: r.l.costCentre, debitCents: r.l.debitCents, creditCents: r.l.creditCents });
      entries.set(r.e.id, j);
    }
    return {
      entityId: e.id, entities: ents.map(x => ({ id: x.id, name: x.name })), period, baseCurrency: BASE,
      periods: periods.map(x => ({ period: x.period, status: x.status as 'OPEN' | 'CLOSED', closedBy: x.closedBy, closedAt: x.closedAt?.toISOString() ?? null })),
      trialBalance: trialBalance(booked, acc), profitAndLoss: profitAndLoss(booked, acc),
      journals: [...entries.values()].sort((a, b) => b.id.localeCompare(a.id)),
      accounts: acc, costCentres: ccs.filter(c => c.active).map(c => ({ code: c.code, name: c.name })),
      permissions: { post: perms.post, close: perms.close, integrate: perms.integrate }
    };
  }

  async manualJournal(p: Principal, b: { entityId: string; date: string; memo: string; lines: JournalLine[] }) {
    await this.authz.check(p, this.ledgerRes(p.operatorId, b.entityId), 'post');
    const { e } = await this.entityOf(p, b.entityId);
    assertBalanced(b.lines);
    const known = new Set((await this.db.db.select({ c: glAccounts.code }).from(glAccounts)).map(x => x.c));
    const ccs = new Map<string, typeof costCentres.$inferSelect>((await this.db.db.select().from(costCentres).where(eq(costCentres.entityId, e.id))).map(c => [c.code, c] as [string, typeof costCentres.$inferSelect]));
    for (const l of b.lines) {
      if (!known.has(l.account)) throw new DomainError('ACCOUNT', `Unknown account ${l.account}`, 422);
      if (l.costCentre && !ccs.get(l.costCentre)?.active) throw new DomainError('COST_CENTRE', `${l.costCentre} is not an active cost centre of ${e.name}`, 422);
    }
    if (postingPeriod(b.date, await this.closedPeriods(e.id)).late) throw new DomainError('PERIOD_CLOSED', `${periodOf(b.date)} is closed — date the journal in an open period`, 422);
    await this.db.transaction(async () => {
      const ref = `MAN-${randomUUID()}`;
      const id = await this.book(e.id, p.operatorId, 'manual', ref, { date: b.date, memo: b.memo.trim(), lines: b.lines }, BASE, 1, actorOf(p));
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'journal.posted', entityType: 'journal', entityId: id ?? ref,
        data: { entity: e.id, date: b.date, memo: b.memo, lines: b.lines } });
    });
    return this.ledger(p, e.id, periodOf(b.date));
  }

  async closePeriod(p: Principal, entityId: string, period: string) {
    await this.authz.check(p, this.ledgerRes(p.operatorId, entityId), 'close');
    const { e } = await this.entityOf(p, entityId);
    if (period >= periodOf(today())) throw new DomainError('PERIOD_OPEN', 'Only past months can be closed', 422);
    await this.db.transaction(async () => {
      await this.db.db.execute(sql`select pg_advisory_xact_lock(hashtext(${'ledger:' + e.id}))`);
      const all = await this.db.db.select().from(glPeriods).where(eq(glPeriods.entityId, e.id)).orderBy(asc(glPeriods.period));
      checkClose(period, new Set(all.filter(x => x.status === 'CLOSED').map(x => x.period)), all[0]?.period ?? period);
      const rows = await this.linesFor(e.id, period);
      await this.db.db.insert(glPeriods).values({ entityId: e.id, period, status: 'CLOSED', closedBy: actorOf(p), closedAt: new Date() })
        .onConflictDoUpdate({ target: [glPeriods.entityId, glPeriods.period], set: { status: 'CLOSED', closedBy: actorOf(p), closedAt: new Date() } });
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'period.closed', entityType: 'ledger', entityId: `${e.id}:${period}`, data: { entries: new Set(rows.map(r => r.e.id)).size } });
    });
    return this.ledger(p, e.id, period);
  }

  async exportCsv(p: Principal, entityId: string | undefined, period: string): Promise<string> {
    await this.authz.check(p, this.ledgerRes(p.operatorId), 'read');
    if (!/^\d{4}-\d{2}$/.test(period)) throw new DomainError('PERIOD', 'period must be YYYY-MM', 422);
    const { e } = await this.entityOf(p, entityId);
    const rows = await this.linesFor(e.id, period);
    const byId = new Map<string, { id: string; date: string; period: string; source: string; memo: string; lines: JournalLine[] }>();
    for (const r of rows.sort((a, b) => a.e.id.localeCompare(b.e.id) || a.l.id - b.l.id)) {
      const x: { id: string; date: string; period: string; source: string; memo: string; lines: JournalLine[] } = byId.get(r.e.id) ?? { id: r.e.id, date: r.e.entryDate, period: r.e.period, source: r.e.source, memo: r.e.memo, lines: [] };
      x.lines.push({ account: r.l.account, costCentre: r.l.costCentre, debitCents: r.l.debitCents, creditCents: r.l.creditCents });
      byId.set(r.e.id, x);
    }
    return journalCsv([...byId.values()], e.name);
  }


  /* ------------------------------------------------------------------ ERP handoff */

  async erp(p: Principal): Promise<ErpIntegrationDto> {
    await this.authz.check(p, this.ledgerRes(p.operatorId), 'read');
    const [profiles, batches, perms] = await Promise.all([
      this.db.db.select().from(erpProfiles).where(eq(erpProfiles.operatorId, p.operatorId)).orderBy(asc(erpProfiles.name)),
      this.db.db.select().from(erpExportBatches).where(eq(erpExportBatches.operatorId, p.operatorId)).orderBy(desc(erpExportBatches.generatedAt)).limit(100),
      this.authz.decide(p, this.ledgerRes(p.operatorId), ['integrate'])
    ]);
    const pn = new Map(profiles.map(x => [x.id, x.name]));
    return {
      profiles: profiles.map(x => ({ id:x.id, entityId:x.entityId, name:x.name, format:x.format as 'CSV_JOURNAL_V1'|'JSON_JOURNAL_V1', active:x.active, accountMap:x.accountMap, costCentreMap:x.costCentreMap, updatedAt:x.updatedAt.toISOString() })),
      batches: batches.map(x => ({ id:x.id, entityId:x.entityId, profileId:x.profileId, profileName:pn.get(x.profileId) ?? x.profileId, period:x.period, format:x.format as 'CSV_JOURNAL_V1'|'JSON_JOURNAL_V1', status:x.status as 'GENERATED'|'ACKNOWLEDGED'|'REJECTED', contentSha256:x.contentSha256, journalCount:x.journalCount, debitCents:x.debitCents, creditCents:x.creditCents, generatedBy:x.generatedBy, generatedAt:x.generatedAt.toISOString(), acknowledgementRef:x.acknowledgementRef, acknowledgementNote:x.acknowledgementNote, acknowledgedBy:x.acknowledgedBy, acknowledgedAt:x.acknowledgedAt?.toISOString() ?? null })),
      permissions: { integrate: perms.integrate }
    };
  }

  async addErpProfile(p: Principal, b: { entityId:string; name:string; format:'CSV_JOURNAL_V1'|'JSON_JOURNAL_V1'; accountMap:Record<string,string>; costCentreMap:Record<string,string> }) {
    await this.authz.check(p, this.ledgerRes(p.operatorId, b.entityId), 'integrate');
    const { e } = await this.entityOf(p, b.entityId);
    const validAccounts = new Set((await this.db.db.select({ code:glAccounts.code }).from(glAccounts)).map(x=>x.code));
    for (const source of Object.keys(b.accountMap)) if (!validAccounts.has(source)) throw new DomainError('ACCOUNT', `Unknown AeroOS account ${source}`, 422);
    const validCentres = new Set((await this.db.db.select({ code:costCentres.code }).from(costCentres).where(eq(costCentres.entityId,e.id))).map(x=>x.code));
    for (const source of Object.keys(b.costCentreMap)) if (!validCentres.has(source)) throw new DomainError('COST_CENTRE', `Unknown cost centre ${source} for ${e.name}`, 422);
    const id=randomUUID();
    await this.db.transaction(async()=>{
      await this.db.db.insert(erpProfiles).values({ id, operatorId:p.operatorId, entityId:e.id, name:b.name.trim(), format:b.format, accountMap:b.accountMap, costCentreMap:b.costCentreMap, createdBy:actorOf(p), updatedBy:actorOf(p) });
      await this.audit.record(this.db, CHAIN, { operatorId:p.operatorId, actor:actorOf(p), action:'erp.profile.created', entityType:'erp_profile', entityId:id, data:{ entityId:e.id, name:b.name, format:b.format } });
    });
    return this.erp(p);
  }

  async setErpProfileState(p: Principal, id:string, active:boolean) {
    await this.authz.check(p, this.ledgerRes(p.operatorId), 'integrate');
    const [profile]=await this.db.db.select().from(erpProfiles).where(and(eq(erpProfiles.id,id),eq(erpProfiles.operatorId,p.operatorId)));
    if(!profile) throw new DomainError('ERP_PROFILE_NOT_FOUND', `ERP profile ${id} not found`, 404);
    await this.db.transaction(async()=>{
      await this.db.db.update(erpProfiles).set({ active, updatedBy:actorOf(p), updatedAt:new Date() }).where(eq(erpProfiles.id,id));
      await this.audit.record(this.db,CHAIN,{operatorId:p.operatorId,actor:actorOf(p),action:active?'erp.profile.activated':'erp.profile.deactivated',entityType:'erp_profile',entityId:id,data:{}});
    });
    return this.erp(p);
  }

  async generateErpExport(p: Principal, b:{ profileId:string; period:string }) {
    await this.authz.check(p, this.ledgerRes(p.operatorId), 'integrate');
    const [profile]=await this.db.db.select().from(erpProfiles).where(and(eq(erpProfiles.id,b.profileId),eq(erpProfiles.operatorId,p.operatorId)));
    if(!profile || !profile.active) throw new DomainError('ERP_PROFILE', 'ERP profile is missing or inactive', 422);
    const { e }=await this.entityOf(p,profile.entityId);
    const [period]=await this.db.db.select().from(glPeriods).where(and(eq(glPeriods.entityId,e.id),eq(glPeriods.period,b.period)));
    if(!period || period.status!=='CLOSED') throw new DomainError('ERP_PERIOD_OPEN', `${b.period} must be closed before ERP export`, 422);
    const pending=await this.db.db.select({id:erpExportBatches.id}).from(erpExportBatches).where(and(eq(erpExportBatches.profileId,profile.id),eq(erpExportBatches.period,b.period),eq(erpExportBatches.status,'GENERATED'))).limit(1);
    if(pending[0]) throw new DomainError('ERP_EXPORT_PENDING', `Export ${pending[0].id} is awaiting acknowledgement`, 409);
    const ledger=await this.ledger(p,e.id,b.period);
    const content=erpExportContent({format:profile.format as 'CSV_JOURNAL_V1'|'JSON_JOURNAL_V1',entityId:e.id,entityName:e.name,period:b.period,baseCurrency:BASE,journals:ledger.journals,accountMap:profile.accountMap,costCentreMap:profile.costCentreMap});
    const sha=createHash('sha256').update(content).digest('hex');
    const debit=ledger.trialBalance.debitCents, credit=ledger.trialBalance.creditCents;
    if(debit!==credit) throw new DomainError('ERP_UNBALANCED', 'Trial balance is not balanced; export refused', 422);
    const id=randomUUID();
    await this.db.transaction(async()=>{
      await this.db.db.insert(erpExportBatches).values({ id, operatorId:p.operatorId, entityId:e.id, profileId:profile.id, period:b.period, format:profile.format, content, contentSha256:sha, journalCount:ledger.journals.length, debitCents:debit, creditCents:credit, generatedBy:actorOf(p) });
      await this.audit.record(this.db,CHAIN,{operatorId:p.operatorId,actor:actorOf(p),action:'erp.export.generated',entityType:'erp_export',entityId:id,data:{entityId:e.id,period:b.period,profileId:profile.id,sha256:sha,journalCount:ledger.journals.length,debitCents:debit}});
    });
    return this.erp(p);
  }

  async erpExportFile(p: Principal, id:string):Promise<string> {
    await this.authz.check(p,this.ledgerRes(p.operatorId),'read');
    const [batch]=await this.db.db.select().from(erpExportBatches).where(and(eq(erpExportBatches.id,id),eq(erpExportBatches.operatorId,p.operatorId)));
    if(!batch) throw new DomainError('ERP_EXPORT_NOT_FOUND',`ERP export ${id} not found`,404);
    if(createHash('sha256').update(batch.content).digest('hex')!==batch.contentSha256) throw new DomainError('ERP_EXPORT_INTEGRITY','Stored ERP export checksum does not match',500);
    return batch.content;
  }

  async acknowledgeErpExport(p:Principal,id:string,b:{status:'ACKNOWLEDGED'|'REJECTED';reference:string;note?:string}) {
    await this.authz.check(p,this.ledgerRes(p.operatorId),'integrate');
    const [batch]=await this.db.db.select().from(erpExportBatches).where(and(eq(erpExportBatches.id,id),eq(erpExportBatches.operatorId,p.operatorId)));
    if(!batch) throw new DomainError('ERP_EXPORT_NOT_FOUND',`ERP export ${id} not found`,404);
    if(batch.status!=='GENERATED') throw new DomainError('ERP_EXPORT_FINAL',`ERP export ${id} is already ${batch.status.toLowerCase()}`,409);
    await this.db.transaction(async()=>{
      await this.db.db.update(erpExportBatches).set({status:b.status,acknowledgementRef:b.reference.trim(),acknowledgementNote:b.note?.trim()||null,acknowledgedBy:actorOf(p),acknowledgedAt:new Date()}).where(eq(erpExportBatches.id,id));
      await this.audit.record(this.db,CHAIN,{operatorId:p.operatorId,actor:actorOf(p),action:b.status==='ACKNOWLEDGED'?'erp.export.acknowledged':'erp.export.rejected',entityType:'erp_export',entityId:id,data:{reference:b.reference,note:b.note??null}});
    });
    return this.erp(p);
  }

  /* ------------------------------------------------------------------ dashboard figures */

  async kpis(operatorId: string) {
    const now = new Date();
    const [occ, fnd, cas] = await Promise.all([
      this.db.db.select({ status: occurrences.status }).from(occurrences).where(eq(occurrences.operatorId, operatorId)),
      this.db.db.select({ status: findings.status, due: findings.due, level: findings.level }).from(findings).where(eq(findings.operatorId, operatorId)),
      this.db.db.select({ status: correctiveActions.status, due: correctiveActions.due }).from(correctiveActions).where(eq(correctiveActions.operatorId, operatorId))
    ]);
    // maintenance revenue per month, last 6 months (credit − debit on the labour/parts/services revenue accounts), all of the operator's entities
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1)).toISOString().slice(0, 7);
    const rev = await this.db.db.execute<{ period: string; cents: string }>(sql`
      select e.period, coalesce(sum(l.credit_cents - l.debit_cents), 0)::text as cents
      from org.journal_lines l join org.journal_entries e on e.id = l.entry_id join org.gl_accounts a on a.code = l.account
      where e.operator_id = ${operatorId} and a.code in ('4000', '4010', '4020') and e.period >= ${from}
      group by e.period order by e.period`);
    const months: string[] = [];
    for (let i = 5; i >= 0; i--) months.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
    const byP = new Map<string, number>(rev.rows.map(r => [r.period, Number(r.cents)] as [string, number]));
    const t = today();
    return {
      openOccurrences: occ.filter(o => o.status !== 'CLOSED').length,
      openFindings: fnd.filter(f => f.status === 'OPEN').length,
      overdueFindings: fnd.filter(f => f.status === 'OPEN' && f.due.getTime() < now.getTime()).length,
      overdueActions: cas.filter(c => c.status === 'OPEN' && c.due < t).length,
      revenueByMonth: months.map(m => ({ period: m, revenueCents: byP.get(m) ?? 0 }))
    };
  }
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const journalSchema = z.object({
  entityId: z.string().min(2).max(20), date: day, memo: z.string().trim().min(3).max(300),
  lines: z.array(z.object({
    account: z.string().regex(/^\d{4}$/), costCentre: z.string().max(20).nullable().default(null),
    debitCents: z.number().int().min(0).max(1e13), creditCents: z.number().int().min(0).max(1e13)
  })).min(2).max(50)
});
const closeSchema = z.object({ entityId: z.string().min(2).max(20), period: z.string().regex(/^\d{4}-\d{2}$/) });
const ccSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,20}$/), entityId: z.string().min(2).max(20), name: z.string().trim().min(3).max(120),
  kind: z.enum(['FLIGHT_OPS', 'MAINTENANCE', 'CAMO', 'MRO_SALES', 'STORES', 'ADMIN']), manager: z.string().trim().max(60).optional()
});


const erpProfileSchema=z.object({entityId:z.string().min(2).max(20),name:z.string().trim().min(2).max(80),format:z.enum(['CSV_JOURNAL_V1','JSON_JOURNAL_V1']),accountMap:z.record(z.string(),z.string().trim().min(1).max(40)).default({}),costCentreMap:z.record(z.string(),z.string().trim().min(1).max(40)).default({})});
const erpStateSchema=z.object({active:z.boolean()});
const erpExportSchema=z.object({profileId:z.string().uuid(),period:z.string().regex(/^\d{4}-\d{2}$/)});
const erpAckSchema=z.object({status:z.enum(['ACKNOWLEDGED','REJECTED']),reference:z.string().trim().min(2).max(120),note:z.string().trim().max(500).optional()});

@Controller('finance')
export class FinanceController {
  constructor(private readonly f: FinanceService) {}
  @Get('ledger') ledger(@CurrentPrincipal() p: Principal, @Query('entity') entity?: string, @Query('period') period?: string) { return this.f.ledger(p, entity, period); }
  @Post('journals') journal(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(journalSchema)) b: z.infer<typeof journalSchema>) { return this.f.manualJournal(p, b); }
  @Post('periods/close') close(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(closeSchema)) b: z.infer<typeof closeSchema>) { return this.f.closePeriod(p, b.entityId, b.period); }
  @Get('export') @Header('content-type', 'text/csv; charset=utf-8')
  exportCsv(@CurrentPrincipal() p: Principal, @Query('period') period: string, @Query('entity') entity?: string) { return this.f.exportCsv(p, entity, period ?? ''); }
  @Get('erp') erp(@CurrentPrincipal() p: Principal) { return this.f.erp(p); }
  @Post('erp/profiles') addErpProfile(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(erpProfileSchema)) b: z.infer<typeof erpProfileSchema>) { return this.f.addErpProfile(p,b); }
  @Post('erp/profiles/:id/state') erpProfileState(@CurrentPrincipal() p: Principal,@Param('id') id:string,@Body(new ZodPipe(erpStateSchema)) b:z.infer<typeof erpStateSchema>){ return this.f.setErpProfileState(p,id,b.active); }
  @Post('erp/exports') erpExport(@CurrentPrincipal() p: Principal,@Body(new ZodPipe(erpExportSchema)) b:z.infer<typeof erpExportSchema>){ return this.f.generateErpExport(p,b); }
  @Get('erp/exports/:id/file') @Header('content-type','text/plain; charset=utf-8') erpExportFile(@CurrentPrincipal() p: Principal,@Param('id') id:string){ return this.f.erpExportFile(p,id); }
  @Post('erp/exports/:id/ack') erpAck(@CurrentPrincipal() p: Principal,@Param('id') id:string,@Body(new ZodPipe(erpAckSchema)) b:z.infer<typeof erpAckSchema>){ return this.f.acknowledgeErpExport(p,id,b); }
}

@Controller('org/enterprise')
export class EnterpriseController {
  constructor(private readonly f: FinanceService) {}
  @Get() get(@CurrentPrincipal() p: Principal) { return this.f.enterprise(p); }
  @Post('cost-centres') add(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(ccSchema)) b: z.infer<typeof ccSchema>) { return this.f.addCostCentre(p, b); }
}
