import {
  ArgumentsHost, BadRequestException, CallHandler, Catch, ConflictException, ExceptionFilter, ExecutionContext,
  HttpException, Inject, Injectable, Logger, NestInterceptor, PipeTransform
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { from, mergeMap, catchError, throwError, of, type Observable } from 'rxjs';
import type { ZodSchema } from 'zod';
import { DomainError } from '@aeroos/kernel';
import type { ApiError } from '@aeroos/contracts';
import type { Principal } from '../auth/principal';
import { DB_TOKEN, type ModuleDb } from '../database/module-db';
import { idempotency } from '../database/platform.tables';

/** Validate a request body against a zod schema. */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}
  transform(value: unknown): T {
    const r = this.schema.safeParse(value ?? {});
    if (!r.success) {
      const i = r.error.issues[0];
      throw new BadRequestException(`${i.path.join('.') || 'body'}: ${i.message}`);
    }
    return r.data;
  }
}

/** One error shape for every failure: { statusCode, code, message }. */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly log = new Logger('Error');

  catch(err: unknown, host: ArgumentsHost) {
    if (host.getType() !== 'http') return;
    const reply = host.switchToHttp().getResponse<{ status(n: number): { send(b: unknown): void } }>();
    let body: ApiError;
    if (err instanceof DomainError) {
      body = { statusCode: err.status, code: err.code, message: err.message };
    } else if (err instanceof HttpException) {
      const r = err.getResponse();
      const message = typeof r === 'string' ? r : ((r as { message?: string | string[] }).message ?? err.message);
      body = { statusCode: err.getStatus(), code: err.name.replace(/Exception$/, '').toUpperCase(), message: Array.isArray(message) ? message.join('; ') : message };
    } else {
      this.log.error(err instanceof Error ? err.stack : String(err));
      body = { statusCode: 500, code: 'INTERNAL', message: 'Something went wrong on our side. The action was not completed.' };
    }
    reply.status(body.statusCode).send(body);
  }
}

/**
 * Idempotency-Key support for every POST. A retried request (flaky hangar Wi-Fi, double tap)
 * returns the first response instead of issuing a second CRS or engineering order.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(@Inject(DB_TOKEN.platform) private readonly db: ModuleDb) {}

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<{ method: string; headers: Record<string, string | undefined>; principal?: Principal }>();
    const key = req.headers['idempotency-key'];
    if (req.method !== 'POST' || !key || !req.principal) return next.handle();
    if (key.length > 100) throw new BadRequestException('Idempotency-Key is too long');
    const actor = req.principal.subject;
    const where = and(eq(idempotency.actor, actor), eq(idempotency.key, key));

    const claimed = await this.db.db.insert(idempotency).values({ actor, key, status: 'PENDING' }).onConflictDoNothing().returning({ key: idempotency.key });
    if (!claimed.length) {
      const [row] = await this.db.db.select().from(idempotency).where(where).limit(1);
      if (row?.status === 'DONE') return of(row.response);
      throw new ConflictException('This request is already being processed');
    }
    return next.handle().pipe(
      mergeMap(body => from(this.db.db.update(idempotency).set({ status: 'DONE', response: body ?? null }).where(where)).pipe(mergeMap(() => of(body)))),
      catchError(err => from(this.db.db.delete(idempotency).where(where)).pipe(mergeMap(() => throwError(() => err))))
    );
  }
}
