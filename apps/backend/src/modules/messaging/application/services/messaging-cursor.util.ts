import { InvalidConversationException } from '../../domain/exceptions/invalid-conversation.exception';

interface DecodedCursor {
  sortValue: string;
  id: string;
}

/**
 * DECISIONS.md D13 - opaque cursor encoding shared by the Messages and
 * Conversation-list endpoints, both keyset-paginated on `(sortValue, id)`
 * descending. The cursor is base64url(JSON), never a raw offset - clients
 * must treat it as opaque, matching every other opaque-token convention in
 * this codebase (e.g. refresh tokens).
 */
export function encodeMessagingCursor(sortValue: Date, id: string): string {
  const payload: DecodedCursor = { sortValue: sortValue.toISOString(), id };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeMessagingCursor(cursor: string): { sortValue: Date; id: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new InvalidConversationException('Invalid pagination cursor.');
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as DecodedCursor).sortValue !== 'string' ||
    typeof (parsed as DecodedCursor).id !== 'string'
  ) {
    throw new InvalidConversationException('Invalid pagination cursor.');
  }
  const sortValue = new Date((parsed as DecodedCursor).sortValue);
  if (Number.isNaN(sortValue.getTime())) {
    throw new InvalidConversationException('Invalid pagination cursor.');
  }
  return { sortValue, id: (parsed as DecodedCursor).id };
}
