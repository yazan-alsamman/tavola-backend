/**
 * Shared consent-shape used by Restaurant Owner account creation (ADR-022:
 * Platform Admin provisioning) - previously lived on the now-retired
 * `RegisterOrganizationOwnerCommand` (public self-registration), extracted
 * here since `ProvisionRestaurantOwnerCommand` needs it too.
 */
export interface RegistrationConsentsInput {
  termsOfService: boolean;
  privacyPolicy: boolean;
  marketing?: boolean;
}
