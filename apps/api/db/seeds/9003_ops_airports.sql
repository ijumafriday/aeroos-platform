-- Reference airports for the demo network (production loads its own airport database).
INSERT INTO ops.airports (icao, iata, name, time_zone, lat, lon, location, is_base)
SELECT icao, iata, name, tz, lat, lon, ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography, base
FROM (VALUES
  ('ENGM', 'OSL', 'Oslo Gardermoen', 'Europe/Oslo', 60.1939, 11.1004, true),
  ('ENBR', 'BGO', 'Bergen Flesland', 'Europe/Oslo', 60.2934, 5.2181, false),
  ('ENVA', 'TRD', 'Trondheim Værnes', 'Europe/Oslo', 63.4578, 10.9240, false),
  ('ENZV', 'SVG', 'Stavanger Sola', 'Europe/Oslo', 58.8767, 5.6378, false),
  ('ENTC', 'TOS', 'Tromsø Langnes', 'Europe/Oslo', 69.6833, 18.9189, false),
  ('ENBO', 'BOO', 'Bodø', 'Europe/Oslo', 67.2692, 14.3653, false),
  ('ENTO', 'TRF', 'Sandefjord Torp', 'Europe/Oslo', 59.1867, 10.2586, false),
  ('ENAL', 'AES', 'Ålesund Vigra', 'Europe/Oslo', 62.5625, 6.1197, false),
  ('ENHD', 'HAU', 'Haugesund Karmøy', 'Europe/Oslo', 59.3453, 5.2084, false),
  ('ENEV', 'EVE', 'Harstad/Narvik Evenes', 'Europe/Oslo', 68.4913, 16.6781, false),
  ('EKCH', 'CPH', 'Copenhagen Kastrup', 'Europe/Copenhagen', 55.6181, 12.6561, false),
  ('EKBI', 'BLL', 'Billund', 'Europe/Copenhagen', 55.7403, 9.1518, false),
  ('ESSA', 'ARN', 'Stockholm Arlanda', 'Europe/Stockholm', 59.6519, 17.9186, false),
  ('ESGG', 'GOT', 'Gothenburg Landvetter', 'Europe/Stockholm', 57.6628, 12.2798, false),
  ('EGLL', 'LHR', 'London Heathrow', 'Europe/London', 51.4700, -0.4543, false),
  ('EGKK', 'LGW', 'London Gatwick', 'Europe/London', 51.1481, -0.1903, false),
  ('GCLP', 'LPA', 'Gran Canaria', 'Atlantic/Canary', 27.9319, -15.3866, false),
  ('GCTS', 'TFS', 'Tenerife South', 'Atlantic/Canary', 28.0445, -16.5725, false),
  ('GCRR', 'ACE', 'Lanzarote', 'Atlantic/Canary', 28.9455, -13.6052, false)
) AS v(icao, iata, name, tz, lat, lon, base)
ON CONFLICT (icao) DO NOTHING;
