import {
  deriveOrganizationSlugFromName,
  resolveOrganizationSlug,
} from '@modules/authentication/application/utils/organization-slug.util';
import { InvalidRegistrationInputException } from '@modules/authentication/application/exceptions/invalid-registration-input.exception';

describe('organization slug utilities', () => {
  it('derives a slug from an organization name', () => {
    expect(deriveOrganizationSlugFromName('Tavla Bistro Group')).toBe('tavla-bistro-group');
  });

  it('prefers an explicit slug when provided', () => {
    expect(resolveOrganizationSlug('Any Name', 'custom-slug')).toBe('custom-slug');
  });

  it('throws when slug cannot be derived', () => {
    expect(() => resolveOrganizationSlug('!!!', undefined)).toThrow(
      InvalidRegistrationInputException,
    );
  });
});
