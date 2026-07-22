import { RegistrationConsentsInput } from './registration-consents.dto';

/**
 * ADR-022 §"Restaurant Owner Provisioning Lifecycle": mirrors
 * `RegisterOrganizationOwnerCommand` exactly (same Organization + Owner
 * bootstrap data) - the only differences are the caller (an authenticated
 * Platform Admin, not an anonymous public request) and the absence of any
 * email-verification step.
 */
export interface ProvisionRestaurantOwnerCommand {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  language?: string;
  organizationName: string;
  organizationSlug?: string;
  consents: RegistrationConsentsInput;
  provisionedByPlatformAdminId: string;
  ipAddress: string;
  correlationId?: string;
}

export interface ProvisionRestaurantOwnerResult {
  userId: string;
  email: string;
  organizationId: string;
  organizationSlug: string;
  organizationName: string;
}
