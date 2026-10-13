import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import type { Principal } from '../auth/principal';
import { runTenantContext, type TenantContext } from './tenant-context';

interface RequestIdentity {
  principal?: Principal;
  internalService?: { clientId: string };
}

/** Binds the authenticated request identity to every database query made while handling the request. */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<RequestIdentity>();
    const tenant: TenantContext = req.internalService
      ? { system: true, actor: `service:${req.internalService.clientId}` }
      : req.principal
        ? { operatorId: req.principal.operatorId, actor: `user:${req.principal.username}` }
        : {};
    return new Observable(subscriber => runTenantContext(tenant, () => next.handle().subscribe(subscriber)));
  }
}
