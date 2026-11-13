import { resolveRestaurantTexts } from './restaurant-texts';

describe('resolveRestaurantTexts (ADR-052)', () => {
  it('keeps the Arabic name as the legacy name when both are given', () => {
    expect(
      resolveRestaurantTexts({ nameAr: 'نارنج', nameEn: 'Naranj', descriptionEn: 'Old city' }),
    ).toEqual({
      name: 'نارنج',
      nameAr: 'نارنج',
      nameEn: 'Naranj',
      description: 'Old city',
      descriptionAr: null,
      descriptionEn: 'Old city',
    });
  });

  it('files an old single name under the language of its script', () => {
    expect(resolveRestaurantTexts({ name: 'Naranj', description: 'مطعم' })).toMatchObject({
      name: 'Naranj',
      nameAr: null,
      nameEn: 'Naranj',
      descriptionAr: 'مطعم',
      descriptionEn: null,
    });
  });

  it('rejects a restaurant with no name in any language', () => {
    expect(resolveRestaurantTexts({ name: '  ', nameAr: null })).toBeNull();
  });
});
