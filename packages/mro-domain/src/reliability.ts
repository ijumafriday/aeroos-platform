import { DAY_MS } from '@aeroos/kernel';

/**
 * Reliability programme (Part-CAMO AMC M.A.302(f)): defect rates per ATA chapter per 1000 flight hours,
 * compared with the operator's alert levels. Defects are the technical-log entries (MEL deferrals today).
 */
export interface DefectRate { ata: string; defects: number; ratePer1000Fh: number; alertLevel: number; alert: boolean }

export function defectRates(defects: { ata: string; at: Date }[], fleetFh: number, now: Date, windowDays: number, alertLevels: Record<string, number>, defaultAlert = 2.0): DefectRate[] {
  const from = now.getTime() - windowDays * DAY_MS;
  const counts = new Map<string, number>();
  for (const d of defects) {
    if (d.at.getTime() < from || d.at.getTime() > now.getTime()) continue;
    const ata = d.ata.slice(0, 2);
    counts.set(ata, (counts.get(ata) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([ata, n]) => {
      const rate = fleetFh > 0 ? Math.round((n / fleetFh) * 1000 * 100) / 100 : 0;
      const alertLevel = alertLevels[ata] ?? defaultAlert;
      return { ata, defects: n, ratePer1000Fh: rate, alertLevel, alert: rate > alertLevel };
    })
    .sort((a, b) => b.ratePer1000Fh - a.ratePer1000Fh || a.ata.localeCompare(b.ata));
}
