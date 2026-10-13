import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC, type Principal } from './principal';
import { TokenVerifier } from './token-verifier';

/** Global guard: every HTTP route requires a valid OIDC bearer token unless marked @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly verifier: TokenVerifier) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; principal?: Principal }>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Sign in required');
    const principal = await this.verifier.verify(header.slice(7));
    // Users in several operators pick one per request (X-Operator); it must be one of their groups.
    // Every service scopes by principal.operatorId, and Cerbos re-checks it against principal.operators.
    const selected = req.headers['x-operator'];
    if (selected) {
      if (!principal.operators.includes(selected)) throw new ForbiddenException(`You are not a member of operator ${selected}`);
      principal.operatorId = selected;
    }
    req.principal = principal;
    return true;
  }
}

/** Service-to-service guard for trusted AeroOS workloads using OIDC client-credentials tokens. */
@Injectable()
export class InternalGuard implements CanActivate {
  constructor(private readonly verifier: TokenVerifier) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; internalService?: { clientId: string } }>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Internal service identity required');
    const service = await this.verifier.verifyService(header.slice(7));
    if (!service.roles.includes('service_worker')) throw new UnauthorizedException('Internal service role required');
    req.internalService = { clientId: service.clientId };
    return true;
  }
}
