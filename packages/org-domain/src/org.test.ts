import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ComplianceEngine, defaultRegistry, type OperatorProfile, type Privilege } from '@aeroos/compliance';
import { DAY_MS } from '@aeroos/kernel';
import {
  currencyFacts, expireAuthorisation, experienceMonthsLast24, reachedLevel, governingAuthorisation, issueAuthorisation, lastContinuationTraining,
  reinstateAuthorisation, revokeAuthorisation, suspendAuthorisation, toCompanyAuthorisation
} from './index';

const NKX: OperatorProfile = { operatorId: 'NKX', name: 'Nordkapp Air', authority: 'EASA', melTimeZone: 'UTC', approvedTypes: ['B737-800', 'A320neo'], mel: {} };
const engine = new ComplianceEngine(defaultRegistry({ allowDraft: false }), [NKX]);
const at = new Date('2026-10-08T12:00:00Z');
const b1: Privilege[] = [{ authority: 'EASA', category: 'B1.1', typeRatings: ['B737-800'], validUntil: new Date('2028-01-01T00:00:00Z') }];

const issue = (over: Partial<Parameters<typeof issueAuthorisation>[1]> = {}) => issueAuthorisation(engine, {
  id: 'AUT-1', operatorId: 'NKX', personnelId: 'P-1', reference: 'C-AUTH 145-200', aircraftTypes: ['B737-800'],
  validUntil: new Date('2027-10-08T00:00:00Z'), issuedBy: 'qm', at, privileges: b1, existing: [], ...over
});

describe('Company authorisation lifecycle', () => {
  test('issued within licence scope, recording the rule that allowed it', () => {
    const { authorisation, event } = issue();
    assert.equal(authorisation.status, 'ACTIVE');
    assert.equal(authorisation.issueRule, 'EASA@2026.1');
    assert.equal(event.type, 'org.authorisation.issued');
  });
  test('scope beyond the Part-66 type ratings is refused', () => {
    assert.throws(() => issue({ aircraftTypes: ['B737-800', 'A320neo'] }), /type rating for A320neo/);
  });
  test('only one live authorisation per holder', () => {
    assert.throws(() => issue({ existing: [{ reference: 'C-AUTH 1', status: 'SUSPENDED' }] }), /already has authorisation/);
  });
  test('suspend → reinstate → revoke, each with a reason in the history', () => {
    let a = issue().authorisation;
    a = suspendAuthorisation(a, 'qm', 'Finding QA-2026-114', at).authorisation;
    assert.equal(toCompanyAuthorisation(a)!.suspended, true);
    a = reinstateAuthorisation(a, 'qm', 'Finding closed', at).authorisation;
    assert.equal(a.status, 'ACTIVE');
    a = revokeAuthorisation(a, 'qm', 'Left the organisation', at).authorisation;
    assert.deepEqual(a.history.map(h => h.action), ['ISSUED', 'SUSPENDED', 'REINSTATED', 'REVOKED']);
    assert.equal(a.version, 4);
  });
  test('revoked is terminal and a reason is mandatory', () => {
    const a = revokeAuthorisation(issue().authorisation, 'qm', 'Left the organisation', at).authorisation;
    assert.throws(() => suspendAuthorisation(a, 'qm', 'again', at), /not active/);
    assert.throws(() => suspendAuthorisation(issue().authorisation, 'qm', ' ', at), /reason/);
  });
  test('expiry is idempotent and only after the validity date', () => {
    const a = issue().authorisation;
    assert.equal(expireAuthorisation(a, at), null);
    const e = expireAuthorisation(a, new Date('2027-10-08T00:00:00Z'))!;
    assert.equal(e.authorisation.status, 'EXPIRED');
    assert.equal(expireAuthorisation(e.authorisation, new Date('2027-10-09T00:00:00Z')), null);
  });
  test('the live authorisation governs; otherwise the most recent', () => {
    const old = { ...issue().authorisation, id: 'old', status: 'EXPIRED' as const, issuedAt: new Date('2024-01-01') };
    const cur = issue({ id: 'cur' }).authorisation;
    assert.equal(governingAuthorisation([old, cur])!.id, 'cur');
    assert.equal(governingAuthorisation([old])!.id, 'old');
  });
});

describe('Currency facts', () => {
  test('experience counts distinct months within the last 24', () => {
    const dates = ['2026-10-01', '2026-10-05', '2026-09-30', '2024-11-01', '2024-10-31'].map(d => new Date(d + 'T10:00:00Z'));
    // Oct-26, Sep-26 and Nov-24 count; Oct-24 is the 25th month back.
    assert.equal(experienceMonthsLast24(dates, at), 3);
  });
  test('human factors refreshes the continuation cycle; future records are ignored', () => {
    const d = lastContinuationTraining([
      { course: 'CONTINUATION', completedAt: new Date('2025-01-10') },
      { course: 'HUMAN_FACTORS', completedAt: new Date('2025-06-10') },
      { course: 'TYPE', completedAt: new Date('2026-01-10') },
      { course: 'CONTINUATION', completedAt: new Date('2027-01-10') }
    ], at);
    assert.equal(d!.toISOString().slice(0, 10), '2025-06-10');
  });
  test('facts feed the rulepack', () => {
    const months = Array.from({ length: 8 }, (_, i) => new Date(Date.UTC(2026, i, 15)));
    const f = currencyFacts(months, [{ course: 'CONTINUATION', completedAt: new Date('2025-06-10') }], at);
    assert.equal(engine.currency('NKX', f).value.current, true);
  });
});

describe('Expiry ladder', () => {
  test('a sweep sees the most severe level reached', () => {
    assert.equal(reachedLevel(at.getTime() + 100 * DAY_MS, at.getTime()), null);
    assert.equal(reachedLevel(at.getTime() + 29 * DAY_MS, at.getTime())!.level, 'T-30');
    assert.equal(reachedLevel(at.getTime() - 1, at.getTime())!.level, 'EXPIRED');
  });
});
