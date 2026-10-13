import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentPrincipal, type Principal } from '../auth/principal';
import { ZodPipe } from '../http/http';
import { ALLOWED_CONTENT_TYPES, DocumentsService, OWNER_TYPES } from './documents.service';

const uploadSchema = z.object({
  ownerType: z.enum(OWNER_TYPES),
  ownerId: z.string().min(1).max(80),
  fileName: z.string().min(1).max(200),
  contentType: z.enum(ALLOWED_CONTENT_TYPES),
  sizeBytes: z.number().int().positive()
});

@Controller('documents')
export class DocumentsController {
  constructor(private readonly docs: DocumentsService) {}

  /** Step 1: register the document and get a presigned PUT URL (valid 15 minutes). */
  @Post('uploads')
  upload(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(uploadSchema)) body: z.infer<typeof uploadSchema>) {
    return this.docs.createUpload(p, body);
  }

  /** Step 2: after the browser's PUT succeeds — hash the stored object and record it. */
  @Post(':id/confirm')
  confirm(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.docs.confirm(p, id);
  }

  @Get()
  list(@CurrentPrincipal() p: Principal, @Query('ownerType') ownerType: string, @Query('ownerId') ownerId: string) {
    return this.docs.list(p, ownerType ?? '', ownerId ?? '');
  }

  /** A short-lived presigned GET URL. */
  @Get(':id/url')
  url(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.docs.downloadUrl(p, id);
  }
}
