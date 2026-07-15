import { InvalidRegistrationInputException } from '../exceptions/invalid-registration-input.exception';

export function deriveOrganizationSlugFromName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

export function resolveOrganizationSlug(
  organizationName: string,
  organizationSlug?: string,
): string {
  const candidate =
    organizationSlug !== undefined && organizationSlug.trim().length > 0
      ? organizationSlug.trim().toLowerCase()
      : deriveOrganizationSlugFromName(organizationName);

  if (candidate.length === 0) {
    throw new InvalidRegistrationInputException(
      'Organization slug could not be derived from the organization name.',
    );
  }

  return candidate;
}
