import { UserConsent } from '../entities/user-consent.entity';

export interface UserConsentRepository {
  saveMany(consents: UserConsent[]): Promise<void>;
}
