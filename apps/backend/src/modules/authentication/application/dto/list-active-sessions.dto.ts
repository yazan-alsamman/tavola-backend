import { DeviceType } from '../../domain/enums/authentication.enums';
import { AuthenticatedActor } from './authenticated-actor.dto';

export interface ListActiveSessionsCommand {
  actor: AuthenticatedActor;
}

export interface ActiveSessionItem {
  sessionId: string;
  deviceName: string | null;
  deviceType: DeviceType;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date;
  isCurrentSession: boolean;
  ipAddress: string | null;
}

export interface ListActiveSessionsResult {
  sessions: ActiveSessionItem[];
}
