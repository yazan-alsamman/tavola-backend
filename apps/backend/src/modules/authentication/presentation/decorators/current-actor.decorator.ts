import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import {
  AUTHENTICATED_ACTOR_KEY,
  AuthenticatedActor,
} from '../../application/dto/authenticated-actor.dto';

export const CurrentActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedActor => {
    const request = context.switchToHttp().getRequest<Record<string, unknown>>();
    const actor = request[AUTHENTICATED_ACTOR_KEY];
    if (!actor) {
      throw new Error('Authenticated actor is not available on the request.');
    }
    return actor as AuthenticatedActor;
  },
);
