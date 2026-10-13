import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { AuditService } from '../../platform/audit/audit.service';
import { DB_TOKEN, type ModuleDb } from '../../platform/database/module-db';
import { MigrationRegistry, type MigrationAdapter, type MigrationApplyContext, type MigrationStrategy } from '../../platform/migrations/migration.service';
import { fleet } from './camo.tables';
const text=(v:unknown)=>typeof v==='string'?v.trim():'';
@Injectable()
export class CamoFleetMigration implements OnModuleInit, MigrationAdapter {
 readonly target='camo.fleet'; readonly columns=[
  {name:'reg',required:true,description:'Aircraft registration'}, {name:'aircraftType',required:true,description:'Aircraft type/fleet code'}, {name:'msn',required:true,description:'Manufacturer serial number'}, {name:'status',required:true,description:'SVC, AOG or CHK'}
 ];
 constructor(@Inject(DB_TOKEN.camo) private readonly db:ModuleDb,private readonly registry:MigrationRegistry,private readonly audit:AuditService){}
 onModuleInit(){this.registry.register(this);}
 key(row:Record<string,unknown>){return String(row.reg ?? '');}
 async validate(row:Record<string,unknown>,operatorId:string,strategy:MigrationStrategy){
  const n={reg:text(row.reg).toUpperCase(),aircraftType:text(row.aircraftType).toUpperCase(),msn:text(row.msn),status:text(row.status).toUpperCase()};
  if(!/^[A-Z0-9-]{3,10}$/.test(n.reg)) return {ok:false as const,error:'reg must be 3-10 letters/digits/dashes'};
  if(n.aircraftType.length<2||n.aircraftType.length>40) return {ok:false as const,error:'aircraftType must be 2-40 characters'};
  if(!n.msn||n.msn.length>40) return {ok:false as const,error:'msn is required (max 40 characters)'};
  if(!['SVC','AOG','CHK'].includes(n.status)) return {ok:false as const,error:'status must be SVC, AOG or CHK'};
  const existing=await this.db.db.select({reg:fleet.reg}).from(fleet).where(and(eq(fleet.operatorId,operatorId),eq(fleet.reg,n.reg))).limit(1);
  if(existing[0]&&strategy==='INSERT_ONLY') return {ok:false as const,error:`aircraft ${n.reg} already exists`};
  return {ok:true as const,normalized:n};
 }
 async apply(row:Record<string,unknown>,ctx:MigrationApplyContext){return this.db.transaction(async()=>{
  const n=row as any; const existing=await this.db.db.select({reg:fleet.reg}).from(fleet).where(and(eq(fleet.operatorId,ctx.operatorId),eq(fleet.reg,n.reg))).limit(1);
  if(existing[0]&&ctx.strategy==='INSERT_ONLY') return 'SKIPPED' as const;
  if(existing[0]) await this.db.db.update(fleet).set({aircraftType:n.aircraftType,msn:n.msn,status:n.status}).where(and(eq(fleet.operatorId,ctx.operatorId),eq(fleet.reg,n.reg)));
  else await this.db.db.insert(fleet).values({...n,operatorId:ctx.operatorId});
  await this.audit.record(this.db,'camo',{operatorId:ctx.operatorId,actor:ctx.actor,action:existing[0]?'migration.aircraft.updated':'migration.aircraft.created',entityType:'aircraft',entityId:n.reg,data:{jobId:ctx.jobId,rowNo:ctx.rowNo},rule:'PLATFORM-MIGRATION-01'});
  return 'APPLIED' as const;
 });}
}
