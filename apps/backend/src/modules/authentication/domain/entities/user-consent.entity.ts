import { Entity } from '@shared/domain/base/entity.base';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import { ConsentType } from '../enums/consent.enums';

export interface UserConsentProps {
  id: string;
  userId: string;
  consentType: ConsentType;
  termsVersion: string;
  consentedAt: Date;
  ipAddress: string;
}

export class UserConsent extends Entity<UserConsentProps> {
  private constructor(props: UserConsentProps) {
    super(props);
  }

  static create(props: UserConsentProps): UserConsent {
    if (props.ipAddress.trim().length === 0) {
      throw new Error('Consent ipAddress is required.');
    }
    if (props.termsVersion.trim().length === 0) {
      throw new Error('Consent termsVersion is required.');
    }
    return new UserConsent({ ...props });
  }

  get userId(): UserId {
    return UserId.create(this.props.userId);
  }

  get consentType(): ConsentType {
    return this.props.consentType;
  }

  toProps(): Readonly<UserConsentProps> {
    return { ...this.props };
  }
}
