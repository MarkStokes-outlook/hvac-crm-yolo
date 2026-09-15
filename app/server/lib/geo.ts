export interface LatLng {
  lat: number;
  lng: number;
}

export function distanceKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Rough drive-time estimate. Straight-line distance × 1.35 road factor at ~50 km/h average
 * (North West urban/motorway mix), plus 5 minutes for parking and signing in.
 */
export function travelMinutes(a: LatLng | null | undefined, b: LatLng | null | undefined): number | null {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const km = distanceKm(a, b) * 1.35;
  return Math.round((km / 50) * 60 + 5);
}

export const DEPOT: LatLng & { name: string; postcode: string } = {
  name: 'Frostline depot, Bury',
  postcode: 'BL9 8RR',
  lat: 53.5751,
  lng: -2.2826,
};
