import { DomainException } from '@shared/domain/base/domain-exception.base';

/**
 * DECISIONS.md D14: the sole IDOR-safe "unresolvable" outcome for Messaging -
 * an unknown conversation id, a conversation in another organization, or a
 * conversation the caller is not authorized to know exists all collapse to
 * this same 404, never a distinguishing error.
 */
export class ConversationNotFoundException extends DomainException {
  public readonly code = 'NOT_FOUND';

  constructor() {
    super('Conversation not found.', 404);
  }
}
