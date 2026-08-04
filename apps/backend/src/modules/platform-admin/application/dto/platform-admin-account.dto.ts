import { PlatformAdminRole } from '../../domain/enums/platform-admin.enums';

export interface PlatformAdminAccountResult {
  id: string;
  userId: string;
  email: string | null;
  role: PlatformAdminRole;
  createdAt: Date;
  revokedAt: Date | null;
}

export interface PlatformAdminAccountListResult {
  items: PlatformAdminAccountResult[];
  total: number;
  page: number;
  limit: number;
}

export interface CreatePlatformAdminCommand {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: PlatformAdminRole;
  actorId: string;
  correlationId?: string;
}

export interface UpdatePlatformAdminRoleCommand {
  platformAdminId: string;
  role: PlatformAdminRole;
  actorId: string;
  correlationId?: string;
}

export interface DeactivatePlatformAdminCommand {
  platformAdminId: string;
  actorId: string;
  correlationId?: string;
}

export interface ReactivatePlatformAdminCommand {
  platformAdminId: string;
  actorId: string;
  correlationId?: string;
}

export interface ListPlatformAdminsCommand {
  page: number;
  limit: number;
}

export interface GetPlatformAdminCommand {
  platformAdminId: string;
}
