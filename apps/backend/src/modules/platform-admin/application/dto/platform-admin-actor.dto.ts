import { PlatformAdminRole } from '../../domain/enums/platform-admin.enums';

export interface PlatformAdminActor {
  userId: string;
  role: PlatformAdminRole;
}

export const PLATFORM_ADMIN_ACTOR_KEY = 'platformAdminActor';
