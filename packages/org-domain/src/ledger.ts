import { DomainError } from '@aeroos/kernel';

/**
 * General ledger (double entry) fed by the business events of the other modules, and the period close. Amounts are
 * integer cents of the operator's base currency; the original currency and rate are kept on the entry. This is the
 * operational sub-ledger the operator's ERP imports (journal export), not a replacement for statutory accounting.
 */

export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
export interface Account { code: string; name: string; type: AccountType }

/** The accounts the automatic postings use (the seed creates them with these codes). */
export const ACC = {
  bank: '1100', receivables: '1200', inventory: '1300', payables: '2100', vatOutput: '2200',
  labourRevenue: '4000', partsRevenue: '4010', serviceRevenue: '4020'
} as const;

export interface JournalLine { account: string; costCentre: string | null; debitCents: number; creditCents: number }
export interface Posting { date: string; memo: string; lines: JournalLine[] }

const ok = (n: number) => Number.isInteger(n) && n >= 0;

export function assertBalanced(lines: JournalLine[]) {
  if (lines.length < 2) throw new DomainError('JOURNAL_LINES', 'A journal needs at least two lines', 422);
  for (const l of lines) {
    if (!ok(l.debitCents) || !ok(l.creditCents) || (l.debitCents > 0) === (l.creditCents > 0)) {
      throw new DomainError('JOURNAL_LINE', `Each line is either a debit or a credit, in whole cents (account ${l.account})`, 422);
    }
  }
  const d = lines.reduce((s, l) => s + l.debitCents, 0), c = lines.reduce((s, l) => s + l.creditCents, 0);
  if (d !== c) throw new DomainError('UNBALANCED', `Debits ${(d / 100).toFixed(2)} ≠ credits ${(c / 100).toFixed(2)}`, 422);
}

const toBase = (amountCents: number, rate: number) => Math.round(amountCents * rate);
const dr = (account: string, cents: number, cc: string | null = null): JournalLine => ({ account, costCentre: cc, debitCents: cents, creditCents: 0 });
const cr = (account: string, cents: number, cc: string | null = null): JournalLine => ({ account, costCentre: cc, debitCents: 0, creditCents: cents });
const nonZero = (ls: JournalLine[]) => ls.filter(l => l.debitCents > 0 || l.creditCents > 0);

export interface InvoiceFacts {
  invoiceId: string; customer: string; issuedAt: string; currency: string; basePerUnit: number;
  labourCents: number; partsCents: number; serviceCents: number; vatCents: number;
  /** A credit note reverses an invoice (amounts given positive). */
  credit?: boolean;
}

/**
 * Invoice: receivable against revenue by kind and VAT. The receivable is the invoice total converted once (so a
 * full payment, converted the same way, clears it); the rounding difference of the separately converted credits
 * goes to the largest revenue line. Null for an invoice of zero value (nothing to post).
 */
export function invoicePosting(i: InvoiceFacts, costCentre: string): Posting | null {
  const total = i.labourCents + i.partsCents + i.serviceCents + i.vatCents;
  if (total === 0) return null;
  const receivable = toBase(total, i.basePerUnit);
  const credits = [
    cr(ACC.labourRevenue, toBase(i.labourCents, i.basePerUnit), costCentre),
    cr(ACC.partsRevenue, toBase(i.partsCents, i.basePerUnit), costCentre),
    cr(ACC.serviceRevenue, toBase(i.serviceCents, i.basePerUnit), costCentre),
    cr(ACC.vatOutput, toBase(i.vatCents, i.basePerUnit))
  ];
  const diff = receivable - credits.reduce((s, l) => s + l.creditCents, 0);
  if (diff !== 0) {
    const revenue = credits.slice(0, 3);
    const biggest = revenue.reduce((a, b) => (b.creditCents > a.creditCents ? b : a), revenue[0]);
    biggest.creditCents += diff;
  }
  let lines = nonZero([dr(ACC.receivables, receivable), ...credits]);
  if (i.credit) lines = lines.map(l => ({ ...l, debitCents: l.creditCents, creditCents: l.debitCents }));
  assertBalanced(lines);
  return { date: i.issuedAt.slice(0, 10), memo: `${i.credit ? 'Credit note' : 'Invoice'} ${i.invoiceId} — ${i.customer} (${i.currency}${i.currency !== 'USD' ? ` @ ${i.basePerUnit}` : ''})`, lines };
}

/**
 * Customer payment at the invoice rate (FX differences on settlement are left to the ERP). The payment that settles
 * the invoice posts what is left of its receivable in base currency (`remainingBaseCents`), so it clears exactly.
 */
export function paymentPosting(p: { invoiceId: string; customer: string; at: string; amountCents: number; basePerUnit: number; reference: string; remainingBaseCents?: number | null }): Posting | null {
  const v = p.remainingBaseCents ?? toBase(p.amountCents, p.basePerUnit);
  if (v <= 0) return null;
  const lines = [dr(ACC.bank, v), cr(ACC.receivables, v)];
  assertBalanced(lines);
  return { date: p.at.slice(0, 10), memo: `Payment ${p.reference} for ${p.invoiceId} — ${p.customer}`, lines };
}

/** Goods received against a purchase order: stock against the supplier (accrued until the supplier invoice in the ERP). */
export function receiptPosting(r: { receiptId: string; poId: string; partNo: string; qty: number; amountBaseCents: number; at: string }, costCentre: string | null): Posting | null {
  if (r.amountBaseCents <= 0) return null; // below half a cent in base currency: nothing to post
  const lines = [dr(ACC.inventory, r.amountBaseCents, costCentre), cr(ACC.payables, r.amountBaseCents)];
  assertBalanced(lines);
  return { date: r.at.slice(0, 10), memo: `Goods receipt ${r.receiptId} (${r.poId}): ${r.qty} × ${r.partNo}`, lines };
}

/* ------------------------------------------------------------------ periods */

export const periodOf = (date: string) => date.slice(0, 7);
const nextPeriod = (p: string) => {
  const [y, m] = p.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};

/**
 * The period an entry lands in: its own, or — when that one is closed — the first open period after it (a late
 * posting never reopens a closed month; the memo says so). Months close in order, so every month up to the latest
 * closed one counts as closed, including months before the first one the ledger has a record of.
 */
export function postingPeriod(date: string, closed: Set<string>): { period: string; late: boolean } {
  const own = periodOf(date);
  const latest = [...closed].sort().pop();
  let p = latest && own <= latest ? nextPeriod(latest) : own;
  for (let i = 0; i < 240 && closed.has(p); i++) p = nextPeriod(p);
  if (closed.has(p)) throw new DomainError('NO_OPEN_PERIOD', 'No open accounting period', 422);
  return { period: p, late: p !== own };
}

/** Closing a period requires the previous one to be closed (months close in order). */
export function checkClose(period: string, closed: Set<string>, firstPeriod: string) {
  if (closed.has(period)) throw new DomainError('PERIOD_CLOSED', `${period} is already closed`, 409);
  const [y, m] = period.split('-').map(Number);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  if (period > firstPeriod && !closed.has(prev)) throw new DomainError('PERIOD_ORDER', `Close ${prev} first`, 422);
}

/* ------------------------------------------------------------------ reports */

export interface BookedLine extends JournalLine { period: string }

export function trialBalance(lines: BookedLine[], accounts: Account[]) {
  const rows = accounts.map(a => {
    const mine = lines.filter(l => l.account === a.code);
    const debit = mine.reduce((s, l) => s + l.debitCents, 0), credit = mine.reduce((s, l) => s + l.creditCents, 0);
    return { ...a, debitCents: debit, creditCents: credit, balanceCents: debit - credit };
  }).filter(r => r.debitCents || r.creditCents);
  const debit = rows.reduce((s, r) => s + r.debitCents, 0), credit = rows.reduce((s, r) => s + r.creditCents, 0);
  return { rows, debitCents: debit, creditCents: credit, balanced: debit === credit };
}

/** Revenue less expenses per cost centre (revenue positive). */
export function profitAndLoss(lines: BookedLine[], accounts: Account[]) {
  const type = new Map(accounts.map(a => [a.code, a.type]));
  const out = new Map<string, { revenueCents: number; expenseCents: number }>();
  for (const l of lines) {
    const t = type.get(l.account);
    if (t !== 'REVENUE' && t !== 'EXPENSE') continue;
    const k = l.costCentre ?? '(none)';
    const row = out.get(k) ?? { revenueCents: 0, expenseCents: 0 };
    if (t === 'REVENUE') row.revenueCents += l.creditCents - l.debitCents;
    else row.expenseCents += l.debitCents - l.creditCents;
    out.set(k, row);
  }
  return [...out.entries()].map(([costCentre, r]) => ({ costCentre, ...r, resultCents: r.revenueCents - r.expenseCents })).sort((a, b) => a.costCentre.localeCompare(b.costCentre));
}

/** ERP import file: one row per journal line (semicolon separated, amounts with a dot, quoted text). */
export function journalCsv(entries: { id: string; date: string; period: string; source: string; memo: string; lines: JournalLine[] }[], entity: string): string {
  // text cells are quoted, and a leading = + - @ (tab, CR) is defused so a spreadsheet never runs it as a formula
  const q = (s: string) => `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
  const rows = ['entity;entry;date;period;source;account;cost_centre;debit;credit;memo'];
  for (const e of entries) {
    for (const l of e.lines) {
      rows.push([q(entity), q(e.id), e.date, e.period, q(e.source), l.account, q(l.costCentre ?? ''), (l.debitCents / 100).toFixed(2), (l.creditCents / 100).toFixed(2), q(e.memo)].join(';'));
    }
  }
  return rows.join('\n') + '\n';
}
