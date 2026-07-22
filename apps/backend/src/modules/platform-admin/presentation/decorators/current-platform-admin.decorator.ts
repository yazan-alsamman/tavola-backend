import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import {
  PlatformAdminActor,
  PLATFORM_ADMIN_ACTOR_KEY,
} from '../../application/dto/platform-admin-actor.dto';

export const CurrentPlatformAdmin = createParamDecorator(
  (_data: unknown, context: ExecutionContext): PlatformAdminActor => {
    const request = context.switchToHttp().getRequest<Record<string, unknown>>();
    const actor = request[PLATFORM_ADMIN_ACTOR_KEY];
    if (!actor) {
      throw new Error('Platform Admin actor is not available on the request.');
    }
    return actor as PlatformAdminActor;
  },
);
