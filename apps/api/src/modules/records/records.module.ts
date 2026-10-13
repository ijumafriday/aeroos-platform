import { Body, Controller, Get, Module, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentPrincipal, type Principal } from '../../platform/auth/principal';
import { ZodPipe } from '../../platform/http/http';
import { RecordsService } from './records.service';
import { RecordsControlService } from './records-control.service';
import { RecordsSearch } from './records.search';

const sha=z.string().regex(/^[0-9a-f]{64}$/);
const create=z.object({subjectType:z.enum(['AIRCRAFT','ENGINE','APU','COMPONENT','WORK_PACKAGE','LEASE']),subjectId:z.string().trim().min(1).max(80),title:z.string().trim().min(3).max(160),retentionUntil:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),recordClass:z.string().trim().min(1).max(40).optional(),custodian:z.string().trim().min(2).max(120).optional(),reviewDue:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()});
const req=z.object({code:z.string().trim().min(1).max(40),title:z.string().trim().min(2).max(160),required:z.boolean().default(true)});
const ev=z.object({requirementId:z.number().int().positive(),documentId:z.string().trim().min(3),sourceRef:z.string().trim().min(2).max(160)});
const pack=z.object({purpose:z.enum(['REDELIVERY','LEASE_TRANSITION','AUTHORITY','ARCHIVE'])});
const cls=z.object({code:z.string().trim().min(2).max(40),title:z.string().trim().min(3).max(120),retentionYears:z.number().int().min(0).max(100),retentionTrigger:z.enum(['CREATED','COMPLETED','AIRCRAFT_TRANSFER','COMPONENT_REMOVAL','LEASE_END']),description:z.string().trim().max(500).optional()});
const batch=z.object({sourceSystem:z.string().trim().min(2).max(80),sourceRef:z.string().trim().min(2).max(160),custodian:z.string().trim().min(2).max(120),receivedAt:z.string().datetime(),sourceManifestSha256:sha,notes:z.string().trim().max(1000).optional()});
const batchItem=z.object({documentId:z.string().trim().min(3),sourcePath:z.string().trim().min(1).max(500)});
const extraction=z.object({provider:z.string().trim().min(2).max(80),providerJobRef:z.string().trim().min(1).max(160),modelVersion:z.string().trim().min(1).max(80),extractedText:z.string().min(1).max(2_000_000),extractedTextSha256:sha,extractedFields:z.record(z.unknown()).default({}),confidence:z.number().min(0).max(1)});
const manual=z.object({recordClass:z.string().trim().min(1).max(40),subjectType:z.string().trim().min(1).max(40),subjectId:z.string().trim().min(1).max(80),recordDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),documentNumber:z.string().trim().max(120).optional(),pageFrom:z.number().int().positive().optional(),pageTo:z.number().int().positive().optional(),note:z.string().trim().min(2).max(1000)});
const review=z.object({decision:z.enum(['ACCEPTED','REJECTED']),recordClass:z.string().trim().max(40).optional(),subjectType:z.string().trim().max(40).optional(),subjectId:z.string().trim().max(80).optional(),recordDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),documentNumber:z.string().trim().max(120).optional(),pageFrom:z.number().int().positive().optional(),pageTo:z.number().int().positive().optional(),note:z.string().trim().min(2).max(1000)});
const lease=z.object({aircraftId:z.string().trim().min(2).max(40),lessor:z.string().trim().min(2).max(160),leaseRef:z.string().trim().min(2).max(120),leaseEnd:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),binderId:z.string().trim().min(3),customerContact:z.string().trim().max(160).optional()});
const leaseReq=z.object({code:z.string().trim().min(1).max(40),category:z.enum(['AIRFRAME','ENGINE','APU','LLP','AD_SB','MODIFICATION','MAINTENANCE','COMPONENT','DOCUMENT','COMMERCIAL']),title:z.string().trim().min(2).max(200),required:z.boolean().default(true),dueDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()});
const leaseEvidence=z.object({documentId:z.string().trim().min(3),sourceRef:z.string().trim().min(2).max(160)});
const leaseDecision=z.object({decision:z.enum(['ACCEPTED','WAIVED','REJECTED']),disposition:z.string().trim().min(2).max(1000)});
const leaseState=z.object({status:z.enum(['ASSESSMENT','REMEDIATION','READY','DELIVERED','ACCEPTED','CLOSED','CANCELLED'])});
const trace=z.object({projectId:z.string().trim().min(3).optional(),partNo:z.string().trim().min(1).max(80),serial:z.string().trim().min(1).max(80),eventDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),eventType:z.enum(['MANUFACTURE','ORIGINAL_RELEASE','INSTALL','REMOVE','SHOP_VISIT','REPAIR','OVERHAUL','SCRAP']),documentId:z.string().trim().min(3),sourceRef:z.string().trim().min(2).max(160),previousEntryId:z.number().int().positive().optional()});
const retention=z.object({recordClass:z.string().trim().min(1).max(40),retentionYears:z.number().int().min(0).max(100),trigger:z.enum(['CREATED','COMPLETED','AIRCRAFT_TRANSFER','COMPONENT_REMOVAL','LEASE_END']),dispositionAction:z.enum(['ARCHIVE','REVIEW']),legalBasis:z.string().trim().min(2).max(300)});
const hold=z.object({scopeType:z.enum(['BINDER','DOCUMENT','SUBJECT']),scopeId:z.string().trim().min(1).max(120),reason:z.string().trim().min(3).max(1000),authorityRef:z.string().trim().min(2).max(200)});
const reason=z.object({reason:z.string().trim().min(3).max(1000)});
const disposition=z.object({binderId:z.string().trim().min(3),eligibleOn:z.string().regex(/^\d{4}-\d{2}-\d{2}$/)});
const dispositionDecision=z.object({decision:z.enum(['ARCHIVE','RETAIN']),rationale:z.string().trim().min(3).max(1000)});
const delivery=z.object({recipient:z.string().trim().min(2).max(200),deliveryMethod:z.enum(['SECURE_LINK','SFTP','PHYSICAL_MEDIA','AUTHORITY_PORTAL']),deliveryRef:z.string().trim().min(2).max(200)});
const ack=z.object({decision:z.enum(['ACKNOWLEDGED','REJECTED']),reference:z.string().trim().min(2).max(200),reason:z.string().trim().max(1000).optional()});

@Controller('records') class RecordsController {
 constructor(private readonly s:RecordsService,private readonly c:RecordsControlService){}
 @Get() list(@CurrentPrincipal()p:Principal){return this.s.list(p)}
 @Post() create(@CurrentPrincipal()p:Principal,@Body(new ZodPipe(create))b:z.infer<typeof create>){return this.s.create(p,b)}
 @Get('portfolio/summary') portfolio(@CurrentPrincipal()p:Principal){return this.c.portfolio(p)}
 @Get('classes/list') classes(@CurrentPrincipal()p:Principal){return this.c.classes(p)}
 @Post('classes') saveClass(@CurrentPrincipal()p:Principal,@Body(new ZodPipe(cls))b:z.infer<typeof cls>){return this.c.saveClass(p,b)}
 @Get('intake/batches') batches(@CurrentPrincipal()p:Principal){return this.c.batches(p)}
 @Post('intake/batches') createBatch(@CurrentPrincipal()p:Principal,@Body(new ZodPipe(batch))b:z.infer<typeof batch>){return this.c.createBatch(p,b)}
 @Get('intake/batches/:id') batchDetail(@CurrentPrincipal()p:Principal,@Param('id')id:string){return this.c.batchDetail(p,id)}
 @Post('intake/batches/:id/items') batchItem(@CurrentPrincipal()p:Principal,@Param('id')id:string,@Body(new ZodPipe(batchItem))b:z.infer<typeof batchItem>){return this.c.addBatchItem(p,id,b)}
 @Post('intake/batches/:id/complete') batchComplete(@CurrentPrincipal()p:Principal,@Param('id')id:string){return this.c.completeBatch(p,id)}
 @Post('intake/items/:id/manual') manual(@CurrentPrincipal()p:Principal,@Param('id')id:string,@Body(new ZodPipe(manual))b:z.infer<typeof manual>){return this.c.manualClassification(p,Number(id),b)}
 @Post('intake/items/:id/extraction') extraction(@CurrentPrincipal()p:Principal,@Param('id')id:string,@Body(new ZodPipe(extraction))b:z.infer<typeof extraction>){return this.c.submitExtraction(p,Number(id),b)}
 @Post('intake/items/:id/review') review(@CurrentPrincipal()p:Principal,@Param('id')id:string,@Body(new ZodPipe(review))b:z.infer<typeof review>){return this.c.reviewExtraction(p,Number(id),b)}
 @Get('leases/list') leases(@CurrentPrincipal()p:Principal){return this.c.leases(p)}
 @Post('leases') createLease(@CurrentPrincipal()p:Principal,@Body(new ZodPipe(lease))b:z.infer<typeof lease>){return this.c.createLease(p,b)}
 @Get('leases/:id') leaseDetail(@CurrentPrincipal()p:Principal,@Param('id')id:string){return this.c.leaseDetail(p,id)}
 @Post('leases/:id/requirements') addLeaseReq(@CurrentPrincipal()p:Principal,@Param('id')id:string,@Body(new ZodPipe(leaseReq))b:z.infer<typeof leaseReq>){return this.c.addLeaseRequirement(p,id,b)}
 @Post('leases/:id/requirements/:reqId/evidence') leaseEv(@CurrentPrincipal()p:Principal,@Param('id')id:string,@Param('reqId')reqId:string,@Body(new ZodPipe(leaseEvidence))b:z.infer<typeof leaseEvidence>){return this.c.evidenceLeaseRequirement(p,id,Number(reqId),b)}
 @Post('leases/:id/requirements/:reqId/decision') leaseDec(@CurrentPrincipal()p:Principal,@Param('id')id:string,@Param('reqId')reqId:string,@Body(new ZodPipe(leaseDecision))b:z.infer<typeof leaseDecision>){return this.c.decideLeaseRequirement(p,id,Number(reqId),b)}
 @Post('leases/:id/state') leaseState(@CurrentPrincipal()p:Principal,@Param('id')id:string,@Body(new ZodPipe(leaseState))b:z.infer<typeof leaseState>){return this.c.transitionLease(p,id,b)}
 @Post('trace') addTrace(@CurrentPrincipal()p:Principal,@Body(new ZodPipe(trace))b:z.infer<typeof trace>){return this.c.addTrace(p,b)}
 @Post('trace/:partNo/:serial/verify') verifyTrace(@CurrentPrincipal()p:Principal,@Param('partNo')partNo:string,@Param('serial')serial:string){return this.c.verifyTrace(p,partNo,serial)}
 @Get('retention/control') retention(@CurrentPrincipal()p:Principal){return this.c.retention(p)}
 @Post('retention/policies') saveRetention(@CurrentPrincipal()p:Principal,@Body(new ZodPipe(retention))b:z.infer<typeof retention>){return this.c.saveRetention(p,b)}
 @Post('retention/holds') placeHold(@CurrentPrincipal()p:Principal,@Body(new ZodPipe(hold))b:z.infer<typeof hold>){return this.c.placeHold(p,b)}
 @Post('retention/holds/:id/release') releaseHold(@CurrentPrincipal()p:Principal,@Param('id')id:string,@Body(new ZodPipe(reason))b:z.infer<typeof reason>){return this.c.releaseHold(p,id,b)}
 @Post('retention/dispositions') createDisposition(@CurrentPrincipal()p:Principal,@Body(new ZodPipe(disposition))b:z.infer<typeof disposition>){return this.c.createDisposition(p,b)}
 @Post('retention/dispositions/:id/approve') approveDisposition(@CurrentPrincipal()p:Principal,@Param('id')id:string,@Body(new ZodPipe(dispositionDecision))b:z.infer<typeof dispositionDecision>){return this.c.approveDisposition(p,id,b)}
 @Get('binder/:id/packages') packages(@CurrentPrincipal()p:Principal,@Param('id')id:string){return this.c.packagesForBinder(p,id)}
 @Get('packages/:id/deliveries') deliveries(@CurrentPrincipal()p:Principal,@Param('id')id:string){return this.c.deliveriesFor(p,id)}
 @Post('packages/:id/deliver') deliver(@CurrentPrincipal()p:Principal,@Param('id')id:string,@Body(new ZodPipe(delivery))b:z.infer<typeof delivery>){return this.c.deliverPackage(p,id,b)}
 @Post('deliveries/:id/acknowledge') acknowledge(@CurrentPrincipal()p:Principal,@Param('id')id:string,@Body(new ZodPipe(ack))b:z.infer<typeof ack>){return this.c.acknowledgeDelivery(p,id,b)}
 @Get(':id') detail(@CurrentPrincipal()p:Principal,@Param('id')id:string){return this.s.detail(p,id)}
 @Post(':id/requirements') add(@CurrentPrincipal()p:Principal,@Param('id')id:string,@Body(new ZodPipe(req))b:z.infer<typeof req>){return this.s.addRequirement(p,id,b)}
 @Post(':id/evidence') evidence(@CurrentPrincipal()p:Principal,@Param('id')id:string,@Body(new ZodPipe(ev))b:z.infer<typeof ev>){return this.s.linkEvidence(p,id,b)}
 @Post(':id/complete') complete(@CurrentPrincipal()p:Principal,@Param('id')id:string){return this.s.complete(p,id)}
 @Post(':id/packages') package(@CurrentPrincipal()p:Principal,@Param('id')id:string,@Body(new ZodPipe(pack))b:z.infer<typeof pack>){return this.s.package(p,id,b.purpose)}
}
@Module({controllers:[RecordsController],providers:[RecordsService,RecordsControlService,RecordsSearch],exports:[RecordsService,RecordsControlService]}) export class RecordsModule{}
