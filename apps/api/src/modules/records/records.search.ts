import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { and, eq, ilike, or } from 'drizzle-orm';
import type { SearchResultDto } from '@aeroos/contracts';
import type { Principal } from '../../platform/auth/principal';
import { AuthzService } from '../../platform/authz/authz.service';
import { DB_TOKEN, type ModuleDb } from '../../platform/database/module-db';
import { likePattern, SearchRegistry } from '../../platform/search/search.registry';
import { binders } from './records.service';
import { ingestItems, leaseProjects, profiles } from './records-control.service';

@Injectable()
export class RecordsSearch implements OnModuleInit {
  constructor(@Inject(DB_TOKEN.records) private readonly db: ModuleDb, private readonly registry: SearchRegistry, private readonly authz: AuthzService) {}
  onModuleInit(){ this.registry.register({ name:'records', search:(p,q,limit)=>this.search(p,q,limit) }); }
  private async search(p:Principal,q:string,limit:number):Promise<SearchResultDto[]> {
    const allowed=await this.authz.decide(p,{kind:'technical_record',id:'*',attr:{operatorId:p.operatorId}},['read']); if(!allowed.read) return [];
    const like=likePattern(q); const each=Math.max(2,Math.ceil(limit/3));
    const [bs,leases,docs]=await Promise.all([
      this.db.db.select().from(binders).where(and(eq(binders.operatorId,p.operatorId),or(ilike(binders.id,like),ilike(binders.subjectId,like),ilike(binders.title,like),ilike(binders.subjectType,like),ilike(binders.recordClass,like)))).limit(each),
      this.db.db.select().from(leaseProjects).where(and(eq(leaseProjects.operatorId,p.operatorId),or(ilike(leaseProjects.id,like),ilike(leaseProjects.aircraftId,like),ilike(leaseProjects.lessor,like),ilike(leaseProjects.leaseRef,like)))).limit(each),
      this.db.db.select({itemId:ingestItems.id,documentId:ingestItems.documentId,recordClass:profiles.recordClass,subjectType:profiles.subjectType,subjectId:profiles.subjectId,documentNumber:profiles.documentNumber,recordDate:profiles.recordDate}).from(profiles).innerJoin(ingestItems,eq(ingestItems.id,profiles.ingestItemId)).where(and(eq(profiles.operatorId,p.operatorId),eq(profiles.reviewStatus,'ACCEPTED'),or(ilike(profiles.recordClass,like),ilike(profiles.subjectId,like),ilike(profiles.documentNumber,like)))).limit(each)
    ]);
    return [
      ...bs.map(r=>({type:'Technical record',id:r.id,title:`${r.id} · ${r.title}`,subtitle:`${r.subjectType} ${r.subjectId} · ${r.status}`,link:`/records?tab=binders&record=${encodeURIComponent(r.id)}`,domain:'records'})),
      ...leases.map(r=>({type:'Lease records',id:r.id,title:`${r.aircraftId} · ${r.lessor}`,subtitle:`${r.leaseRef} · ${r.status}`,link:`/records?tab=lease&lease=${encodeURIComponent(r.id)}`,domain:'records'})),
      ...docs.map(r=>({type:'Historical record',id:String(r.itemId),title:`${r.documentNumber??r.documentId}`,subtitle:`${r.recordClass??'UNCLASSIFIED'} · ${r.subjectType??''} ${r.subjectId??''} · ${r.recordDate??''}`,link:'/records?tab=intake',domain:'records'}))
    ].slice(0,limit) as SearchResultDto[];
  }
}
