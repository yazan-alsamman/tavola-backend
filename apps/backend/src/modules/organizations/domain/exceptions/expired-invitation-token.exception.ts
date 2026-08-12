import { DomainException } from '@shared/domain/base/domain-exception.base';

export class ExpiredInvitationTokenException extends DomainException {
  public readonly code = 'EXPIRED_INVITATION_TOKEN';

  constructor() {
    super('This invitation link has expired.', 400);
  }
}
