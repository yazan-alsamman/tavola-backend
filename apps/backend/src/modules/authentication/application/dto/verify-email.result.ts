import { UserStatus } from '../../domain/enums/authentication.enums';

export interface VerifyEmailResult {
  userId: string;
  email: string;
  status: UserStatus;
}
