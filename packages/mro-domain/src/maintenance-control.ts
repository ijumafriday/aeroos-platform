export type WorkOrderState = 'DRAFT'|'PLANNED'|'RELEASED'|'IN_PROGRESS'|'HOLD'|'COMPLETE'|'CANCELLED';
export type LineVisitState = 'PLANNED'|'ARRIVED'|'IN_MAINTENANCE'|'RELEASED'|'DEPARTED'|'CANCELLED';
export type ShopOrderState = 'INDUCTED'|'TEARDOWN'|'INSPECTION'|'REPAIR'|'ASSEMBLY'|'TEST'|'READY_FOR_RELEASE'|'RELEASED'|'HOLD'|'SCRAPPED';
export type OutsourceState = 'PLANNED'|'SENT'|'IN_WORK'|'RETURNED'|'ACCEPTED'|'CANCELLED';

const transitions = <T extends string>(map: Record<T, readonly T[]>) => map;

export const WORK_ORDER_TRANSITIONS = transitions<WorkOrderState>({
  DRAFT:['PLANNED','CANCELLED'], PLANNED:['RELEASED','CANCELLED'], RELEASED:['IN_PROGRESS','CANCELLED'],
  IN_PROGRESS:['HOLD','COMPLETE'], HOLD:['IN_PROGRESS','CANCELLED'], COMPLETE:[], CANCELLED:[]
});
export const LINE_VISIT_TRANSITIONS = transitions<LineVisitState>({
  PLANNED:['ARRIVED','CANCELLED'], ARRIVED:['IN_MAINTENANCE','RELEASED'], IN_MAINTENANCE:['RELEASED'], RELEASED:['DEPARTED'], DEPARTED:[], CANCELLED:[]
});
export const SHOP_ORDER_TRANSITIONS = transitions<ShopOrderState>({
  INDUCTED:['TEARDOWN','HOLD','SCRAPPED'], TEARDOWN:['INSPECTION','HOLD','SCRAPPED'], INSPECTION:['REPAIR','ASSEMBLY','HOLD','SCRAPPED'],
  REPAIR:['ASSEMBLY','HOLD','SCRAPPED'], ASSEMBLY:['TEST','HOLD'], TEST:['READY_FOR_RELEASE','REPAIR','HOLD'], READY_FOR_RELEASE:['RELEASED','HOLD'],
  HOLD:['TEARDOWN','INSPECTION','REPAIR','ASSEMBLY','TEST','READY_FOR_RELEASE','SCRAPPED'], RELEASED:[], SCRAPPED:[]
});
export const OUTSOURCE_TRANSITIONS = transitions<OutsourceState>({
  PLANNED:['SENT','CANCELLED'], SENT:['IN_WORK','RETURNED','CANCELLED'], IN_WORK:['RETURNED','CANCELLED'], RETURNED:['ACCEPTED','IN_WORK'], ACCEPTED:[], CANCELLED:[]
});

export function transitionAllowed<T extends string>(map: Record<T, readonly T[]>, current: T, next: T): boolean {
  return map[current]?.includes(next) ?? false;
}

export function measurementResult(value: number, lower: number|null, upper: number|null): 'PASS'|'FAIL' {
  return (lower === null || value >= lower) && (upper === null || value <= upper) ? 'PASS' : 'FAIL';
}

export function piecePartMayInstall(disposition: string): boolean {
  return disposition === 'SERVICEABLE' || disposition === 'REPLACE';
}

export function shopReleaseReady(input: { openFindings: number; unresolvedPieceParts: number; testResult: string|null; releaseCertificateRef: string|null }): boolean {
  return input.openFindings === 0 && input.unresolvedPieceParts === 0 && !!input.testResult?.trim() && !!input.releaseCertificateRef?.trim();
}
