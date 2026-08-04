import { PlatformAdminRecord } from '../../domain/repositories/platform-admin.repository';
import { PlatformAdminAccountResult } from '../dto/platform-admin-account.dto';

export function toPlatformAdminAccountResult(
  record: PlatformAdminRecord,
  email: string | null,
): PlatformAdminAccountResult {
  return {
    id: record.id,
    userId: record.userId,
    email,
    role: record.role,
    createdAt: record.createdAt,
    revokedAt: record.revokedAt,
  };
}
