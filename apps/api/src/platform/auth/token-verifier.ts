import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { CONFIG, type Config } from '../../config';
import type { Principal } from './principal';

interface KeycloakClaims extends JWTPayload {
  azp?: string;
  preferred_username?: string;
  name?: string;
  realm_access?: { roles?: string[] };
  operators?: string[];
  auth_time?: number | string;
}

/**
 * Verifies Keycloak-issued access tokens against the realm's published keys.
 * The issuer is the public URL users see; the key set is fetched over the internal network,
 * which is what lets the same image run behind any ingress, in any cloud or on premises.
 */
@Injectable()
export class TokenVerifier {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(@Inject(CONFIG) private readonly config: Config) {
    this.jwks = createRemoteJWKSet(new URL(config.OIDC_JWKS_URL), { cooldownDuration: 30_000 });
  }

  async verify(token: string): Promise<Principal> {
    let payload: KeycloakClaims;
    try {
      ({ payload } = await jwtVerify<KeycloakClaims>(token, this.jwks, {
        issuer: this.config.OIDC_ISSUER,
        audience: this.config.OIDC_AUDIENCE
      }));
    } catch (e) {
      throw new UnauthorizedException(`Session not valid: ${(e as Error).message}`);
    }
    const operators = [...new Set((payload.operators ?? []).map(o => o.replace(/^\//, '')))].sort();
    if (!payload.sub || !operators.length) throw new UnauthorizedException('Your account is not assigned to an operator');
    return {
      subject: payload.sub,
      username: payload.preferred_username ?? payload.sub,
      name: payload.name ?? payload.preferred_username ?? payload.sub,
      roles: payload.realm_access?.roles ?? [],
      operators,
      // Default when the request names none: the configured home operator if the user belongs to it.
      operatorId: this.config.DEFAULT_OPERATOR && operators.includes(this.config.DEFAULT_OPERATOR) ? this.config.DEFAULT_OPERATOR : operators[0],
      authTime: payload.auth_time === undefined ? null : Number(payload.auth_time)
    };
  }
  async verifyService(token: string): Promise<{ clientId: string; roles: string[] }> {
    let payload: KeycloakClaims;
    try {
      ({ payload } = await jwtVerify<KeycloakClaims>(token, this.jwks, {
        issuer: this.config.OIDC_ISSUER,
        audience: this.config.OIDC_AUDIENCE
      }));
    } catch (e) {
      throw new UnauthorizedException(`Service token not valid: ${(e as Error).message}`);
    }
    const clientId = payload.azp;
    if (!payload.sub || !clientId) throw new UnauthorizedException('Service token has no client identity');
    return { clientId, roles: payload.realm_access?.roles ?? [] };
  }

}
