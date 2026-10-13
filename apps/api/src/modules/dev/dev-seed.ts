import { Inject, Injectable, Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import { CONFIG, type Config } from '../../config';
import { CamoModule } from '../camo/camo.module';
import { FleetQuery } from '../camo/camo.repository';
import { MelService } from '../camo/mel.service';

const H = 3_600_000;

/**
 * Demo deferrals for a fresh database (SEED_DEMO=true only). They go through the real code path —
 * compliance engine, audit chain, outbox, escalation workflows — exactly like user input, and are
 * attributed to "system:demo-seed" in the audit trail.
 */
@Injectable()
export class DevSeed implements OnApplicationBootstrap {
  private readonly log = new Logger('DevSeed');

  constructor(@Inject(CONFIG) private readonly config: Config, private readonly mel: MelService, private readonly fleet: FleetQuery) {}

  async onApplicationBootstrap() {
    if (!this.config.SEED_DEMO) return;
    if ((await this.mel.countFor('NKX')) > 0) return;
    const now = Date.now();
    const items: [string, string, string, number][] = [
      ['LN-ABC', '36-11-04', 'BLEED DUCT OVHT SENSOR R CH B FAULT', 70],
      ['LN-ABD', '21-51-02', 'PACK 2 FCV INOP — VALVE SECURED CLOSED', 50],
      ['LN-NGX', '31-31-01', 'FDR STATUS FLAG INTERMITTENT', 10],
      ['LN-RKF', '30-42-01', 'WINDSHIELD ANTI-ICE L INOP', 9.5 * 24],
      ['LN-RTA', '23-31-02', 'PA ZONE C INTERMITTENT', 3 * 24],
      ['LN-ABC', '25-41-03', 'AFT LAV MIRROR CRACKED', 30 * 24]
    ];
    for (const [reg, melRef, description, hoursAgo] of items) {
      const tail = await this.fleet.get(reg);
      if (!tail) continue;
      await this.mel.raiseAs('system:demo-seed', { operatorId: tail.operatorId, tail: reg, aircraftType: tail.type, melRef, description, raisedAt: new Date(now - hoursAgo * H) });
    }
    this.log.log(`seeded ${items.length} demo deferrals`);
  }
}

@Module({ imports: [CamoModule], providers: [DevSeed] })
export class DevModule {}
