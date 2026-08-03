import {
  calculateHaversineDistanceKm,
  computeBoundingBox,
  normalizeLongitude,
} from './nearby-search-geo.util';

describe('normalizeLongitude', () => {
  it('leaves an in-range value unchanged', () => {
    expect(normalizeLongitude(36.2765)).toBeCloseTo(36.2765, 9);
    expect(normalizeLongitude(-36.2765)).toBeCloseTo(-36.2765, 9);
  });

  it('wraps a value above 180 back into range', () => {
    expect(normalizeLongitude(190)).toBeCloseTo(-170, 9);
  });

  it('wraps a value below -180 back into range', () => {
    expect(normalizeLongitude(-190)).toBeCloseTo(170, 9);
  });
});

describe('computeBoundingBox', () => {
  it('produces a symmetric box around the equator (no latitude distortion)', () => {
    const box = computeBoundingBox(0, 0, 111.32);
    expect(box.minLat).toBeCloseTo(-1, 1);
    expect(box.maxLat).toBeCloseTo(1, 1);
    expect(box.minLng).toBeCloseTo(-1, 1);
    expect(box.maxLng).toBeCloseTo(1, 1);
  });

  it('widens the longitude span at high latitude (D4/D13 latitude-dependent longitude span)', () => {
    const equatorBox = computeBoundingBox(0, 0, 50);
    const highLatBox = computeBoundingBox(60, 0, 50);
    const equatorSpan = equatorBox.maxLng - equatorBox.minLng;
    const highLatSpan = highLatBox.maxLng - highLatBox.minLng;
    expect(highLatSpan).toBeGreaterThan(equatorSpan);
  });

  it('does not divide by zero at the pole and clamps latitude to +/-90', () => {
    const box = computeBoundingBox(89.9, 0, 50);
    expect(Number.isFinite(box.minLng)).toBe(true);
    expect(Number.isFinite(box.maxLng)).toBe(true);
    expect(box.maxLat).toBeLessThanOrEqual(90);
  });

  it('handles negative latitude/longitude centers correctly', () => {
    const box = computeBoundingBox(-33.5138, -70.6693, 10);
    expect(box.minLat).toBeLessThan(-33.5138);
    expect(box.maxLat).toBeGreaterThan(-33.5138);
    expect(box.minLng).toBeLessThan(-70.6693);
    expect(box.maxLng).toBeGreaterThan(-70.6693);
  });

  it('crosses the antimeridian by producing minLng > maxLng, signaling the OR-range case', () => {
    const box = computeBoundingBox(0, 179.9, 50);
    expect(box.minLng).toBeGreaterThan(box.maxLng);
  });
});

describe('calculateHaversineDistanceKm', () => {
  it('returns 0 for identical points', () => {
    expect(calculateHaversineDistanceKm(33.5138, 36.2765, 33.5138, 36.2765)).toBeCloseTo(0, 6);
  });

  it('matches a known real-world distance within reasonable tolerance (Damascus to Aleppo, ~300km)', () => {
    const distance = calculateHaversineDistanceKm(33.5138, 36.2765, 36.2021, 37.1343);
    expect(distance).toBeGreaterThan(280);
    expect(distance).toBeLessThan(320);
  });

  it('is symmetric regardless of argument order', () => {
    const a = calculateHaversineDistanceKm(33.5138, 36.2765, 36.2021, 37.1343);
    const b = calculateHaversineDistanceKm(36.2021, 37.1343, 33.5138, 36.2765);
    expect(a).toBeCloseTo(b, 9);
  });

  it('never returns NaN for near-identical points (acos domain clamp)', () => {
    const distance = calculateHaversineDistanceKm(10, 10, 10.0000001, 10.0000001);
    expect(Number.isNaN(distance)).toBe(false);
    expect(distance).toBeGreaterThanOrEqual(0);
  });

  it('handles high-latitude points correctly', () => {
    const distance = calculateHaversineDistanceKm(78.2232, 15.6267, 78.9, 11.9);
    expect(distance).toBeGreaterThan(0);
    expect(Number.isFinite(distance)).toBe(true);
  });
});
