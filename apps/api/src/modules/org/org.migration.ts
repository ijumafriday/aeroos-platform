import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { AuditService } from '../../platform/audit/audit.service';
import { DB_TOKEN, type ModuleDb } from '../../platform/database/module-db';
import { MigrationRegistry, type MigrationAdapter, type MigrationApplyContext, type MigrationStrategy } from '../../platform/migrations/migration.service';
import { personnel } from './org.tables';

const text = (v: unknown) => typeof v === 'string' ? v.trim() : '';
const bool = (v: unknown) => typeof v === 'boolean' ? v : ['true','1','yes','y'].includes(text(v).toLowerCase());

@Injectable()
export class OrgPersonnelMigration implements OnModuleInit, MigrationAdapter {
  readonly target = 'org.personnel';
  readonly columns = [
    { name:'id',required:true,description:'Stable personnel identifier' }, { name:'username',required:true,description:'Identity-provider username' },
    { name:'name',required:true,description:'Display/legal name' }, { name:'licenceNo',required:false,description:'Licence number' },
    { name:'active',required:true,description:'true/false' }, { name:'roleTitle',required:false,description:'Role/title' }, { name:'base',required:false,description:'ICAO/base code' }
  ];
  constructor(@Inject(DB_TOKEN.org) private readonly db: ModuleDb, private readonly registry: MigrationRegistry, private readonly audit: AuditService) {}
  onModuleInit(){ this.registry.register(this); }
  key(row:Record<string,unknown>){ return String(row.id ?? ''); }
  async validate(row:Record<string,unknown>, operatorId:string, strategy:MigrationStrategy){
    if(row.active === undefined || row.active === null || text(row.active)==='') return {ok:false as const,error:'active is required'};
    const n={ id:text(row.id).toUpperCase(), username:text(row.username), name:text(row.name), licenceNo:text(row.licenceNo)||null, active:bool(row.active), roleTitle:text(row.roleTitle)||null, base:text(row.base).toUpperCase()||null };
    if(!/^[A-Z0-9][A-Z0-9._-]{1,39}$/.test(n.id)) return {ok:false as const,error:'id must be 2-40 letters/digits/._-'};
    if(n.username.length<2||n.username.length>80) return {ok:false as const,error:'username must be 2-80 characters'};
    if(n.name.length<2||n.name.length>160) return {ok:false as const,error:'name must be 2-160 characters'};
    if(n.base && !/^[A-Z]{3,4}$/.test(n.base)) return {ok:false as const,error:'base must be a 3-4 letter station code'};
    const existing=await this.db.db.select({id:personnel.id}).from(personnel).where(and(eq(personnel.operatorId,operatorId),eq(personnel.id,n.id))).limit(1);
    if(existing[0]&&strategy==='INSERT_ONLY') return {ok:false as const,error:`personnel ${n.id} already exists`};
    return {ok:true as const,normalized:n};
  }
  async apply(row:Record<string,unknown>,ctx:MigrationApplyContext){
    return this.db.transaction(async()=>{
      const n=row as any; const existing=await this.db.db.select({id:personnel.id}).from(personnel).where(and(eq(personnel.operatorId,ctx.operatorId),eq(personnel.id,n.id))).limit(1);
      if(existing[0]&&ctx.strategy==='INSERT_ONLY') return 'SKIPPED' as const;
      if(existing[0]) await this.db.db.update(personnel).set({username:n.username,name:n.name,licenceNo:n.licenceNo,active:n.active,roleTitle:n.roleTitle,base:n.base}).where(and(eq(personnel.operatorId,ctx.operatorId),eq(personnel.id,n.id)));
      else await this.db.db.insert(personnel).values({...n,operatorId:ctx.operatorId});
      await this.audit.record(this.db,'org',{operatorId:ctx.operatorId,actor:ctx.actor,action:existing[0]?'migration.personnel.updated':'migration.personnel.created',entityType:'personnel',entityId:n.id,data:{jobId:ctx.jobId,rowNo:ctx.rowNo},rule:'PLATFORM-MIGRATION-01'});
      return 'APPLIED' as const;
    });
  }
}
