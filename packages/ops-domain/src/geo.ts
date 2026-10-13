/** Great-circle helpers for flight following and distances (WGS-84 sphere approximation). */
const R = 6371.0088;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export interface LatLon { lat: number; lon: number }

export function greatCircleKm(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Point a fraction of the way along the great circle from a to b (0 → a, 1 → b). */
export function interpolate(a: LatLon, b: LatLon, fraction: number): LatLon {
  const f = Math.min(1, Math.max(0, fraction));
  const φ1 = rad(a.lat), λ1 = rad(a.lon), φ2 = rad(b.lat), λ2 = rad(b.lon);
  const δ = greatCircleKm(a, b) / R;
  if (δ === 0) return { ...a };
  const A = Math.sin((1 - f) * δ) / Math.sin(δ);
  const B = Math.sin(f * δ) / Math.sin(δ);
  const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
  const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
  const z = A * Math.sin(φ1) + B * Math.sin(φ2);
  return { lat: deg(Math.atan2(z, Math.sqrt(x * x + y * y))), lon: deg(Math.atan2(y, x)) };
}

/** Estimated position of an airborne flight from its estimated times (no surveillance feed yet). */
export function estimatedPosition(dep: LatLon, arr: LatLon, etd: Date, eta: Date, now: Date): LatLon | null {
  const t = now.getTime();
  if (t <= etd.getTime() || t >= eta.getTime()) return null;
  return interpolate(dep, arr, (t - etd.getTime()) / (eta.getTime() - etd.getTime()));
}
