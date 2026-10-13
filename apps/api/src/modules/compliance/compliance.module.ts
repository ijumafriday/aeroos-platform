import { Controller, Get, Module } from '@nestjs/common';
import type { MelCatalogueEntryDto } from '@aeroos/contracts';
import { CurrentPrincipal, type Principal } from '../../platform/auth/principal';
import { ComplianceService } from './compliance.service';
import { EvidenceController, EvidenceService } from './evidence';
import { MatrixController, MatrixService } from './matrix.service';
import { MasterDataController, MasterDataService } from './master-data.service';
import { ComplianceControlController, ComplianceControlService } from './compliance-control.service';

export { ComplianceService } from './compliance.service';

@Controller('compliance')
export class ComplianceController {
  constructor(private readonly compliance: ComplianceService) {}

  @Get('rulepacks')
  rulepacks() {
    return this.compliance.registry.list();
  }

  @Get('mel-catalogue')
  catalogue(@CurrentPrincipal() p: Principal): MelCatalogueEntryDto[] {
    return this.compliance.catalogue(p.operatorId);
  }

  @Get('profile')
  profile(@CurrentPrincipal() p: Principal) {
    const pr = this.compliance.engine.profile(p.operatorId);
    return { operatorId: pr.operatorId, name: pr.name, authority: pr.authority, melTimeZone: pr.melTimeZone, approvedTypes: pr.approvedTypes };
  }
}

@Module({
  providers: [ComplianceService, EvidenceService, MatrixService, MasterDataService, ComplianceControlService],
  controllers: [ComplianceController, EvidenceController, MatrixController, MasterDataController, ComplianceControlController],
  exports: [ComplianceService, MasterDataService]
})
export class ComplianceModule {}
