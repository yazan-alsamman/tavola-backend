import { Organization } from '../../domain/entities/organization.entity';
import { PlatformAdminOrganizationResult } from '../dto/platform-admin-organization.dto';

export function toPlatformAdminOrganizationResult(
  organization: Organization,
): PlatformAdminOrganizationResult {
  const props = organization.toProps();
  return {
    organizationId: organization.organizationId.value,
    name: props.name,
    status: organization.status,
    updatedAt: props.updatedAt,
    deletedAt: props.deletedAt,
  };
}
