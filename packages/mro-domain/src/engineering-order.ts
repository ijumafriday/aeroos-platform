import { DomainError } from '@aeroos/kernel';
import type { DomainEvent, Trade } from '@aeroos/contracts';
import type { MelItem } from './mel';

export interface EngineeringOrder {
  id: string;
  operatorId: string;
  tail: string;
  aircraftType: string;
  title: string;
  ata: string;
  trade: Trade;
  source: { type: 'MEL'; id: string };
  steps: string[];
  estimatedHours: number;
  status: 'RELEASED';
  createdAt: Date;
  createdBy: string;
}

/**
 * Default trade by ATA chapter, used to decide which licence category may certify the work.
 * Operators override per task in their task-card templates; this is only the starting point.
 */
const ATA_TRADE: Record<string, Trade> = {
  '22': 'AVIONICS', '23': 'AVIONICS', '24': 'AVIONICS', '31': 'AVIONICS', '33': 'AVIONICS', '34': 'AVIONICS',
  '42': 'AVIONICS', '44': 'AVIONICS', '45': 'AVIONICS', '46': 'AVIONICS',
  '49': 'POWERPLANT', '61': 'POWERPLANT', '71': 'POWERPLANT', '72': 'POWERPLANT', '73': 'POWERPLANT', '74': 'POWERPLANT',
  '75': 'POWERPLANT', '76': 'POWERPLANT', '77': 'POWERPLANT', '78': 'POWERPLANT', '79': 'POWERPLANT', '80': 'POWERPLANT',
  '51': 'STRUCTURES', '52': 'STRUCTURES', '53': 'STRUCTURES', '54': 'STRUCTURES', '55': 'STRUCTURES', '56': 'STRUCTURES', '57': 'STRUCTURES'
};
export const tradeForAta = (ata: string): Trade => ATA_TRADE[ata.slice(0, 2)] ?? 'MECHANICAL';

/** Build the engineering order that rectifies a deferred defect. */
export function engineeringOrderForDeferral(item: MelItem, id: string, by: string, at: Date): { eo: EngineeringOrder; event: DomainEvent<'camo.eo.released'> } {
  if (item.status !== 'OPEN') throw new DomainError('MEL_NOT_OPEN', `${item.id} is ${item.status.toLowerCase()}; an engineering order cannot be raised`, 409);
  if (item.eoId) throw new DomainError('EO_EXISTS', `${item.id} already has engineering order ${item.eoId}`, 409);
  const eo: EngineeringOrder = {
    id,
    operatorId: item.operatorId,
    tail: item.tail,
    aircraftType: item.aircraftType,
    title: `Rectify MEL ${item.melRef}: ${item.title}`,
    ata: item.ata,
    trade: tradeForAta(item.ata),
    source: { type: 'MEL', id: item.id },
    steps: [
      `Troubleshoot per FIM chapter ${item.ata}`,
      'Rectify per AMM',
      'Operational / functional test per AMM',
      `Clear deferral ${item.id} (MEL ${item.melRef}) in the technical log`
    ],
    estimatedHours: 2.5,
    status: 'RELEASED',
    createdAt: at,
    createdBy: by
  };
  return {
    eo,
    event: {
      type: 'camo.eo.released',
      data: { eoId: eo.id, tail: eo.tail, aircraftType: eo.aircraftType, title: eo.title, ata: eo.ata, trade: eo.trade, steps: eo.steps, estimatedHours: eo.estimatedHours, source: eo.source }
    }
  };
}
