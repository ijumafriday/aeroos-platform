import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';

/** The authenticated caller, derived from a verified OIDC access token. */
export interface Principal {
  subject: string;
  username: string;
  name: string;
  roles: string[];
  /** Operators (tenants) the user belongs to, from Keycloak group membership. */
  operators: string[];
  /** The operator this request acts for: the X-Operator header if given (must be a membership), else the first membership. */
  operatorId: string;
  /** When the user last actually authenticated (OIDC auth_time, epoch seconds) — used for step-up. */
  authTime: number | null;
}

export const actorOf = (p: Principal) => `user:${p.username}`;

export const CurrentPrincipal = createParamDecorator((_: unknown, ctx: ExecutionContext): Principal => {
  const req = ctx.switchToHttp().getRequest<{ principal?: Principal }>();
  if (!req.principal) throw new Error('No principal on request — is the route marked @Public()?');
  return req.principal;
});

export const IS_PUBLIC = 'aeroos:isPublic';
/** Skip OIDC authentication (health checks, internal endpoints with their own guard). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
