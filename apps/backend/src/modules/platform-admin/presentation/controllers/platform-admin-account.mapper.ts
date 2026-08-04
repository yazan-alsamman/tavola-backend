import { PlatformAdminAccountResult } from '../../application/dto/platform-admin-account.dto';
import { PlatformAdminAccountResponseDto } from '../dto/platform-admin-account.response.dto';

export function toPlatformAdminAccountResponse(
  result: PlatformAdminAccountResult,
): PlatformAdminAccountResponseDto {
  return {
    id: result.id,
    userId: result.userId,
    email: result.email,
    role: result.role,
    createdAt: result.createdAt.toISOString(),
    revokedAt: result.revokedAt ? result.revokedAt.toISOString() : null,
  };
}
