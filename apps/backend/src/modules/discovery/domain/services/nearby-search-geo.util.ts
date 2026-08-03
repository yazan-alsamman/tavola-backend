/**
 * Phase 15.5 (Discovery Module, architecture frozen 2026-07-29, D4/D11-adjacent
 * "bounding box correctness" instruction). Pure, framework-independent geo
 * math shared by `PrismaDiscoveryReader.searchNearby` (bounding-box prefilter
 * parameters) and its own unit tests - no Prisma/NestJS dependency here, so
 * every edge case (equator, high latitude, antimeridian crossing, negative
 * lat/lng) is testable without a database.
 */

const EARTH_RADIUS_KM = 6371;
const KM_PER_DEGREE_LATITUDE = 110.574;
const KM_PER_DEGREE_LONGITUDE_AT_EQUATOR = 111.32;
/** Below this |cos(lat)| the longitude-per-km conversion is treated as undefined (near the poles) - clamped to the widest possible span instead of dividing by ~0. */
const MIN_COS_LATITUDE = 1e-6;

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  /**
   * `minLng`/`maxLng` are always normalized into [-180, 180]. When
   * `minLng > maxLng`, the box crosses the antimeridian (±180°) and the
   * caller must treat it as two OR'd ranges: `longitude >= minLng OR
   * longitude <= maxLng` - never a single `BETWEEN`.
   */
  minLng: number;
  maxLng: number;
}

/** Wraps an arbitrary longitude value into the canonical [-180, 180] range. */
export function normalizeLongitude(value: number): number {
  let normalized = value % 360;
  if (normalized > 180) {
    normalized -= 360;
  } else if (normalized < -180) {
    normalized += 360;
  }
  return normalized;
}

/**
 * Computes a bounding box around (lat, lng) wide enough to contain every
 * point within `radiusKm` - a cheap, index-usable prefilter, never the final
 * authority on inclusion (see `calculateHaversineDistanceKm` for that).
 * Longitude span widens as latitude approaches the poles (1° of longitude
 * covers less ground) per D4/the "bounding-box correctness" instruction -
 * clamped so it can never exceed the full [-180, 180] range at extreme
 * latitudes, and clamped in latitude at the poles themselves.
 */
export function computeBoundingBox(lat: number, lng: number, radiusKm: number): BoundingBox {
  const latDeltaDegrees = radiusKm / KM_PER_DEGREE_LATITUDE;
  const minLat = Math.max(lat - latDeltaDegrees, -90);
  const maxLat = Math.min(lat + latDeltaDegrees, 90);

  const cosLat = Math.max(Math.abs(Math.cos((lat * Math.PI) / 180)), MIN_COS_LATITUDE);
  const kmPerDegreeLongitude = KM_PER_DEGREE_LONGITUDE_AT_EQUATOR * cosLat;
  const lngDeltaDegrees = Math.min(radiusKm / kmPerDegreeLongitude, 180);

  return {
    minLat,
    maxLat,
    minLng: normalizeLongitude(lng - lngDeltaDegrees),
    maxLng: normalizeLongitude(lng + lngDeltaDegrees),
  };
}

/**
 * Great-circle distance in kilometers between two lat/lng points (the exact,
 * authoritative refinement over the bounding-box prefilter - D4). The
 * `Math.min(1, Math.max(-1, ...))` clamp guards against a `NaN` from
 * `Math.acos` when floating-point rounding pushes the cosine sum a hair
 * outside `[-1, 1]` for two points that are (near-)identical.
 */
export function calculateHaversineDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
  const cosineOfCentralAngle =
    Math.sin(toRadians(lat1)) * Math.sin(toRadians(lat2)) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.cos(toRadians(lng2) - toRadians(lng1));
  const clamped = Math.min(1, Math.max(-1, cosineOfCentralAngle));
  return EARTH_RADIUS_KM * Math.acos(clamped);
}
