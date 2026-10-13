import { ForbiddenException, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { newId } from '@aeroos/kernel';
import { CONFIG, type Config } from '../../config';
import type { Principal } from '../auth/principal';

export interface ResourceRef {
  kind: 'mel_item' | 'task_card' | 'audit_chain' | 'personnel' | 'document' | 'flight' | 'crew_roster' | 'recovery' | 'stores' | 'maintenance_programme' | 'work_package' | 'directive' | 'controlled_document' | 'occurrence' | 'quality_audit' | 'safety_action' | 'quality_action' | 'nonconformity' | 'procurement' | 'dispatch' | 'fatigue_report' | 'crew_hub' | 'engine_health' | 'structural_damage' | 'compliance_matrix' | 'billing' | 'ledger' | 'enterprise' | 'executive_dashboard' | 'integration' | 'aircraft_configuration' | 'technical_record' | 'platform_migration' | 'platform_rule' | 'maintenance_control' | 'reliability_control' | 'compliance_control' | 'master_data_governance' | 'engineering_control' | 'crew_control' | 'ops_control' | 'commercial_control' | 'quality_control' | 'safety_control' | 'analytics_control';
  id: string;
  attr: Record<string, string | number | boolean | string[]>;
}

interface CheckResponse {
  results?: { resource: { id: string }; actions: Record<string, 'EFFECT_ALLOW' | 'EFFECT_DENY'> }[];
}

/**
 * Authorisation via Cerbos (policies in infra/cerbos/policies). Fails closed: if the policy
 * decision point is unreachable, the action is refused, never allowed.
 */
@Injectable()
export class AuthzService {
  private readonly log = new Logger('Authz');

  constructor(@Inject(CONFIG) private readonly config: Config) {}

  async decide(p: Principal, resource: ResourceRef, actions: string[]): Promise<Record<string, boolean>> {
    let res: Response;
    try {
      res = await fetch(`${this.config.CERBOS_URL}/api/check/resources`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          requestId: newId(),
          // Only the operator this request acts for: a user in several AOCs reaches the other one's records only
          // after switching (X-Operator), never by id from the wrong context.
          principal: { id: p.subject, roles: p.roles, attr: { operators: [p.operatorId], memberships: p.operators, username: p.username } },
          resources: [{ actions, resource }]
        }),
        signal: AbortSignal.timeout(3000)
      });
    } catch (e) {
      this.log.error(`Cerbos unreachable: ${(e as Error).message}`);
      throw new ServiceUnavailableException('The authorisation service is unavailable; the action was not performed');
    }
    if (!res.ok) throw new ServiceUnavailableException(`The authorisation service returned ${res.status}`);
    const body = (await res.json()) as CheckResponse;
    const effects = body.results?.[0]?.actions ?? {};
    return Object.fromEntries(actions.map(a => [a, effects[a] === 'EFFECT_ALLOW']));
  }

  async check(p: Principal, resource: ResourceRef, action: string): Promise<void> {
    const r = await this.decide(p, resource, [action]);
    if (!r[action]) {
      throw new ForbiddenException(`You are not permitted to ${action.replace(/_/g, ' ')} on ${resource.kind.replace(/_/g, ' ')} ${resource.id}`);
    }
  }
}
