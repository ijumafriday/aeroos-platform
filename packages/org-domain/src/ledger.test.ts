import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ACC, assertBalanced, checkClose, invoicePosting, journalCsv, paymentPosting, postingPeriod, profitAndLoss, receiptPosting, trialBalance, type Account } from './index';

const accounts: Account[] = [
  { code: '1100', name: 'Bank', type: 'ASSET' }, { code: '1200', name: 'Receivables', type: 'ASSET' }, { code: '1300', name: 'Inventory', type: 'ASSET' },
  { code: '2100', name: 'Payables', type: 'LIABILITY' }, { code: '2200', name: 'VAT output', type: 'LIABILITY' },
  { code: '4000', name: 'Labour', type: 'REVENUE' }, { code: '4010', name: 'Parts', type: 'REVENUE' }, { code: '4020', name: 'Services', type: 'REVENUE' },
  { code: '6100', name: 'Fuel', type: 'EXPENSE' }
];

describe('General ledger', () => {
  test('journals must balance, lines are one-sided', () => {
    assert.throws(() => assertBalanced([{ account: '1100', costCentre: null, debitCents: 100, creditCents: 0 }, { account: '2100', costCentre: null, debitCents: 0, creditCents: 90 }]), /≠/);
    assert.throws(() => assertBalanced([{ account: '1100', costCentre: null, debitCents: 100, creditCents: 100 }, { account: '2100', costCentre: null, debitCents: 0, creditCents: 0 }]), /either a debit or a credit/);
    assert.throws(() => assertBalanced([{ account: '1100', costCentre: null, debitCents: 1.5, creditCents: 0 }, { account: '2100', costCentre: null, debitCents: 0, creditCents: 1.5 }]), /whole cents/);
  });

  test('an EUR invoice balances in base currency even with rounding', () => {
    const p = invoicePosting({ invoiceId: 'INV-1', customer: 'Baltic', issuedAt: '2026-10-05T10:00:00Z', currency: 'EUR', basePerUnit: 1.0837,
      labourCents: 333333, partsCents: 111111, serviceCents: 0, vatCents: 0 }, 'NKT-MRO')!;
    assertBalanced(p.lines);
    // the receivable is the total converted once, so a full payment converted the same way clears it
    assert.equal(p.lines.find(l => l.account === ACC.receivables)!.debitCents, Math.round(444444 * 1.0837));
    const nok = { invoiceId: 'INV-2', customer: 'X', issuedAt: '2026-10-05', currency: 'NOK', basePerUnit: 0.093, labourCents: 100002, partsCents: 33333, serviceCents: 7777, vatCents: 12345 };
    const rec = invoicePosting(nok, 'NKT-MRO')!.lines.find(l => l.account === ACC.receivables)!.debitCents;
    assert.equal(paymentPosting({ invoiceId: 'INV-2', customer: 'X', at: '2026-10-09', amountCents: 153457, basePerUnit: 0.093, reference: 'B' })!.lines[0].debitCents, rec);
    assert.equal(invoicePosting({ ...nok, labourCents: 0, partsCents: 0, serviceCents: 0, vatCents: 0 }, 'NKT-MRO'), null);
    assert.equal(p.lines.some(l => l.account === ACC.serviceRevenue), false, 'zero lines dropped');
    assert.equal(p.date, '2026-10-05');
    const cn = invoicePosting({ invoiceId: 'CN-1', customer: 'Baltic', issuedAt: '2026-10-06', currency: 'USD', basePerUnit: 1, labourCents: 1000, partsCents: 0, serviceCents: 0, vatCents: 250, credit: true }, 'NKT-MRO')!;
    assert.equal(cn.lines.find(l => l.account === ACC.receivables)!.creditCents, 1250);
    assert.equal(cn.lines.find(l => l.account === ACC.vatOutput)!.debitCents, 250);
  });

  test('payments and receipts', () => {
    assertBalanced(paymentPosting({ invoiceId: 'INV-1', customer: 'X', at: '2026-10-07', amountCents: 5000, basePerUnit: 1, reference: 'BANK-1' })!.lines);
    assert.equal(paymentPosting({ invoiceId: 'INV-1', customer: 'X', at: '2026-10-07', amountCents: 5000, basePerUnit: 0.093, reference: 'B', remainingBaseCents: 466 })!.lines[0].debitCents, 466);
    assert.equal(receiptPosting({ receiptId: 'GR-0', poId: 'PO-1', partNo: 'P', qty: 1, amountBaseCents: 0, at: '2026-10-07' }, null), null);
    const r = receiptPosting({ receiptId: 'GR-1', poId: 'PO-1', partNo: 'P', qty: 2, amountBaseCents: 12345, at: '2026-10-07' }, 'NKT-STORES')!;
    assert.deepEqual(r.lines.map(l => [l.account, l.debitCents, l.creditCents]), [['1300', 12345, 0], ['2100', 0, 12345]]);
  });

  test('late postings go to the next open period; months close in order', () => {
    assert.deepEqual(postingPeriod('2026-09-30', new Set()), { period: '2026-09', late: false });
    assert.deepEqual(postingPeriod('2026-09-30', new Set(['2026-09'])), { period: '2026-10', late: true });
    assert.deepEqual(postingPeriod('2026-12-31', new Set(['2026-12'])), { period: '2027-01', late: true });
    // a month before the first closed one is closed too (months close in order)
    assert.deepEqual(postingPeriod('2026-06-15', new Set(['2026-08'])), { period: '2026-09', late: true });
    assert.throws(() => checkClose('2026-10', new Set(), '2026-09'), /Close 2026-09 first/);
    assert.doesNotThrow(() => checkClose('2026-09', new Set(), '2026-09'));
    assert.throws(() => checkClose('2026-09', new Set(['2026-09']), '2026-09'), /already closed/);
  });

  test('trial balance, P&L by cost centre and the ERP export', () => {
    const inv = invoicePosting({ invoiceId: 'INV-1', customer: 'X', issuedAt: '2026-10-05', currency: 'USD', basePerUnit: 1, labourCents: 10000, partsCents: 5000, serviceCents: 0, vatCents: 3750 }, 'NKT-MRO')!;
    const lines = [...inv.lines, { account: '6100', costCentre: 'NKX-FLT', debitCents: 2000, creditCents: 0 }, { account: '1100', costCentre: null, debitCents: 0, creditCents: 2000 }].map(l => ({ ...l, period: '2026-10' }));
    const tb = trialBalance(lines, accounts);
    assert.equal(tb.balanced, true);
    assert.equal(tb.rows.find(r => r.code === '1200')!.balanceCents, 18750);
    const pl = profitAndLoss(lines, accounts);
    assert.deepEqual(pl.find(r => r.costCentre === 'NKT-MRO'), { costCentre: 'NKT-MRO', revenueCents: 15000, expenseCents: 0, resultCents: 15000 });
    assert.equal(pl.find(r => r.costCentre === 'NKX-FLT')!.resultCents, -2000);
    const csv = journalCsv([{ id: 'JE-1', date: '2026-10-05', period: '2026-10', source: 'amo.invoice.issued', memo: 'Invoice "1"', lines: inv.lines }], 'Nordkapp Technics AS');
    assert.match(csv, /^entity;entry;date/);
    assert.match(csv, /"Invoice ""1"""/);
    assert.equal(csv.trim().split('\n').length, 1 + inv.lines.length);
    const evil = journalCsv([{ id: 'JE-2', date: '2026-10-05', period: '2026-10', source: 'manual', memo: '=HYPERLINK("http://x")', lines: inv.lines }], 'E');
    assert.ok(evil.includes(`"'=HYPERLINK(""http`), 'formula defused');
  });
});
