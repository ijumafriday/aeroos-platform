import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { pgSchema, text, timestamp } from 'drizzle-orm/pg-core';
import type { Observable } from 'rxjs';
import { DB_TOKEN, type ModuleDb } from '../database/module-db';

const p=pgSchema('platform');
const policies=p.table('api_lifecycle_policies',{id:text('id').primaryKey(),operatorId:text('operator_id').notNull(),apiName:text('api_name').notNull(),routePrefix:text('route_prefix').notNull(),status:text('status').notNull(),sunsetAt:timestamp('sunset_at',{withTimezone:true,mode:'date'}),replacementRef:text('replacement_ref')});

/** Emits RFC-style deprecation metadata from approved runtime API lifecycle policy. */
@Injectable()
export class ApiLifecycleInterceptor implements NestInterceptor {
  constructor(@Inject(DB_TOKEN.platform) private readonly db:ModuleDb) {}
  async intercept(ctx:ExecutionContext,next:CallHandler):Promise<Observable<unknown>> {
    const req=ctx.switchToHttp().getRequest<{path?:string;url?:string;principal?:{operatorId?:string}}>();
    const res=ctx.switchToHttp().getResponse<{setHeader:(name:string,value:string)=>void}>();
    const operatorId=req.principal?.operatorId, path=(req.path??req.url??'').split('?')[0];
    if(operatorId){
      const rows=await this.db.db.select().from(policies).where(and(eq(policies.operatorId,operatorId),eq(policies.status,'DEPRECATED')));
      const policy=rows.filter(x=>path.startsWith(x.routePrefix)).sort((a,b)=>b.routePrefix.length-a.routePrefix.length)[0];
      if(policy?.sunsetAt){
        res.setHeader('Deprecation','true');
        res.setHeader('Sunset',policy.sunsetAt.toUTCString());
        if(policy.replacementRef) res.setHeader('Link',`<${policy.replacementRef}>; rel="successor-version"`);
      }
    }
    return next.handle();
  }
}
