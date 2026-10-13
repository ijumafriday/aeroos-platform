-- Representative records intentionally use columns present by migration 0038.
INSERT INTO compliance.operator_profiles(operator_id,name,authority,mel_time_zone,approved_types)
VALUES ('UPG','Upgrade Assurance Airline','EASA','UTC',ARRAY['A320'])
ON CONFLICT (operator_id) DO NOTHING;
INSERT INTO org.personnel(id,operator_id,username,name,licence_no,role_title,base)
VALUES ('UPG-P1','UPG','upgrade.captain','Upgrade Captain','LIC-UPG','Captain','NBO')
ON CONFLICT (id) DO NOTHING;
INSERT INTO ops.airports(icao,iata,name,time_zone,lat,lon,location,is_base)
VALUES
('HKJK','NBO','Jomo Kenyatta Intl','Africa/Nairobi',-1.3192,36.9278,ST_SetSRID(ST_MakePoint(36.9278,-1.3192),4326)::geography,true),
('HTDA','DAR','Julius Nyerere Intl','Africa/Dar_es_Salaam',-6.8781,39.2026,ST_SetSRID(ST_MakePoint(39.2026,-6.8781),4326)::geography,false)
ON CONFLICT (icao) DO NOTHING;
INSERT INTO ops.flights(id,operator_id,flight_no,op_date,dep,arr,std,sta,etd,eta,tail,aircraft_type,status,booked_pax)
VALUES ('UPG-F1','UPG','UPG101',DATE '2026-01-15','HKJK','HTDA',TIMESTAMPTZ '2026-01-15 06:00Z',TIMESTAMPTZ '2026-01-15 07:20Z',TIMESTAMPTZ '2026-01-15 06:00Z',TIMESTAMPTZ '2026-01-15 07:20Z','5Y-UPG','A320','SCHEDULED',120)
ON CONFLICT (id) DO NOTHING;
