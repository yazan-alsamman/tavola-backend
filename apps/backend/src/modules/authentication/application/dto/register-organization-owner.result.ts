import { UserStatus } from '../../domain/enums/authentication.enums';

export interface RegisterOrganizationOwnerResult {
  userId: string;
  email: string;
  status: UserStatus;
  organizationId: string;
  organizationSlug: string;
  organizationName: string;
}
