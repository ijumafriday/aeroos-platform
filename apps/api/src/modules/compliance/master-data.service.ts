import { Body, Controller, Get, Inject, Injectable, Param, Post } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { DomainError } from '@aeroos/kernel';
import type { MasterDataSetDto } from '@aeroos/contracts';
import { CurrentPrincipal, type Principal } from '../../platform/auth/principal';
import { AuthzService } from '../../platform/authz/authz.service';
import { AuditService } from '../../platform/audit/audit.service';
import { DB_TOKEN, type ModuleDb } from '../../platform/database/module-db';
import { ZodPipe } from '../../platform/http/http';
import { masterDataSets } from './compliance.tables';
import { LIVE_HASH_BOUND_KEYS, REGULATED_MASTER_DATA_KEYS } from './regulated-data.catalog';

const createSchema=z.object({key:z.string().min(3).max(100),domain:z.enum(['AIRWORTHINESS','ENGINEERING','OPERATIONS','CREW','COMPLIANCE']),title:z.string().min(3).max(180),sourceRef:z.string().min(3).max(500),contentSha256:z.string().regex(/^[0-9a-f]{64}$/),effectiveFrom:z.string().datetime({offset:true}).optional()});
const reasonSchema=z.object({reason:z.string().trim().min(5).max(500)});
const actor=(p:Principal)=>p.subject;
const dto=(r:any):MasterDataSetDto=>({id:r.id,key:r.key,domain:r.domain,title:r.title,sourceRef:r.sourceRef,contentSha256:r.contentSha256,status:r.status,revision:r.revision,createdBy:r.createdBy,createdAt:r.createdAt.toISOString(),validatedBy:r.validatedBy??null,validatedAt:r.validatedAt?.toISOString()??null,approvedBy:r.approvedBy??null,approvedAt:r.approvedAt?.toISOString()??null,effectiveFrom:r.effectiveFrom?.toISOString()??null,version:r.version});

@Injectable()
export class MasterDataService {
  constructor(@Inject(DB_TOKEN.compliance) private readonly db:ModuleDb, private readonly authz:AuthzService, private readonly audit:AuditService){}
  private res(operatorId:string,id='*'){return {kind:'master_data_governance' as const,id,attr:{operatorId}};}
  async list(p:Principal){await this.authz.check(p,this.res(p.operatorId),'read'); return (await this.db.db.select().from(masterDataSets).where(eq(masterDataSets.operatorId,p.operatorId)).orderBy(masterDataSets.key,desc(masterDataSets.revision))).map(dto);}
  async create(p:Principal,b:z.infer<typeof createSchema>){await this.authz.check(p,this.res(p.operatorId),'draft'); return this.db.transaction(async()=>{const [n]=await this.db.db.select({n:sql<number>`coalesce(max(${masterDataSets.revision}),0)::int+1`}).from(masterDataSets).where(and(eq(masterDataSets.operatorId,p.operatorId),eq(masterDataSets.key,b.key))); const id=randomUUID(); await this.db.db.insert(masterDataSets).values({id,operatorId:p.operatorId,key:b.key,domain:b.domain,title:b.title,sourceRef:b.sourceRef,contentSha256:b.contentSha256,status:'DRAFT',revision:n?.n??1,createdBy:actor(p),createdAt:new Date(),effectiveFrom:b.effectiveFrom?new Date(b.effectiveFrom):null,metadata:{},version:1} as any); await this.audit.record(this.db,'compliance',{operatorId:p.operatorId,actor:actor(p),action:'master_data.drafted',entityType:'master_data_set',entityId:id,data:{key:b.key,revision:n?.n??1,sourceRef:b.sourceRef,contentSha256:b.contentSha256}}); return this.getRow(p.operatorId,id);});}
  async validate(p:Principal,id:string){await this.authz.check(p,this.res(p.operatorId,id),'validate'); return this.transition(p,id,'DRAFT','VALIDATED','validatedBy','validatedAt','master_data.validated');}
  async approve(p:Principal,id:string){await this.authz.check(p,this.res(p.operatorId,id),'approve'); return this.transition(p,id,'VALIDATED','APPROVED','approvedBy','approvedAt','master_data.approved');}
  async activate(p:Principal,id:string){await this.authz.check(p,this.res(p.operatorId,id),'activate'); return this.db.transaction(async()=>{const r=await this.getRow(p.operatorId,id,true); if(r.status!=='APPROVED') throw new DomainError('MASTER_DATA_STATE','Only an approved revision can become effective',409); if(r.createdBy===actor(p)||r.approvedBy===actor(p)) throw new DomainError('FOUR_EYES','The author or approver cannot activate the same master-data revision',409); await this.assertLiveHash(p.operatorId,r.key,r.contentSha256); const now=new Date(); if(r.effectiveFrom&&new Date(r.effectiveFrom)>now) throw new DomainError('EFFECTIVITY','The configured effective date is still in the future',409); await this.db.db.update(masterDataSets).set({status:'SUPERSEDED',supersededBy:id,version:sql`${masterDataSets.version}+1`} as any).where(and(eq(masterDataSets.operatorId,p.operatorId),eq(masterDataSets.key,r.key),eq(masterDataSets.status,'EFFECTIVE'))); await this.db.db.update(masterDataSets).set({status:'EFFECTIVE',effectiveFrom:r.effectiveFrom??now,version:sql`${masterDataSets.version}+1`} as any).where(and(eq(masterDataSets.operatorId,p.operatorId),eq(masterDataSets.id,id))); await this.audit.record(this.db,'compliance',{operatorId:p.operatorId,actor:actor(p),action:'master_data.effective',entityType:'master_data_set',entityId:id,data:{key:r.key,revision:r.revision,sha256:r.contentSha256}}); return this.getRow(p.operatorId,id);});}
  async withdraw(p:Principal,id:string,reason:string){await this.authz.check(p,this.res(p.operatorId,id),'withdraw'); return this.db.transaction(async()=>{const r=await this.getRow(p.operatorId,id,true); if(!['APPROVED','EFFECTIVE'].includes(r.status)) throw new DomainError('MASTER_DATA_STATE','Only approved/effective data can be withdrawn',409); await this.db.db.update(masterDataSets).set({status:'WITHDRAWN',withdrawalReason:reason,version:sql`${masterDataSets.version}+1`} as any).where(eq(masterDataSets.id,id)); await this.audit.record(this.db,'compliance',{operatorId:p.operatorId,actor:actor(p),action:'master_data.withdrawn',entityType:'master_data_set',entityId:id,data:{key:r.key,revision:r.revision,reason}}); return this.getRow(p.operatorId,id);});}
  private async liveHash(operatorId:string,key:string):Promise<string|null>{
    const r=await this.db.db.execute<{sha:string|null}>(sql`select compliance.current_regulated_dataset_sha256(${operatorId},${key}) as sha`);
    return r.rows?.[0]?.sha??null;
  }
  private async assertLiveHash(operatorId:string,key:string,approvedSha:string){
    if(!LIVE_HASH_BOUND_KEYS.has(key as any)) return;
    const live=await this.liveHash(operatorId,key);
    if(!live) throw new DomainError('REGULATED_DATASET_UNBOUND',`No live dataset hash function is defined for ${key}`,503);
    if(live!==approvedSha) throw new DomainError('REGULATED_DATASET_DRIFT',`${key} changed after approval; expected ${approvedSha}, live ${live}`,503);
  }
  async assertEffective(operatorId:string,keys:string[]){const rows=await this.db.db.select({key:masterDataSets.key,sha:masterDataSets.contentSha256}).from(masterDataSets).where(and(eq(masterDataSets.operatorId,operatorId),eq(masterDataSets.status,'EFFECTIVE'))); const byKey=new Map(rows.map(r=>[r.key,r.sha])); const missing=keys.filter(k=>!byKey.has(k)); if(missing.length) throw new DomainError('UNAPPROVED_MASTER_DATA',`Approved/effective master data required: ${missing.join(', ')}`,503); for(const key of keys) await this.assertLiveHash(operatorId,key,byKey.get(key)!);}
  async readiness(operatorId:string){const rows=await this.db.db.select().from(masterDataSets).where(eq(masterDataSets.operatorId,operatorId)); const required=[] as {key:string,effective:boolean,integrity:boolean}[]; for(const key of REGULATED_MASTER_DATA_KEYS){const r=rows.find(x=>x.key===key&&x.status==='EFFECTIVE'); let integrity=!!r; if(r&&LIVE_HASH_BOUND_KEYS.has(key as any)){try{integrity=(await this.liveHash(operatorId,key))===r.contentSha256}catch{integrity=false}} required.push({key,effective:!!r,integrity});} return {ready:required.every(x=>x.effective&&x.integrity),required};}
  private async transition(p:Principal,id:string,from:string,to:string,by:string,at:string,action:string){return this.db.transaction(async()=>{const r=await this.getRow(p.operatorId,id,true); if(r.status!==from) throw new DomainError('MASTER_DATA_STATE',`Expected ${from}, found ${r.status}`,409); if(r.createdBy===actor(p)) throw new DomainError('FOUR_EYES','The author cannot validate or approve the same master-data revision',409); if(to==='APPROVED' && r.validatedBy===actor(p)) throw new DomainError('FOUR_EYES','The validator cannot approve the same master-data revision',409); await this.db.db.update(masterDataSets).set({status:to,[by]:actor(p),[at]:new Date(),version:sql`${masterDataSets.version}+1`} as any).where(eq(masterDataSets.id,id)); await this.audit.record(this.db,'compliance',{operatorId:p.operatorId,actor:actor(p),action,entityType:'master_data_set',entityId:id,data:{key:r.key,revision:r.revision}}); return this.getRow(p.operatorId,id);});}
  private async getRow(operatorId:string,id:string,lock=false):Promise<any>{if(lock) await this.db.db.execute(sql`select id from compliance.master_data_sets where id=${id} and operator_id=${operatorId} for update`); const q=this.db.db.select().from(masterDataSets).where(and(eq(masterDataSets.operatorId,operatorId),eq(masterDataSets.id,id))).limit(1); const [r]=await q; if(!r) throw new DomainError('MASTER_DATA_NOT_FOUND','Master-data revision not found',404); return r;}
}


@Controller('compliance/master-data')
export class MasterDataController {
 constructor(private readonly s:MasterDataService){}
 @Get() list(@CurrentPrincipal() p:Principal){return this.s.list(p)}
 @Get('readiness') ready(@CurrentPrincipal() p:Principal){return this.s.readiness(p.operatorId)}
 @Post() create(@CurrentPrincipal() p:Principal,@Body(new ZodPipe(createSchema)) b:z.infer<typeof createSchema>){return this.s.create(p,b)}
 @Post(':id/validate') validate(@CurrentPrincipal() p:Principal,@Param('id') id:string){return this.s.validate(p,id)}
 @Post(':id/approve') approve(@CurrentPrincipal() p:Principal,@Param('id') id:string){return this.s.approve(p,id)}
 @Post(':id/activate') activate(@CurrentPrincipal() p:Principal,@Param('id') id:string){return this.s.activate(p,id)}
 @Post(':id/withdraw') withdraw(@CurrentPrincipal() p:Principal,@Param('id') id:string,@Body(new ZodPipe(reasonSchema)) b:z.infer<typeof reasonSchema>){return this.s.withdraw(p,id,b.reason)}
}
