import { DomainError } from '@aeroos/kernel';
import type { CompanyAuthorisation, ComplianceEngine, Decision, CertificationOutcome, CurrencyFacts, Privilege } from '@aeroos/compliance';
import type { DomainEvent, EventMap, Trade } from '@aeroos/contracts';
import type { SignatureEnvelope } from '@aeroos/signing';
import { requireCalibrated, type Tool } from './stores';

export interface Stamp {
  personnelId: string;
  name: string;
  licence: string;
  at: Date;
  rule: string;
  via: string;
  signature: SignatureEnvelope;
  /** Calibrated tools used for this step (Part-145.A.40), if any were recorded. */
  tools?: string[];
}

export interface TaskStep { n: number; text: string; stamp: Stamp | null }

export interface TaskCard {
  id: string;
  operatorId: string;
  tail: string;
  aircraftType: string;
  title: string;
  ata: string;
  trade: Trade;
  source: { type: 'EO' | 'WP'; id: string };
  steps: TaskStep[];
  status: 'OPEN' | 'IN_PROGRESS' | 'CERTIFIED';
  crs: (Stamp & { number: string }) | null;
  createdAt: Date;
  version: number;
}

/** The authenticated person signing, with the qualification facts the rulepack needs. */
export interface Signer {
  personnelId: string;
  name: string;
  licenceNo: string;
  privileges: Privilege[];
  authorisation: CompanyAuthorisation | null;
  /** Recent experience and continuation training (Org Core). Re-dated to the signing instant. */
  currency?: Omit<CurrencyFacts, 'at'>;
}

export type Sign = (payload: unknown, at: Date) => Promise<SignatureEnvelope>;

/** A task card for one item of a released work package (scheduled maintenance, AD, LLP replacement). */
export function taskCardFromWorkPackageItem(
  wp: EventMap['camo.wp.released'], item: EventMap['camo.wp.released']['items'][number], operatorId: string, id: string, at: Date
): { card: TaskCard; event: DomainEvent<'amo.taskcard.created'> } {
  if (!item.steps.length) throw new DomainError('NO_STEPS', `${item.ref} has no task steps`);
  const card: TaskCard = {
    id, operatorId, tail: wp.tail, aircraftType: wp.aircraftType, title: `${item.ref}: ${item.title}`, ata: item.ata, trade: item.trade,
    source: { type: 'WP', id: `${wp.wpId}/${item.requirementId}` },
    steps: item.steps.map((text, i) => ({ n: i + 1, text, stamp: null })),
    status: 'OPEN', crs: null, createdAt: at, version: 1
  };
  return { card, event: { type: 'amo.taskcard.created', data: { taskCardId: id, eoId: card.source.id, tail: wp.tail } } };
}

export function taskCardFromEngineeringOrder(eo: EventMap['camo.eo.released'], operatorId: string, id: string, at: Date): { card: TaskCard; event: DomainEvent<'amo.taskcard.created'> } {
  if (!eo.steps.length) throw new DomainError('NO_STEPS', 'An engineering order must have at least one step');
  const card: TaskCard = {
    id,
    operatorId,
    tail: eo.tail,
    aircraftType: eo.aircraftType,
    title: eo.title,
    ata: eo.ata,
    trade: eo.trade,
    source: { type: 'EO', id: eo.eoId },
    steps: eo.steps.map((text, i) => ({ n: i + 1, text, stamp: null })),
    status: 'OPEN',
    crs: null,
    createdAt: at,
    version: 1
  };
  return { card, event: { type: 'amo.taskcard.created', data: { taskCardId: id, eoId: eo.eoId, tail: eo.tail } } };
}

/** Whether `signer` may certify work on this card right now, according to the rulepack in force. */
export function certificationCheck(engine: ComplianceEngine, card: TaskCard, signer: Signer, at: Date): Decision<CertificationOutcome> {
  return engine.canCertify(card.operatorId, {
    privileges: signer.privileges,
    authorisation: signer.authorisation,
    aircraftType: card.aircraftType,
    trade: card.trade,
    at,
    currency: signer.currency ? { ...signer.currency, at } : undefined
  });
}

function requireCertifying(engine: ComplianceEngine, card: TaskCard, signer: Signer, at: Date) {
  const d = certificationCheck(engine, card, signer, at);
  if (!d.value.allowed) throw new DomainError('NOT_AUTHORISED_TO_CERTIFY', d.value.reason, 422);
  return { rule: d.rule, via: d.value.via };
}

export async function signStep(engine: ComplianceEngine, card: TaskCard, n: number, signer: Signer, at: Date, sign: Sign, tools: Tool[] = []): Promise<{
  card: TaskCard; event: DomainEvent<'amo.taskcard.step_signed'>;
}> {
  if (card.status === 'CERTIFIED') throw new DomainError('CARD_CERTIFIED', `${card.id} is already certified`, 409);
  const step = card.steps.find(s => s.n === n);
  if (!step) throw new DomainError('STEP_UNKNOWN', `${card.id} has no step ${n}`, 404);
  if (step.stamp) throw new DomainError('STEP_STAMPED', `Step ${n} was already stamped by ${step.stamp.name}`, 409);
  const { rule, via } = requireCertifying(engine, card, signer, at);
  const toolIds = tools.length ? requireCalibrated(tools, at).ids : undefined;
  const payload = { kind: 'STEP_STAMP', taskCardId: card.id, tail: card.tail, step: n, text: step.text, personnelId: signer.personnelId, licence: signer.licenceNo, rule, tools: toolIds, at: at.toISOString() };
  const stamp: Stamp = { personnelId: signer.personnelId, name: signer.name, licence: signer.licenceNo, at, rule, via, signature: await sign(payload, at), ...(toolIds ? { tools: toolIds } : {}) };
  const next: TaskCard = {
    ...card,
    steps: card.steps.map(s => (s.n === n ? { ...s, stamp } : s)),
    status: 'IN_PROGRESS',
    version: card.version + 1
  };
  return { card: next, event: { type: 'amo.taskcard.step_signed', data: { taskCardId: card.id, step: n, tail: card.tail, personnelId: signer.personnelId } } };
}

/** Issue the Certificate of Release to Service. Every step must be stamped first. */
export async function issueCrs(engine: ComplianceEngine, card: TaskCard, signer: Signer, at: Date, crsNumber: string, sign: Sign): Promise<{
  card: TaskCard; event: DomainEvent<'amo.crs.issued'>;
}> {
  if (card.status === 'CERTIFIED') throw new DomainError('CARD_CERTIFIED', `${card.id} is already certified (${card.crs?.number})`, 409);
  const open = card.steps.filter(s => !s.stamp).map(s => s.n);
  if (open.length) throw new DomainError('STEPS_OPEN', `Steps ${open.join(', ')} must be stamped before the CRS can be issued`, 422);
  const { rule, via } = requireCertifying(engine, card, signer, at);
  const payload = {
    kind: 'CRS', crsNumber, taskCardId: card.id, tail: card.tail, aircraftType: card.aircraftType, title: card.title,
    steps: card.steps.map(s => ({ n: s.n, sha: s.stamp!.signature.payloadSha256 })),
    personnelId: signer.personnelId, licence: signer.licenceNo, rule, at: at.toISOString()
  };
  const crs = { number: crsNumber, personnelId: signer.personnelId, name: signer.name, licence: signer.licenceNo, at, rule, via, signature: await sign(payload, at) };
  return {
    card: { ...card, status: 'CERTIFIED', crs, version: card.version + 1 },
    event: { type: 'amo.crs.issued', data: { taskCardId: card.id, crsNumber, eoId: card.source.id, tail: card.tail, personnelId: signer.personnelId, sourceType: card.source.type } }
  };
}
