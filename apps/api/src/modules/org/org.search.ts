import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { and, eq, ilike, or } from 'drizzle-orm';
import type { SearchResultDto } from '@aeroos/contracts';
import type { Principal } from '../../platform/auth/principal';
import { AuthzService } from '../../platform/authz/authz.service';
import { DB_TOKEN, type ModuleDb } from '../../platform/database/module-db';
import { likePattern, SearchRegistry } from '../../platform/search/search.registry';
import { controlledDocuments, findings, occurrences, personnel, qualityAudits } from './org.tables';

@Injectable()
export class OrgSearch implements OnModuleInit {
  constructor(@Inject(DB_TOKEN.org) private readonly db: ModuleDb, private readonly registry: SearchRegistry, private readonly authz: AuthzService) {}
  onModuleInit() { this.registry.register({ name: 'org', search: (p, q, limit) => this.search(p, q, limit) }); }
  private async search(p: Principal, q: string, limit: number): Promise<SearchResultDto[]> {
    const like = likePattern(q); const out:SearchResultDto[]=[];
    const [people,docs,safety,quality]=await Promise.all([
      this.authz.decide(p,{kind:'personnel',id:'*',attr:{operatorId:p.operatorId,username:''}},['list']),
      this.authz.decide(p,{kind:'controlled_document',id:'*',attr:{operatorId:p.operatorId}},['read']),
      this.authz.decide(p,{kind:'occurrence',id:'*',attr:{operatorId:p.operatorId,confidential:false,reportedBy:p.username}},['read']),
      this.authz.decide(p,{kind:'quality_audit',id:'*',attr:{operatorId:p.operatorId}},['read'])
    ]);
    if(people.list){const rows=await this.db.db.select().from(personnel).where(and(eq(personnel.operatorId,p.operatorId),or(ilike(personnel.name,like),ilike(personnel.username,like),ilike(personnel.licenceNo,like),ilike(personnel.id,like)))).limit(limit); out.push(...rows.map(r=>({type:'Person',id:r.id,title:r.name,subtitle:`${r.roleTitle??r.username}${r.licenceNo?` · ${r.licenceNo}`:''}`,link:`/org/personnel?person=${encodeURIComponent(r.id)}`,domain:'org'})));}
    if(docs.read){const rows=await this.db.db.select().from(controlledDocuments).where(and(eq(controlledDocuments.operatorId,p.operatorId),or(ilike(controlledDocuments.code,like),ilike(controlledDocuments.title,like),ilike(controlledDocuments.category,like)))).limit(limit); out.push(...rows.map(r=>({type:'Controlled document',id:r.id,title:`${r.code} · ${r.title}`,subtitle:r.category,link:`/org/documents?doc=${encodeURIComponent(r.id)}`,domain:'org'})));}
    if(safety.read){const rows=await this.db.db.select().from(occurrences).where(and(eq(occurrences.operatorId,p.operatorId),eq(occurrences.confidential,false),or(ilike(occurrences.id,like),ilike(occurrences.title,like),ilike(occurrences.flightNo,like),ilike(occurrences.tail,like)))).limit(limit); out.push(...rows.map(r=>({type:'Safety report',id:r.id,title:`${r.id} · ${r.title}`,subtitle:`${r.category} · ${r.status}`,link:`/safety/reports?report=${encodeURIComponent(r.id)}`,domain:'safety'})));}
    if(quality.read){const [audits,fs]=await Promise.all([this.db.db.select().from(qualityAudits).where(and(eq(qualityAudits.operatorId,p.operatorId),or(ilike(qualityAudits.id,like),ilike(qualityAudits.title,like),ilike(qualityAudits.reference,like),ilike(qualityAudits.area,like)))).limit(limit),this.db.db.select().from(findings).where(and(eq(findings.operatorId,p.operatorId),or(ilike(findings.id,like),ilike(findings.requirement,like),ilike(findings.description,like)))).limit(limit)]); out.push(...audits.map(r=>({type:'Quality audit',id:r.id,title:`${r.id} · ${r.title}`,subtitle:`${r.area} · ${r.status}`,link:`/quality/audits?audit=${encodeURIComponent(r.id)}`,domain:'quality'}))); out.push(...fs.map(r=>({type:'Quality finding',id:r.id,title:`${r.id} · ${r.requirement}`,subtitle:`${r.level} · ${r.status}`,link:'/quality/audits?view=tracker',domain:'quality'})));}
    return out.slice(0,limit*4);
  }
}
