import { Body, Controller, Get, Inject, Injectable, Param, Post, Query } from '@nestjs/common';
import { and, asc, desc, eq, inArray, like, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { doublePrecision, integer, jsonb, pgSchema, serial, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import type { EventEnvelope, Trade } from '@aeroos/contracts';
import { DomainError } from '@aeroos/kernel';
import { actorOf, CurrentPrincipal, type Principal } from '../../platform/auth/principal';
import { AuditService } from '../../platform/audit/audit.service';
import { AuthzService } from '../../platform/authz/authz.service';
import { DB_TOKEN, type ModuleDb } from '../../platform/database/module-db';
import { InboxService } from '../../platform/events/outbox';
import { ZodPipe } from '../../platform/http/http';
import { reservations, tools, wpSlots } from './stores.service';

const amo = pgSchema('amo');
const ts = (n: string) => timestamp(n, { withTimezone: true, mode: 'date' });
const taskCards = amo.table('task_cards', {
  id: text('id').primaryKey(), operatorId: text('operator_id').notNull(), title: text('title').notNull(), trade: text('trade').notNull(),
  sourceType: text('source_type').notNull(), sourceId: text('source_id').notNull(), status: text('status').notNull(),
  createdAt: ts('created_at').notNull(), requirements: jsonb('requirements').$type<{ tools: string[]; parts: { partNo: string; qty: number }[]; predecessors?: string[] }>().notNull()
});

export const maintenanceShifts = amo.table('maintenance_shifts', {
  id: uuid('id').primaryKey(), operatorId: text('operator_id').notNull(), station: text('station').notNull(), name: text('name').notNull(),
  startsAt: ts('starts_at').notNull(), endsAt: ts('ends_at').notNull(), capacity: jsonb('capacity').$type<{ trade: Trade; hours: number }[]>().notNull(),
  createdBy: text('created_by').notNull(), createdAt: ts('created_at').notNull().defaultNow()
});
export const wpProduction = amo.table('work_package_production', {
  wpId: text('wp_id').primaryKey(), operatorId: text('operator_id').notNull(), tail: text('tail').notNull(), station: text('station').notNull(), title: text('title').notNull(),
  checkType: text('check_type').notNull(), plannedHours: jsonb('planned_hours').$type<{trade:Trade;hours:number}[]>().notNull(), taskPlan: jsonb('task_plan').$type<{requirementId:string;estimatedHours:number;predecessors:string[]}[]>().notNull(), status: text('status').notNull(), plannedStart: ts('planned_start'), plannedEnd: ts('planned_end'), actualStart: ts('actual_start'), actualEnd: ts('actual_end'),
  holdReason: text('hold_reason'), updatedAt: ts('updated_at').notNull().defaultNow()
});
export const wpShiftAllocations = amo.table('work_package_shift_allocations', {
  id: serial('id').primaryKey(), operatorId: text('operator_id').notNull(), wpId: text('wp_id').notNull(), shiftId: uuid('shift_id').notNull(), trade: text('trade').notNull(), hours: doublePrecision('hours').notNull(), allocatedBy: text('allocated_by').notNull(), allocatedAt: ts('allocated_at').notNull().defaultNow()
});
export const wpMilestones = amo.table('work_package_milestones', {
  id: serial('id').primaryKey(), operatorId: text('operator_id').notNull(), wpId: text('wp_id').notNull(), code: text('code').notNull(), title: text('title').notNull(),
  plannedAt: ts('planned_at').notNull(), status: text('status').notNull(), actualAt: ts('actual_at'), completedBy: text('completed_by')
});
export const nonRoutines = amo.table('non_routines', {
  id: text('id').primaryKey(), operatorId: text('operator_id').notNull(), wpId: text('wp_id').notNull(), taskCardId: text('task_card_id'), title: text('title').notNull(),
  description: text('description').notNull(), ata: text('ata'), trade: text('trade').notNull(), estimatedHours: doublePrecision('estimated_hours').notNull(), actualMinutes: integer('actual_minutes').notNull(),
  status: text('status').notNull(), disposition: text('disposition'), createdBy: text('created_by').notNull(), createdAt: ts('created_at').notNull(), closedBy: text('closed_by'), closedAt: ts('closed_at')
});
export const labourEntries = amo.table('labour_entries', {
  id: serial('id').primaryKey(), operatorId: text('operator_id').notNull(), wpId: text('wp_id').notNull(), taskCardId: text('task_card_id'), nonRoutineId: text('non_routine_id'),
  personnelId: text('personnel_id').notNull(), trade: text('trade').notNull(), startedAt: ts('started_at').notNull(), endedAt: ts('ended_at').notNull(), minutes: integer('minutes').notNull(),
  note: text('note'), createdBy: text('created_by').notNull(), createdAt: ts('created_at').notNull().defaultNow()
});

const trade = z.enum(['MECHANICAL','POWERPLANT','AVIONICS','STRUCTURES']);
const shiftSchema = z.object({ station: z.string().trim().length(4), name: z.string().trim().min(2).max(80), startsAt: z.string().datetime({ offset: true }), endsAt: z.string().datetime({ offset: true }), capacity: z.array(z.object({ trade, hours: z.number().positive().max(500) })).min(1).max(8) });
const allocationSchema=z.object({shiftId:z.string().uuid(),trade,hours:z.number().min(0).max(500)});
const stateSchema = z.object({ state: z.enum(['START','HOLD','RESUME']), reason: z.string().trim().min(5).max(500).optional() });
const nrSchema = z.object({ taskCardId: z.string().min(2).max(40).nullable().default(null), title: z.string().trim().min(3).max(160), description: z.string().trim().min(10).max(4000), ata: z.string().trim().max(8).nullable().default(null), trade, estimatedHours: z.number().min(0).max(1000) });
const nrStateSchema = z.object({ state: z.enum(['IN_WORK','CLOSED','CANCELLED']), disposition: z.string().trim().min(5).max(1000).optional() });
const labourSchema = z.object({ taskCardId: z.string().min(2).max(40).nullable().default(null), nonRoutineId: z.string().min(2).max(40).nullable().default(null), personnelId: z.string().min(2).max(80), trade, startedAt: z.string().datetime({ offset: true }), endedAt: z.string().datetime({ offset: true }), note: z.string().trim().max(500).nullable().default(null) });

@Injectable()
export class ProductionControlService {
  constructor(@Inject(DB_TOKEN.amo) private readonly db: ModuleDb, private readonly authz: AuthzService, private readonly audit: AuditService, private readonly inbox: InboxService) {}
  private res(p: Principal, id = '*') { return { kind: 'work_package' as const, id, attr: { operatorId: p.operatorId } }; }
  private async can(p: Principal, action: string, id='*') { return this.authz.check(p, this.res(p,id), action); }
  private async next(seq: string, prefix: string) { const r = await this.db.db.execute<{n:string}>(sql.raw(`select nextval('amo.${seq}')::text n`)); return `${prefix}-${r.rows[0].n}`; }

  async onWorkPackageReleased(env: EventEnvelope<'camo.wp.released'>) {
    await this.inbox.once(this.db, 'amo.production', env, async () => {
      const [slot] = await this.db.db.select().from(wpSlots).where(eq(wpSlots.wpId, env.data.wpId));
      await this.db.db.insert(wpProduction).values({ wpId: env.data.wpId, operatorId: env.operatorId, tail: env.data.tail, station: env.data.station, title: env.data.title,
        checkType: env.data.checkType, plannedHours: Object.entries(env.data.items.reduce((m,it)=>{m[it.trade]=(m[it.trade]??0)+it.estimatedHours;return m},{} as Record<string,number>)).map(([trade,hours])=>({trade:trade as Trade,hours})), taskPlan:env.data.items.map(it=>({requirementId:it.requirementId,estimatedHours:it.estimatedHours,predecessors:it.predecessors})), status: 'READY', plannedStart: slot?.plannedStart ?? null, plannedEnd: slot?.plannedEnd ?? null, updatedAt: new Date() }).onConflictDoNothing();
      const start = slot?.plannedStart ?? new Date(); const end = slot?.plannedEnd ?? new Date(start.getTime()+8*3_600_000); const span=end.getTime()-start.getTime();
      const ms = [
        ['INDUCTION','Aircraft induction',start],
        ['OPEN_UP','Access/open-up complete',new Date(start.getTime()+span*.15)],
        ['INSPECTION','Primary inspection complete',new Date(start.getTime()+span*.45)],
        ['CLOSE_UP','Close-up complete',new Date(start.getTime()+span*.85)],
        ['RELEASE','Package release target',end]
      ];
      for (const [code,title,plannedAt] of ms) await this.db.db.insert(wpMilestones).values({operatorId:env.operatorId,wpId:env.data.wpId,code:String(code),title:String(title),plannedAt:plannedAt as Date,status:'PENDING'}).onConflictDoNothing();
    });
  }

  async onWorkPackageCompleted(env: EventEnvelope<'camo.wp.completed'>) {
    await this.inbox.once(this.db, 'amo.production.completed', env, async () => {
      await this.db.db.update(wpProduction).set({ status: 'COMPLETE', actualEnd: new Date(env.occurredAt), holdReason: null, updatedAt: new Date() }).where(and(eq(wpProduction.wpId, env.data.wpId), eq(wpProduction.operatorId, env.operatorId)));
    });
  }

  async shifts(p: Principal, station?: string) { await this.can(p,'read'); const q=this.db.db.select().from(maintenanceShifts).where(station?and(eq(maintenanceShifts.operatorId,p.operatorId),eq(maintenanceShifts.station,station)):eq(maintenanceShifts.operatorId,p.operatorId)); return q.orderBy(desc(maintenanceShifts.startsAt)); }
  async createShift(p: Principal, b: z.infer<typeof shiftSchema>) { await this.can(p,'manage'); const s=new Date(b.startsAt),e=new Date(b.endsAt); if(e<=s) throw new DomainError('SHIFT_WINDOW','Shift end must be after start',422); const id=randomUUID(); await this.db.transaction(async()=>{await this.db.db.insert(maintenanceShifts).values({id,operatorId:p.operatorId,station:b.station.toUpperCase(),name:b.name,startsAt:s,endsAt:e,capacity:b.capacity,createdBy:actorOf(p)}); await this.audit.record(this.db,'amo',{operatorId:p.operatorId,actor:actorOf(p),action:'maintenance.shift_created',entityType:'maintenance_shift',entityId:id,data:b});}); return {id}; }

  async detail(p: Principal, wpId: string) {
    await this.can(p,'read',wpId);
    const [prod]=await this.db.db.select().from(wpProduction).where(and(eq(wpProduction.wpId,wpId),eq(wpProduction.operatorId,p.operatorId)));
    if(!prod) throw new DomainError('PRODUCTION_NOT_FOUND',`No released production package ${wpId}`,404);
    const [cards, milestones, nrs, labour, shifts, allocations] = await Promise.all([
      this.db.db.select().from(taskCards).where(and(eq(taskCards.operatorId,p.operatorId),eq(taskCards.sourceType,'WP'),like(taskCards.sourceId,`${wpId}/%`))).orderBy(asc(taskCards.createdAt)),
      this.db.db.select().from(wpMilestones).where(and(eq(wpMilestones.operatorId,p.operatorId),eq(wpMilestones.wpId,wpId))).orderBy(asc(wpMilestones.plannedAt)),
      this.db.db.select().from(nonRoutines).where(and(eq(nonRoutines.operatorId,p.operatorId),eq(nonRoutines.wpId,wpId))).orderBy(desc(nonRoutines.createdAt)),
      this.db.db.select().from(labourEntries).where(and(eq(labourEntries.operatorId,p.operatorId),eq(labourEntries.wpId,wpId))).orderBy(desc(labourEntries.startedAt)),
      this.db.db.select().from(maintenanceShifts).where(and(eq(maintenanceShifts.operatorId,p.operatorId),eq(maintenanceShifts.station,prod.station), sql`${maintenanceShifts.startsAt} < coalesce(${prod.plannedEnd}, now()+interval '7 days')`, sql`${maintenanceShifts.endsAt} > coalesce(${prod.plannedStart}, now()-interval '1 day')`)).orderBy(asc(maintenanceShifts.startsAt)),
      this.db.db.select().from(wpShiftAllocations).where(and(eq(wpShiftAllocations.operatorId,p.operatorId),eq(wpShiftAllocations.wpId,wpId))).orderBy(asc(wpShiftAllocations.shiftId))
    ]);
    const cardIds=cards.map(c=>c.id); const rs=cardIds.length?await this.db.db.select().from(reservations).where(and(eq(reservations.operatorId,p.operatorId),inArray(reservations.taskCardId,cardIds))):[];
    const toolRows=await this.db.db.select().from(tools).where(eq(tools.operatorId,p.operatorId)); const toolMap=new Map(toolRows.map(t=>[t.id,t]));
    const plan=prod.taskPlan??[];const planBy=new Map(plan.map(x=>[x.requirementId,x]));const memo=new Map<string,{hours:number,path:string[]}>();const visit=(id:string,stack=new Set<string>()):{hours:number;path:string[]}=>{const hit=memo.get(id);if(hit)return hit;const n=planBy.get(id);if(!n||stack.has(id))return{hours:0,path:[]};const next=new Set(stack);next.add(id);let prior:{hours:number;path:string[]}={hours:0,path:[]};for(const p of n.predecessors??[]){const x=visit(p,next);if(x.hours>prior.hours)prior=x;}const out={hours:prior.hours+Number(n.estimatedHours||0),path:[...prior.path,id]};memo.set(id,out);return out;};let critical={hours:0,path:[] as string[]};for(const x of plan){const v=visit(x.requirementId);if(v.hours>critical.hours)critical=v;}const criticalSet=new Set(critical.path);
    const cardSummary=cards.map(c=>{const rq=c.requirements as {tools:string[];parts:{partNo:string;qty:number}[];predecessors?:string[]};const held=rs.filter(r=>r.taskCardId===c.id);const partsReady=!held.some(r=>r.status==='SHORT'); const now=Date.now(); const toolsReady=(rq.tools??[]).every(id=>{const t=toolMap.get(id);return !!t&&(!t.calibrationDue||Date.parse(`${t.calibrationDue}T00:00:00Z`)>now)});const requirementId=c.sourceId.split('/')[1]; return {id:c.id,title:c.title,trade:c.trade,status:c.status,sourceId:c.sourceId,requirementId,critical:criticalSet.has(requirementId),partsReady,toolsReady,predecessors:rq.predecessors??[]};});
    const certified=new Set(cardSummary.filter(c=>c.status==='CERTIFIED').map(c=>c.requirementId));
    const readyNow=cardSummary.filter(c=>c.status!=='CERTIFIED'&&c.partsReady&&c.toolsReady&&c.predecessors.every(x=>certified.has(x))).map(c=>c.id);
    const actualMinutes=labour.reduce((n,x)=>n+x.minutes,0)+nrs.reduce((n,x)=>n+x.actualMinutes,0);
    const plannedCapacity=allocations.reduce((n,x)=>n+Number(x.hours||0),0);
    return { production: prod, milestones, nonRoutines:nrs, labour, shifts, allocations, criticalPath:{hours:Math.round(critical.hours*10)/10,requirementIds:critical.path}, cards:cardSummary, readyNow, metrics:{cards:cards.length,certified:cardSummary.filter(c=>c.status==='CERTIFIED').length,openNonRoutines:nrs.filter(n=>!['CLOSED','CANCELLED'].includes(n.status)).length,actualHours:Math.round(actualMinutes/6)/10,plannedShiftHours:Math.round(plannedCapacity*10)/10} };
  }

  async allocateShift(p:Principal,wpId:string,b:z.infer<typeof allocationSchema>){await this.can(p,'manage',wpId);return this.db.transaction(async()=>{const [prod]=await this.db.db.select().from(wpProduction).where(and(eq(wpProduction.wpId,wpId),eq(wpProduction.operatorId,p.operatorId))).for('update');if(!prod)throw new DomainError('PRODUCTION_NOT_FOUND',wpId,404);if(!['READY','HOLD'].includes(prod.status))throw new DomainError('PRODUCTION_STATE','Shift allocations can be changed only before start or while on hold',409);const [shift]=await this.db.db.select().from(maintenanceShifts).where(and(eq(maintenanceShifts.id,b.shiftId),eq(maintenanceShifts.operatorId,p.operatorId))).for('update');if(!shift||shift.station!==prod.station)throw new DomainError('SHIFT_SCOPE','Shift does not belong to the work-package station',422);if(prod.plannedStart&&shift.endsAt<=prod.plannedStart||prod.plannedEnd&&shift.startsAt>=prod.plannedEnd)throw new DomainError('SHIFT_WINDOW','Shift does not overlap the planned work-package slot',422);const cap=Number(shift.capacity.find(x=>x.trade===b.trade)?.hours??0);if(cap<=0&&b.hours>0)throw new DomainError('SHIFT_TRADE',`${b.trade} has no capacity in this shift`,422);const others=await this.db.db.select().from(wpShiftAllocations).where(and(eq(wpShiftAllocations.operatorId,p.operatorId),eq(wpShiftAllocations.shiftId,b.shiftId),eq(wpShiftAllocations.trade,b.trade),sql`${wpShiftAllocations.wpId} <> ${wpId}`));const used=others.reduce((n,x)=>n+Number(x.hours),0);if(b.hours>cap-used+1e-9)throw new DomainError('SHIFT_CAPACITY',`${b.trade} allocation ${b.hours}h exceeds ${Math.max(0,cap-used)}h remaining`,409);if(b.hours===0)await this.db.db.delete(wpShiftAllocations).where(and(eq(wpShiftAllocations.wpId,wpId),eq(wpShiftAllocations.shiftId,b.shiftId),eq(wpShiftAllocations.trade,b.trade)));else await this.db.db.insert(wpShiftAllocations).values({operatorId:p.operatorId,wpId,shiftId:b.shiftId,trade:b.trade,hours:b.hours,allocatedBy:actorOf(p)}).onConflictDoUpdate({target:[wpShiftAllocations.wpId,wpShiftAllocations.shiftId,wpShiftAllocations.trade],set:{hours:b.hours,allocatedBy:actorOf(p),allocatedAt:new Date()}});await this.audit.record(this.db,'amo',{operatorId:p.operatorId,actor:actorOf(p),action:'production.shift_allocated',entityType:'work_package',entityId:wpId,data:b});return this.detail(p,wpId)})}

  async state(p: Principal, wpId: string, b: z.infer<typeof stateSchema>) { await this.can(p,'manage',wpId); return this.db.transaction(async()=>{const [r]=await this.db.db.select().from(wpProduction).where(and(eq(wpProduction.wpId,wpId),eq(wpProduction.operatorId,p.operatorId))).for('update'); if(!r)throw new DomainError('PRODUCTION_NOT_FOUND',wpId,404); let patch:any={updatedAt:new Date()}; if(b.state==='START'){if(r.status!=='READY')throw new DomainError('PRODUCTION_STATE',`${wpId} is ${r.status}`,409);const alloc=await this.db.db.select().from(wpShiftAllocations).where(and(eq(wpShiftAllocations.operatorId,p.operatorId),eq(wpShiftAllocations.wpId,wpId)));const by=new Map<string,number>();for(const a of alloc)by.set(a.trade,(by.get(a.trade)??0)+Number(a.hours));const short=(r.plannedHours??[]).filter(x=>(by.get(x.trade)??0)+1e-9<x.hours);if(short.length)throw new DomainError('PRODUCTION_LABOUR',`Allocate shift capacity before start: ${short.map(x=>`${x.trade} ${by.get(x.trade)??0}/${x.hours}h`).join(', ')}`,409);patch={...patch,status:'IN_PROGRESS',actualStart:new Date(),holdReason:null};} if(b.state==='HOLD'){if(r.status!=='IN_PROGRESS'||!b.reason)throw new DomainError('PRODUCTION_STATE','An in-progress package and hold reason are required',409);patch={...patch,status:'HOLD',holdReason:b.reason};} if(b.state==='RESUME'){if(r.status!=='HOLD')throw new DomainError('PRODUCTION_STATE',`${wpId} is not on hold`,409);patch={...patch,status:'IN_PROGRESS',holdReason:null};} await this.db.db.update(wpProduction).set(patch).where(eq(wpProduction.wpId,wpId)); await this.audit.record(this.db,'amo',{operatorId:p.operatorId,actor:actorOf(p),action:`production.${b.state.toLowerCase()}`,entityType:'work_package',entityId:wpId,data:{reason:b.reason??null}}); return this.detail(p,wpId);}); }

  async milestone(p: Principal, wpId:string, code:string){await this.can(p,'manage',wpId);return this.db.transaction(async()=>{const [m]=await this.db.db.select().from(wpMilestones).where(and(eq(wpMilestones.operatorId,p.operatorId),eq(wpMilestones.wpId,wpId),eq(wpMilestones.code,code))).for('update');if(!m)throw new DomainError('MILESTONE_NOT_FOUND',code,404);if(m.status==='COMPLETE')return this.detail(p,wpId);await this.db.db.update(wpMilestones).set({status:'COMPLETE',actualAt:new Date(),completedBy:actorOf(p)}).where(eq(wpMilestones.id,m.id));await this.audit.record(this.db,'amo',{operatorId:p.operatorId,actor:actorOf(p),action:'production.milestone_completed',entityType:'work_package',entityId:wpId,data:{code}});return this.detail(p,wpId);});}
  async raiseNr(p:Principal,wpId:string,b:z.infer<typeof nrSchema>){await this.can(p,'manage',wpId);const [prod]=await this.db.db.select().from(wpProduction).where(and(eq(wpProduction.wpId,wpId),eq(wpProduction.operatorId,p.operatorId)));if(!prod)throw new DomainError('PRODUCTION_NOT_FOUND',wpId,404);if(b.taskCardId){const [c]=await this.db.db.select().from(taskCards).where(and(eq(taskCards.id,b.taskCardId),eq(taskCards.operatorId,p.operatorId),like(taskCards.sourceId,`${wpId}/%`)));if(!c)throw new DomainError('TASK_CARD_SCOPE','Task card does not belong to this work package',422);}const id=await this.next('non_routine_seq','NR');await this.db.transaction(async()=>{await this.db.db.insert(nonRoutines).values({id,operatorId:p.operatorId,wpId,taskCardId:b.taskCardId,title:b.title,description:b.description,ata:b.ata,trade:b.trade,estimatedHours:b.estimatedHours,actualMinutes:0,status:'OPEN',createdBy:actorOf(p),createdAt:new Date()});await this.audit.record(this.db,'amo',{operatorId:p.operatorId,actor:actorOf(p),action:'production.non_routine_raised',entityType:'non_routine',entityId:id,data:{wpId,...b}});});return this.detail(p,wpId);}
  async nrState(p:Principal,wpId:string,id:string,b:z.infer<typeof nrStateSchema>){await this.can(p,'manage',wpId);return this.db.transaction(async()=>{const [r]=await this.db.db.select().from(nonRoutines).where(and(eq(nonRoutines.id,id),eq(nonRoutines.operatorId,p.operatorId),eq(nonRoutines.wpId,wpId))).for('update');if(!r)throw new DomainError('NON_ROUTINE_NOT_FOUND',id,404);const allowed:Record<string,string[]>={OPEN:['IN_WORK','CANCELLED'],IN_WORK:['CLOSED','CANCELLED'],CLOSED:[],CANCELLED:[]};if(!allowed[r.status]?.includes(b.state))throw new DomainError('NON_ROUTINE_STATE',`${id} cannot move ${r.status} → ${b.state}`,409);if(['CLOSED','CANCELLED'].includes(b.state)&&!b.disposition)throw new DomainError('NON_ROUTINE_DISPOSITION',`${b.state==='CLOSED'?'Closure':'Cancellation'} requires a disposition`,422);await this.db.db.update(nonRoutines).set({status:b.state,disposition:b.disposition??r.disposition,closedBy:['CLOSED','CANCELLED'].includes(b.state)?actorOf(p):null,closedAt:['CLOSED','CANCELLED'].includes(b.state)?new Date():null}).where(eq(nonRoutines.id,id));await this.audit.record(this.db,'amo',{operatorId:p.operatorId,actor:actorOf(p),action:`production.non_routine_${b.state.toLowerCase()}`,entityType:'non_routine',entityId:id,data:{wpId,disposition:b.disposition??null}});return this.detail(p,wpId);});}
  async labour(p:Principal,wpId:string,b:z.infer<typeof labourSchema>){await this.can(p,'manage',wpId);if((!!b.taskCardId)===(!!b.nonRoutineId))throw new DomainError('LABOUR_SOURCE','Record labour against exactly one task card or non-routine',422);const s=new Date(b.startedAt),e=new Date(b.endedAt);const mins=Math.round((e.getTime()-s.getTime())/60000);if(mins<=0||mins>24*60)throw new DomainError('LABOUR_WINDOW','Labour entry must be greater than 0 and no more than 24 hours',422);if(b.taskCardId){const [c]=await this.db.db.select().from(taskCards).where(and(eq(taskCards.id,b.taskCardId),eq(taskCards.operatorId,p.operatorId),like(taskCards.sourceId,`${wpId}/%`)));if(!c)throw new DomainError('TASK_CARD_SCOPE','Task card does not belong to this work package',422);}if(b.nonRoutineId){const [nr]=await this.db.db.select().from(nonRoutines).where(and(eq(nonRoutines.id,b.nonRoutineId),eq(nonRoutines.operatorId,p.operatorId),eq(nonRoutines.wpId,wpId)));if(!nr)throw new DomainError('NON_ROUTINE_SCOPE','Non-routine does not belong to this work package',422);}await this.db.transaction(async()=>{await this.db.db.insert(labourEntries).values({operatorId:p.operatorId,wpId,taskCardId:b.taskCardId,nonRoutineId:b.nonRoutineId,personnelId:b.personnelId,trade:b.trade,startedAt:s,endedAt:e,minutes:mins,note:b.note,createdBy:actorOf(p)});if(b.nonRoutineId)await this.db.db.update(nonRoutines).set({actualMinutes:sql`${nonRoutines.actualMinutes}+${mins}`}).where(eq(nonRoutines.id,b.nonRoutineId));await this.audit.record(this.db,'amo',{operatorId:p.operatorId,actor:actorOf(p),action:'production.labour_recorded',entityType:'work_package',entityId:wpId,data:{...b,minutes:mins}});});return this.detail(p,wpId);}
}

@Controller('amo/production')
export class ProductionControlController {
  constructor(private readonly s:ProductionControlService){}
  @Get('shifts') shifts(@CurrentPrincipal()p:Principal,@Query('station')station?:string){return this.s.shifts(p,station?.toUpperCase())}
  @Post('shifts') shift(@CurrentPrincipal()p:Principal,@Body(new ZodPipe(shiftSchema))b:z.infer<typeof shiftSchema>){return this.s.createShift(p,b)}
  @Get('work-packages/:id') detail(@CurrentPrincipal()p:Principal,@Param('id')id:string){return this.s.detail(p,id)}
  @Post('work-packages/:id/shifts') allocate(@CurrentPrincipal()p:Principal,@Param('id')id:string,@Body(new ZodPipe(allocationSchema))b:z.infer<typeof allocationSchema>){return this.s.allocateShift(p,id,b)}
  @Post('work-packages/:id/state') state(@CurrentPrincipal()p:Principal,@Param('id')id:string,@Body(new ZodPipe(stateSchema))b:z.infer<typeof stateSchema>){return this.s.state(p,id,b)}
  @Post('work-packages/:id/milestones/:code/complete') milestone(@CurrentPrincipal()p:Principal,@Param('id')id:string,@Param('code')code:string){return this.s.milestone(p,id,code)}
  @Post('work-packages/:id/non-routines') nr(@CurrentPrincipal()p:Principal,@Param('id')id:string,@Body(new ZodPipe(nrSchema))b:z.infer<typeof nrSchema>){return this.s.raiseNr(p,id,b)}
  @Post('work-packages/:id/non-routines/:nrId/state') nrState(@CurrentPrincipal()p:Principal,@Param('id')id:string,@Param('nrId')nrId:string,@Body(new ZodPipe(nrStateSchema))b:z.infer<typeof nrStateSchema>){return this.s.nrState(p,id,nrId,b)}
  @Post('work-packages/:id/labour') labour(@CurrentPrincipal()p:Principal,@Param('id')id:string,@Body(new ZodPipe(labourSchema))b:z.infer<typeof labourSchema>){return this.s.labour(p,id,b)}
}
