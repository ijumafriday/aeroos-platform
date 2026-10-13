import { Controller, Get } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function contract(name: string) { return JSON.parse(readFileSync(join(process.cwd(), 'contracts', name), 'utf8')); }
@Controller('contracts')
export class ContractsController {
  @Get('openapi') openapi() { return contract('openapi.json'); }
  @Get('asyncapi') asyncapi() { return contract('asyncapi.json'); }
}
