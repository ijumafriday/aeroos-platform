import test from 'node:test';
import assert from 'node:assert/strict';
import { LINE_VISIT_TRANSITIONS, OUTSOURCE_TRANSITIONS, SHOP_ORDER_TRANSITIONS, WORK_ORDER_TRANSITIONS, measurementResult, piecePartMayInstall, shopReleaseReady, transitionAllowed } from './maintenance-control';

test('maintenance lifecycle transitions reject shortcuts', () => {
  assert.equal(transitionAllowed(WORK_ORDER_TRANSITIONS,'DRAFT','RELEASED'), false);
  assert.equal(transitionAllowed(WORK_ORDER_TRANSITIONS,'PLANNED','RELEASED'), true);
  assert.equal(transitionAllowed(LINE_VISIT_TRANSITIONS,'PLANNED','DEPARTED'), false);
  assert.equal(transitionAllowed(SHOP_ORDER_TRANSITIONS,'TEST','READY_FOR_RELEASE'), true);
  assert.equal(transitionAllowed(OUTSOURCE_TRANSITIONS,'SENT','ACCEPTED'), false);
});

test('structured measurements preserve out-of-limit evidence', () => {
  assert.equal(measurementResult(9.9,10,20),'FAIL');
  assert.equal(measurementResult(10,10,20),'PASS');
  assert.equal(measurementResult(20,10,20),'PASS');
  assert.equal(measurementResult(20.1,10,20),'FAIL');
});

test('shop release requires traceable completion', () => {
  assert.equal(piecePartMayInstall('SERVICEABLE'), true);
  assert.equal(piecePartMayInstall('REPAIR'), false);
  assert.equal(shopReleaseReady({openFindings:0,unresolvedPieceParts:0,testResult:'PASS TR-18',releaseCertificateRef:'EASA1-22'}), true);
  assert.equal(shopReleaseReady({openFindings:0,unresolvedPieceParts:1,testResult:'PASS',releaseCertificateRef:'EASA1'}), false);
});
