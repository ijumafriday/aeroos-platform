import { BadRequestException, Body, Controller, Get, Inject, Injectable, OnApplicationBootstrap, Param, Post } from '@nestjs/common';
import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { EVENT_TYPES, TOPICS, type EventEnvelope, type EventType, type Severity } from '@aeroos/contracts';
import { newId } from '@aeroos/kernel';
import { AuditService } from '../audit/audit.service';
import { CurrentPrincipal, actorOf, type Principal } from '../auth/principal';
import { AuthzService } from '../authz/authz.service';
import { DB_TOKEN, type ModuleDb } from '../database/module-db';
import { decisionRules, ruleExecutions } from '../database/platform.tables';
import { runTenantContext } from '../database/tenant-context';
import { KafkaService } from '../events/kafka.service';
import { ZodPipe } from '../http/http';
import { NotificationsService } from '../notifications/notifications.service';

const scalar = z.union([z.string().max(500), z.number(), z.boolean(), z.null()]);
const predicate = z.object({ field: z.string().regex(/^(data\.)?[A-Za-z0-9_.]{1,100}$/), op: z.enum(['EQ','NE','IN','CONTAINS','EXISTS']), value: z.union([scalar, z.array(scalar).max(100)]).optional() });
const conditionSchema = z.object({ all: z.array(predicate).max(20).default([]), any: z.array(predicate).max(20).default([]) }).refine(x => x.all.length + x.any.length > 0, 'At least one predicate is required');
const actionSchema = z.object({ kind: z.literal('NOTIFY'), severity: z.enum(['red','amber','green','cyan','mag']), title: z.string().trim().min(3).max(160), body: z.string().trim().min(3).max(1000), link: z.string().max(500).nullable().default(null) });
const createSchema = z.object({ name:z.string().trim().min(3).max(100), eventType:z.enum(EVENT_TYPES as unknown as [EventType,...EventType[]]), priority:z.number().int().min(1).max(1000).default(100), condition:conditionSchema, action:actionSchema }).refine(x => x.eventType !== 'platform.notification.raised', { message:'Rules may not trigger from platform.notification.raised' });
const reasonSchema=z.object({ reason:z.string().trim().min(5).max(500) });

type Predicate=z.infer<typeof predicate>;
function getPath(obj:unknown,path:string):unknown { let cur:any=obj; for(const p of path.replace(/^data\./,'').split('.')) { if(cur==null||typeof cur!=='object') return undefined; cur=cur[p]; } return cur; }
export function predicateMatches(env:EventEnvelope,p:Predicate):boolean {
 const actual=getPath(env.data,p.field); const expected=p.value;
 switch(p.op){
  case 'EXISTS': return actual!==undefined&&actual!==null;
  case 'EQ': return actual===expected;
  case 'NE': return actual!==expected;
  case 'IN': return Array.isArray(expected)&&expected.some(v=>v===actual);
  case 'CONTAINS': return Array.isArray(actual)?actual.includes(expected as never):typeof actual==='string'&&typeof expected==='string'&&actual.includes(expected);
 }
 return false;
}
export function ruleMatches(env:EventEnvelope,c:z.infer<typeof conditionSchema>):boolean { return c.all.every(x=>predicateMatches(env,x)) && (c.any.length===0 || c.any.some(x=>predicateMatches(env,x))); }
function render(template:string,env:EventEnvelope):string { return template.replace(/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g,(_,path)=>{const v=path==='type'?env.type:path==='actor'?env.actor:getPath(env.data,path); return v===undefined||v===null?'':String(v);}).slice(0,2000); }

@Injectable()
export class RuleService implements OnApplicationBootstrap {
 constructor(@Inject(DB_TOKEN.platform) private readonly db:ModuleDb,private readonly kafka:KafkaService,private readonly notifications:NotificationsService,private readonly audit:AuditService){}
 onApplicationBootstrap(){ this.kafka.start('aeroos-rules-v1',Object.values(TOPICS),e=>this.onEvent(e),{fromBeginning:false}); }
 list(operatorId:string){ return this.db.db.select().from(decisionRules).where(eq(decisionRules.operatorId,operatorId)).orderBy(desc(decisionRules.createdAt)); }
 executions(operatorId:string,id:string){ return this.db.db.select().from(ruleExecutions).where(and(eq(ruleExecutions.operatorId,operatorId),eq(ruleExecutions.ruleId,id))).orderBy(desc(ruleExecutions.executedAt)).limit(100); }
 async create(p:Principal,b:z.infer<typeof createSchema>){ const id=newId(); await this.db.transaction(async()=>{ await this.db.db.insert(decisionRules).values({id,operatorId:p.operatorId,name:b.name,eventType:b.eventType,status:'DRAFT',priority:b.priority,condition:b.condition,action:b.action,createdBy:actorOf(p)}); await this.audit.record(this.db,'platform',{operatorId:p.operatorId,actor:actorOf(p),action:'rule.created',entityType:'decision_rule',entityId:id,data:{name:b.name,eventType:b.eventType,priority:b.priority},rule:'PLATFORM-RULE-01'}); }); return {id,status:'DRAFT'}; }
 async activate(p:Principal,id:string,reason:string){ return this.db.transaction(async()=>{ const [r]=await this.db.db.select().from(decisionRules).where(and(eq(decisionRules.id,id),eq(decisionRules.operatorId,p.operatorId))).for('update').limit(1); if(!r||r.status!=='DRAFT') throw new BadRequestException('Only DRAFT rules can be activated'); const [same]=await this.db.db.select({id:decisionRules.id}).from(decisionRules).where(and(eq(decisionRules.operatorId,p.operatorId),eq(decisionRules.name,r.name),eq(decisionRules.status,'ACTIVE'))).limit(1); if(same) throw new BadRequestException(`An active rule named ${r.name} already exists`); await this.db.db.update(decisionRules).set({status:'ACTIVE',activatedBy:actorOf(p),activatedAt:new Date(),changeReason:reason}).where(eq(decisionRules.id,id)); await this.audit.record(this.db,'platform',{operatorId:p.operatorId,actor:actorOf(p),action:'rule.activated',entityType:'decision_rule',entityId:id,data:{reason,eventType:r.eventType},rule:'PLATFORM-RULE-01'}); return {id,status:'ACTIVE'}; }); }
 async retire(p:Principal,id:string,reason:string){ return this.db.transaction(async()=>{ const [r]=await this.db.db.select().from(decisionRules).where(and(eq(decisionRules.id,id),eq(decisionRules.operatorId,p.operatorId))).for('update').limit(1); if(!r||r.status!=='ACTIVE') throw new BadRequestException('Only ACTIVE rules can be retired'); await this.db.db.update(decisionRules).set({status:'RETIRED',retiredBy:actorOf(p),retiredAt:new Date(),changeReason:reason}).where(eq(decisionRules.id,id)); await this.audit.record(this.db,'platform',{operatorId:p.operatorId,actor:actorOf(p),action:'rule.retired',entityType:'decision_rule',entityId:id,data:{reason},rule:'PLATFORM-RULE-01'}); return {id,status:'RETIRED'}; }); }
 private async onEvent(env:EventEnvelope){
  if(env.type==='platform.notification.raised') return;
  await runTenantContext({operatorId:env.operatorId,system:false},async()=>{
    const rules=await this.db.db.select().from(decisionRules).where(and(eq(decisionRules.operatorId,env.operatorId),eq(decisionRules.eventType,env.type),eq(decisionRules.status,'ACTIVE'))).orderBy(asc(decisionRules.priority));
    for(const r of rules){
      await this.db.transaction(async()=>{
        const already=await this.db.db.select({id:ruleExecutions.id}).from(ruleExecutions).where(and(eq(ruleExecutions.ruleId,r.id),eq(ruleExecutions.eventId,env.id))).limit(1);
        if(already[0]) return;
        let matched=false,outcome='NO_MATCH',error:string|null=null;
        try {
          matched=ruleMatches(env,r.condition as z.infer<typeof conditionSchema>);
          if(matched){
            const a=r.action as z.infer<typeof actionSchema>;
            await this.notifications.raise(this.db,{operatorId:env.operatorId,severity:a.severity as Severity,title:render(a.title,env),body:render(a.body,env),link:a.link?render(a.link,env):null,actor:`rule:${r.id}`});
            outcome='NOTIFIED';
          }
        } catch(e){ outcome='ERROR'; error=(e as Error).message.slice(0,1000); }
        await this.db.db.insert(ruleExecutions).values({operatorId:env.operatorId,ruleId:r.id,eventId:env.id,eventType:env.type,matched,outcome,error});
      });
    }
  });
 }
}

@Controller('v1/platform/rules')
export class RuleController {
 constructor(private readonly svc:RuleService,private readonly authz:AuthzService){}
 private permit(p:Principal,action:string,id='rules'){return this.authz.check(p,{kind:'platform_rule',id,attr:{operatorId:p.operatorId}},action);}
 @Get('event-types') async eventTypes(@CurrentPrincipal() p:Principal){await this.permit(p,'read');return EVENT_TYPES;}
 @Get() async list(@CurrentPrincipal() p:Principal){await this.permit(p,'read');return this.svc.list(p.operatorId);}
 @Get(':id/executions') async executions(@CurrentPrincipal() p:Principal,@Param('id') id:string){await this.permit(p,'read',id);return this.svc.executions(p.operatorId,id);}
 @Post() async create(@CurrentPrincipal() p:Principal,@Body(new ZodPipe(createSchema)) b:z.infer<typeof createSchema>){await this.permit(p,'manage');return this.svc.create(p,b);}
 @Post(':id/activate') async activate(@CurrentPrincipal() p:Principal,@Param('id') id:string,@Body(new ZodPipe(reasonSchema)) b:z.infer<typeof reasonSchema>){await this.permit(p,'manage',id);return this.svc.activate(p,id,b.reason);}
 @Post(':id/retire') async retire(@CurrentPrincipal() p:Principal,@Param('id') id:string,@Body(new ZodPipe(reasonSchema)) b:z.infer<typeof reasonSchema>){await this.permit(p,'manage',id);return this.svc.retire(p,id,b.reason);}
}
