import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import {
  AUTHENTICATED_ACTOR_KEY,
  AuthenticatedActor,
} from '../../application/dto/authenticated-actor.dto';
import {
  InvalidAccessTokenException,
  StaleSessionVersionException,
} from '../../application/exceptions/access-token.exceptions';
import { AccountLockedException } from '../../application/exceptions/login.exceptions';
import { AccountSuspendedException } from '../../application/exceptions/login.exceptions';
import { EmailNotVerifiedException } from '../../application/exceptions/login.exceptions';
import { SessionPolicy } from '../../domain/services/authentication-policies';
import { UserRepository } from '../../domain/repositories/authentication.repositories';
import { USER_REPOSITORY } from '../../domain/tokens/authentication.tokens';

@Injectable()
export class SessionVersionGuard implements CanActivate {
  constructor(@Inject(USER_REPOSITORY) private readonly userRepository: UserRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Record<string, unknown>>();
    const actor = request[AUTHENTICATED_ACTOR_KEY] as AuthenticatedActor | undefined;

    if (!actor) {
      throw new InvalidAccessTokenException();
    }

    const user = await this.userRepository.findById(UserId.create(actor.userId));
    if (user === null) {
      throw new InvalidAccessTokenException();
    }

    try {
      user.canLogin();
    } catch (error) {
      if (
        error instanceof AccountSuspendedException ||
        error instanceof AccountLockedException ||
        error instanceof EmailNotVerifiedException
      ) {
        throw error;
      }
      throw new InvalidAccessTokenException();
    }

    if (SessionPolicy.isSessionVersionStale(actor.sessionVersion, user.sessionVersion)) {
      throw new StaleSessionVersionException();
    }

    return true;
  }
}
