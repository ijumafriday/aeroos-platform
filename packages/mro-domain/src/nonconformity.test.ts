import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { checkInstallation, dispose, witnessMutilation, type Nonconformity } from './index';

const n: Nonconformity = { id: 'NCR-1', partNo: '2073M48P01', serial: 'GWN0Y388', qty: 1, status: 'QUARANTINED', disposition: null, dispositionedBy: null, version: 1 };

describe('Non-conforming parts and scrapping (145.A.42)', () => {
  test('return to stock needs a release certificate', () => {
    assert.throws(() => dispose(n, 'RETURN_TO_STOCK', 'Inspected serviceable after repair', 'camo.engineer', null), /release certificate/);
    assert.equal(dispose(n, 'RETURN_TO_STOCK', 'Inspected serviceable after repair', 'camo.engineer', 'Form 1 88123').status, 'CLOSED');
  });
  test('scrapping: mutilation witnessed by a second person', () => {
    const s = dispose(n, 'SCRAP', 'Crack beyond repair limits (CMM 72-00)', 'camo.engineer', null);
    assert.equal(s.status, 'SCRAP_PENDING');
    assert.throws(() => witnessMutilation(s, 'camo.engineer', 'cut in two'), /someone other/);
    assert.equal(witnessMutilation(s, 'storekeeper', 'Disc cut through the bore').status, 'CLOSED');
  });
  test('a scrapped serial can never be installed', () => {
    const hist = [{ partNo: 'P', serial: 'S', type: 'SCRAPPED' as const, tail: '-', position: '-', at: new Date('2026-01-01'), tsn: 1, csn: 1, reason: null, reference: 'NCR-1' }];
    assert.throws(() => checkInstallation(hist, { partNo: 'P', serial: 'S', tsn: 1, csn: 1, reference: 'Form 1' }), /scrapped/);
  });
});
