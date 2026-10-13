export const REGULATED_MASTER_DATA = [
  { key: 'ops.aircraft_types', domain: 'OPERATIONS', title: 'Aircraft type performance and mass limits', bindLiveHash: true },
  { key: 'ops.aircraft_weights', domain: 'OPERATIONS', title: 'Aircraft weighing / basic empty mass data', bindLiveHash: true },
  { key: 'ops.runway_limits', domain: 'OPERATIONS', title: 'Runway performance limits', bindLiveHash: true },
  { key: 'ops.routes_permits', domain: 'OPERATIONS', title: 'Routes, permit rules and overflight authorities', bindLiveHash: true },
  { key: 'camo.maintenance_programme', domain: 'AIRWORTHINESS', title: 'Approved maintenance programme requirements', bindLiveHash: true },
  { key: 'camo.srm_limits', domain: 'ENGINEERING', title: 'Structural Repair Manual limits', bindLiveHash: true },
  { key: 'camo.engine_limits', domain: 'ENGINEERING', title: 'Engine health / oil / trend limits', bindLiveHash: true },
  { key: 'camo.mel', domain: 'AIRWORTHINESS', title: 'Minimum Equipment List', bindLiveHash: true },
  { key: 'compliance.ftl', domain: 'CREW', title: 'Operator flight-time limitation scheme', bindLiveHash: false }
] as const;

export const REGULATED_MASTER_DATA_KEYS = REGULATED_MASTER_DATA.map(x => x.key);
export const LIVE_HASH_BOUND_KEYS = new Set(REGULATED_MASTER_DATA.filter(x => x.bindLiveHash).map(x => x.key));
