import { priceLevelOf, referencePriceOf } from './price-level.policy';

describe('price level policy (ADR-046)', () => {
  it('averages the items ranked 2 to 11, skipping the most expensive', () => {
    // CR example: items 2..11 sum to 406, so the reference is 40.6.
    const prices = [120, 60, 55, 50, 45, 40, 36, 35, 30, 30, 25, 10, 5];
    expect(referencePriceOf(prices)).toBe(40.6);
  });

  it('uses what there is when the menu has fewer than eleven items', () => {
    expect(referencePriceOf([30, 10, 20])).toBe(15);
  });

  it('has no reference price with fewer than two priced items', () => {
    expect(referencePriceOf([])).toBeNull();
    expect(referencePriceOf([25])).toBeNull();
    expect(referencePriceOf([25, 0])).toBeNull();
  });

  it('maps the cumulative distribution to a quartile from 1 to 4', () => {
    expect(priceLevelOf(0.1)).toBe(1);
    expect(priceLevelOf(0.25)).toBe(1);
    expect(priceLevelOf(0.5)).toBe(2);
    expect(priceLevelOf(0.6)).toBe(3);
    expect(priceLevelOf(1)).toBe(4);
  });
});
