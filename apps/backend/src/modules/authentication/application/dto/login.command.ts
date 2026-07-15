import { DeviceType } from '../../domain/enums/authentication.enums';

export interface LoginCommand {
  email: string;
  password: string;
  deviceName?: string | null;
  deviceType?: DeviceType | null;
  ipAddress: string;
  userAgent?: string | null;
  correlationId?: string;
}
