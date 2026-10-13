import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { AuditService } from '../../platform/audit/audit.service';
import { DB_TOKEN, type ModuleDb } from '../../platform/database/module-db';
import { MigrationRegistry, type MigrationAdapter, type MigrationApplyContext, type MigrationStrategy } from '../../platform/migrations/migration.service';
import { crewMembers, flights } from './ops.tables';

const text=(v:unknown)=>typeof v==='string'?v.trim():'';
const list=(v:unknown)=>Array.isArray(v)?v.map(text).filter(Boolean):text(v).split(/[;,]/).map(x=>x.trim()).filter(Boolean);
const bool=(v:unknown)=>typeof v==='boolean'?v:['true','1','yes','y'].includes(text(v).toLowerCase());

@Injectable()
export class OpsCrewMigration implements OnModuleInit, MigrationAdapter {
  readonly target='ops.crew';
  readonly columns=[
    {name:'id',required:true,description:'Stable crew identifier'}, {name:'name',required:true,description:'Crew member name'},
    {name:'rank',required:true,description:'CPT, FO, SCCM or CC'}, {name:'base',required:true,description:'ICAO base'},
    {name:'qualifications',required:true,description:'Aircraft type ratings separated by comma/semicolon'}, {name:'active',required:true,description:'true/false'},
    {name:'username',required:false,description:'Identity-provider username'}
  ];
  constructor(@Inject(DB_TOKEN.ops) private readonly db:ModuleDb,private readonly registry:MigrationRegistry,private readonly audit:AuditService){}
  onModuleInit(){this.registry.register(this)}
  key(r:Record<string,unknown>){return text(r.id).toUpperCase()}
  async validate(r:Record<string,unknown>,operatorId:string,strategy:MigrationStrategy){
    const n={id:text(r.id).toUpperCase(),name:text(r.name),rank:text(r.rank).toUpperCase(),base:text(r.base).toUpperCase(),qualifications:list(r.qualifications).map(x=>x.toUpperCase()),active:bool(r.active),username:text(r.username)||null};
    if(!/^[A-Z0-9][A-Z0-9._-]{1,39}$/.test(n.id))return{ok:false as const,error:'id must be 2-40 letters/digits/._-'};
    if(n.name.length<2||n.name.length>160)return{ok:false as const,error:'name must be 2-160 characters'};
    if(!['CPT','FO','SCCM','CC'].includes(n.rank))return{ok:false as const,error:'rank must be CPT, FO, SCCM or CC'};
    if(!/^[A-Z]{4}$/.test(n.base))return{ok:false as const,error:'base must be a 4-letter ICAO code'};
    if(!n.qualifications.length)return{ok:false as const,error:'at least one aircraft qualification is required'};
    const ex=await this.db.db.select({id:crewMembers.id}).from(crewMembers).where(and(eq(crewMembers.operatorId,operatorId),eq(crewMembers.id,n.id))).limit(1);
    if(ex[0]&&strategy==='INSERT_ONLY')return{ok:false as const,error:`crew ${n.id} already exists`};
    return{ok:true as const,normalized:n};
  }
  async apply(row:Record<string,unknown>,ctx:MigrationApplyContext){return this.db.transaction(async()=>{const n=row as any;const ex=await this.db.db.select({id:crewMembers.id}).from(crewMembers).where(and(eq(crewMembers.operatorId,ctx.operatorId),eq(crewMembers.id,n.id))).limit(1);if(ex[0]&&ctx.strategy==='INSERT_ONLY')return'SKIPPED' as const;if(ex[0])await this.db.db.update(crewMembers).set({name:n.name,rank:n.rank,base:n.base,qualifications:n.qualifications,active:n.active,username:n.username}).where(and(eq(crewMembers.operatorId,ctx.operatorId),eq(crewMembers.id,n.id)));else await this.db.db.insert(crewMembers).values({...n,operatorId:ctx.operatorId});await this.audit.record(this.db,'ops',{operatorId:ctx.operatorId,actor:ctx.actor,action:ex[0]?'migration.crew.updated':'migration.crew.created',entityType:'crew',entityId:n.id,data:{jobId:ctx.jobId,rowNo:ctx.rowNo},rule:'PLATFORM-MIGRATION-01'});return'APPLIED' as const})}
}

@Injectable()
export class OpsFlightScheduleMigration implements OnModuleInit, MigrationAdapter {
  readonly target='ops.flight_schedule';
  readonly columns=[
    {name:'id',required:true,description:'Stable flight identifier'}, {name:'flightNo',required:true,description:'Operating flight number'},
    {name:'opDate',required:true,description:'Operating date YYYY-MM-DD'}, {name:'dep',required:true,description:'Departure ICAO'}, {name:'arr',required:true,description:'Arrival ICAO'},
    {name:'std',required:true,description:'Scheduled departure ISO-8601'}, {name:'sta',required:true,description:'Scheduled arrival ISO-8601'},
    {name:'tail',required:true,description:'Aircraft registration'}, {name:'aircraftType',required:true,description:'Aircraft type'}, {name:'bookedPax',required:true,description:'Booked passengers'}
  ];
  constructor(@Inject(DB_TOKEN.ops) private readonly db:ModuleDb,private readonly registry:MigrationRegistry,private readonly audit:AuditService){}
  onModuleInit(){this.registry.register(this)}
  key(r:Record<string,unknown>){return text(r.id).toUpperCase()}
  async validate(r:Record<string,unknown>,operatorId:string,strategy:MigrationStrategy){
    const std=new Date(text(r.std)),sta=new Date(text(r.sta));const n={id:text(r.id).toUpperCase(),flightNo:text(r.flightNo).toUpperCase(),opDate:text(r.opDate),dep:text(r.dep).toUpperCase(),arr:text(r.arr).toUpperCase(),std:text(r.std),sta:text(r.sta),tail:text(r.tail).toUpperCase(),aircraftType:text(r.aircraftType).toUpperCase(),bookedPax:Number(r.bookedPax)};
    if(n.id.length<2||n.id.length>80)return{ok:false as const,error:'id must be 2-80 characters'};if(!/^[A-Z0-9]{2,3}\d{1,4}[A-Z]?$/.test(n.flightNo))return{ok:false as const,error:'flightNo is invalid'};if(!/^\d{4}-\d{2}-\d{2}$/.test(n.opDate))return{ok:false as const,error:'opDate must be YYYY-MM-DD'};if(!/^[A-Z]{4}$/.test(n.dep)||! /^[A-Z]{4}$/.test(n.arr))return{ok:false as const,error:'dep and arr must be 4-letter ICAO codes'};if(Number.isNaN(std.getTime())||Number.isNaN(sta.getTime())||sta<=std)return{ok:false as const,error:'std/sta must be valid ISO times and sta must be after std'};if(!n.tail||!n.aircraftType)return{ok:false as const,error:'tail and aircraftType are required'};if(!Number.isInteger(n.bookedPax)||n.bookedPax<0||n.bookedPax>1000)return{ok:false as const,error:'bookedPax must be an integer from 0-1000'};
    const [ex]=await this.db.db.select().from(flights).where(and(eq(flights.operatorId,operatorId),eq(flights.id,n.id))).limit(1);if(ex&&strategy==='INSERT_ONLY')return{ok:false as const,error:`flight ${n.id} already exists`};if(ex&&!['SCHEDULED','DELAYED'].includes(ex.status))return{ok:false as const,error:`flight ${n.id} is ${ex.status}; migration cannot overwrite an operationally progressed flight`};return{ok:true as const,normalized:n};
  }
  async apply(row:Record<string,unknown>,ctx:MigrationApplyContext){return this.db.transaction(async()=>{const n=row as any;const [ex]=await this.db.db.select().from(flights).where(and(eq(flights.operatorId,ctx.operatorId),eq(flights.id,n.id))).for('update').limit(1);if(ex&&ctx.strategy==='INSERT_ONLY')return'SKIPPED' as const;if(ex&&!['SCHEDULED','DELAYED'].includes(ex.status))throw new Error(`Flight ${n.id} progressed to ${ex.status} during migration`);const values={operatorId:ctx.operatorId,flightNo:n.flightNo,opDate:n.opDate,dep:n.dep,arr:n.arr,std:new Date(n.std),sta:new Date(n.sta),etd:new Date(n.std),eta:new Date(n.sta),tail:n.tail,aircraftType:n.aircraftType,bookedPax:n.bookedPax};if(ex)await this.db.db.update(flights).set({...values,status:'SCHEDULED',delayMinutes:0,delayReason:null,delayCodes:[],version:ex.version+1}).where(and(eq(flights.operatorId,ctx.operatorId),eq(flights.id,n.id)));else await this.db.db.insert(flights).values({id:n.id,...values,status:'SCHEDULED',delayMinutes:0,delayReason:null,delayCodes:[],version:1});await this.audit.record(this.db,'ops',{operatorId:ctx.operatorId,actor:ctx.actor,action:ex?'migration.flight.updated':'migration.flight.created',entityType:'flight',entityId:n.id,data:{jobId:ctx.jobId,rowNo:ctx.rowNo},rule:'PLATFORM-MIGRATION-01'});return'APPLIED' as const})}
}
