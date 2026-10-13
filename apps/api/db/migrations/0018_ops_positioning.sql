-- Positioning (deadheading): a crew member carried as a passenger on a flight at the operator's behest.
-- Counts as duty (and as FDP before operating), never as a sector (ORO.FTL.105, ORO.FTL.220).
ALTER TABLE ops.crew_assignments ADD COLUMN positioning boolean NOT NULL DEFAULT false;
-- Crew recovery re-plans the original crew member's positioning after a hand-over (removes now-pointless rows).
GRANT DELETE ON ops.crew_assignments TO ops_svc;
