import {
  OwnershipTransferResult,
  PlatformAdminOrganizationResult,
} from '../../application/dto/platform-admin-organization.dto';
import {
  OwnershipTransferResponseDto,
  PlatformAdminOrganizationResponseDto,
} from '../dto/platform-admin-organization.response.dto';

export function toPlatformAdminOrganizationResponse(
  result: PlatformAdminOrganizationResult,
): PlatformAdminOrganizationResponseDto {
  return {
    organizationId: result.organizationId,
    name: result.name,
    status: result.status,
    updatedAt: result.updatedAt.toISOString(),
  };
}

export function toOwnershipTransferResponse(
  result: OwnershipTransferResult,
): OwnershipTransferResponseDto {
  return {
    organizationId: result.organizationId,
    previousOwnerUserId: result.previousOwnerUserId,
    newOwnerUserId: result.newOwnerUserId,
  };
}
