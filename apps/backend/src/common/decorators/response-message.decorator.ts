import { SetMetadata } from '@nestjs/common';

export const RESPONSE_MESSAGE_KEY = 'responseMessage';

/**
 * Lets a controller handler set the human-readable `message` field of the
 * success envelope (API_GUIDELINES.md example: "Reservation created
 * successfully.") without every handler having to build the envelope by
 * hand - ResponseEnvelopeInterceptor reads this metadata.
 */
export const ResponseMessage = (message: string): MethodDecorator =>
  SetMetadata(RESPONSE_MESSAGE_KEY, message);
