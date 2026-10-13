import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  ComplianceEngine, defaultRegistry, rulepackArtifact, type Authority, type MelCategory, type OperatorMelEntry, type OperatorProfile, type RulepackRegistry
} from '@aeroos/compliance';
import type { MelCatalogueEntryDto } from '@aeroos/contracts';
import { CONFIG, type Config } from '../../config';
import { DB_TOKEN, type ModuleDb } from '../../platform/database/module-db';
import { and, eq, sql } from 'drizzle-orm';
import { masterDataSets, melEntries, operatorProfiles } from './compliance.tables';

// In its own file so the module's other providers (evidence, matrix) can import it without a circular import
// (a class imported from a half-loaded module is undefined in the DI metadata).
/**
 * Owns the compliance engine: authority rulepacks (code, versioned) combined with each operator's
 * approved data (database, the `compliance` schema). Other modules ask this service; none of them
 * branch on EASA vs FAA themselves.
 */
@Injectable()
export class ComplianceService implements OnModuleInit {
  private readonly log = new Logger('Compliance');
  readonly registry: RulepackRegistry;
  private current!: ComplianceEngine;

  private readonly production: boolean;
  constructor(@Inject(DB_TOKEN.compliance) private readonly db: ModuleDb, @Inject(CONFIG) config: Config) {
    this.production = config.NODE_ENV === 'production';
    this.registry = defaultRegistry({ allowDraft: config.ALLOW_DRAFT_RULEPACKS });
  }

  async onModuleInit() {
    if (this.production) await this.assertProductionDataHygiene();
    await this.reload();
  }

  get engine(): ComplianceEngine {
    return this.current;
  }

  private async assertProductionDataHygiene() {
    const result = await this.db.db.execute<{ hygiene: { demoSeedsApplied?: boolean; untrustedAircraftTypes?: unknown[]; untrustedEngineTypes?: unknown[] } }>(
      sql`select compliance.production_regulated_data_hygiene() as hygiene`
    );
    const h = result.rows?.[0]?.hygiene ?? {};
    const aircraft = Array.isArray(h.untrustedAircraftTypes) ? h.untrustedAircraftTypes : [];
    const engines = Array.isArray(h.untrustedEngineTypes) ? h.untrustedEngineTypes : [];
    if (h.demoSeedsApplied || aircraft.length || engines.length) {
      throw new Error(`Production regulated-data hygiene failed: demoSeedsApplied=${Boolean(h.demoSeedsApplied)}, untrustedAircraftTypes=${aircraft.length}, untrustedEngineTypes=${engines.length}. Replace legacy/demo values with operator-provenanced records through an approved forward migration before startup.`);
    }
  }

  /** Rebuild the engine from the operator profiles. Call after an approved MEL revision is loaded. */
  async reload() {
    const [profiles, entries] = await Promise.all([this.db.db.select().from(operatorProfiles), this.db.db.select().from(melEntries)]);
    const list: OperatorProfile[] = profiles.map(p => ({
      operatorId: p.operatorId,
      name: p.name,
      authority: p.authority as Authority,
      melTimeZone: p.melTimeZone,
      approvedTypes: p.approvedTypes,
      mel: Object.fromEntries(entries.filter(e => e.operatorId === p.operatorId).map(e => [e.ref, {
        ref: e.ref,
        ata: e.ata,
        title: e.title,
        category: e.category as MelCategory,
        intervalHours: e.intervalHours ?? undefined,
        extensionPermitted: e.extensionPermitted,
        opsProcedure: e.opsProcedure ?? undefined,
        maintProcedure: e.maintProcedure ?? undefined
      } satisfies OperatorMelEntry]))
    }));
    if (this.production) {
      for (const profile of list) {
        const pack = this.registry.resolve(profile.authority, new Date());
        const id = `${pack.authority}@${pack.version}`;
        const artifact = rulepackArtifact(id);
        if (!artifact) throw new Error(`No source-manifest fingerprint for production rulepack ${id}`);
        const key = `compliance.rulepack.${pack.authority.toLowerCase()}.${pack.version}`;
        const [approval] = await this.db.db.select({sha:masterDataSets.contentSha256}).from(masterDataSets).where(and(eq(masterDataSets.operatorId,profile.operatorId),eq(masterDataSets.key,key),eq(masterDataSets.status,'EFFECTIVE'))).limit(1);
        if (!approval || approval.sha !== artifact.sha256) {
          throw new Error(`Operator ${profile.operatorId} has no EFFECTIVE independently-approved ${id} governance record matching shipped artifact ${artifact.sha256}`);
        }
      }
    }
    this.current = new ComplianceEngine(this.registry, list);
    this.log.log(`loaded ${list.length} operator profile(s); rulepacks: ${this.registry.list().map(r => `${r.id}${r.status === 'draft' ? ' (draft)' : ''}`).join(', ')}`);
  }

  catalogue(operatorId: string): MelCatalogueEntryDto[] {
    return Object.values(this.engine.profile(operatorId).mel)
      .sort((a, b) => a.ref.localeCompare(b.ref))
      .map(e => ({ ref: e.ref, ata: e.ata, title: e.title, category: e.category, intervalHours: e.intervalHours ?? null, extensionPermitted: e.extensionPermitted }));
  }
}
