import { ExecutionContext } from '@nestjs/common';
import { SessionVersionGuard } from './session-version.guard';
import {
  AUTHENTICATED_ACTOR_KEY,
  AuthenticatedUserActor,
} from '../../application/dto/authenticated-actor.dto';
import {
  InvalidAccessTokenException,
  StaleSessionVersionException,
} from '../../application/exceptions/access-token.exceptions';
import { AccountSuspendedException } from '../../application/exceptions/login.exceptions';
import { RegistrationPolicy } from '../../domain/services/registration-policy';
import { Email } from '@shared/domain/value-objects/email.vo';
import { PasswordHash } from '@shared/domain/value-objects/password-hash.vo';
import { UserStatus } from '../../domain/enums/authentication.enums';
import { AccessTokenActorType } from '../../domain/services/access-token-claims';
import { User } from '../../domain/entities/user.entity';
import { InMemoryUserRepository } from '../../../../../test/authentication/support/in-memory-registration.dependencies';

describe('SessionVersionGuard', () => {
  const fixedNow = new Date('2026-07-07T18:00:00.000Z');
  const userId = '11111111-1111-4111-8111-111111111111';
  const tokenFamilyId = '22222222-2222-4222-8222-222222222222';
  const sessionId = '33333333-3333-4333-8333-333333333333';

  function createActiveUser(overrides?: Partial<ReturnType<User['toProps']>>): User {
    const base = RegistrationPolicy.createPendingUser({
      id: userId,
      email: Email.create('guard@example.com'),
      passwordHash: PasswordHash.create('argon2id$fake$SecurePass123!'),
      firstName: 'Guard',
      lastName: 'User',
      phone: null,
      language: 'en',
      at: fixedNow,
    }).verifyEmail(fixedNow);

    return User.reconstitute({ ...base.toProps(), ...overrides });
  }

  function createActor(sessionVersion: number): AuthenticatedUserActor {
    return {
      actorType: AccessTokenActorType.User,
      userId,
      sessionId,
      sessionVersion,
      tokenFamilyId,
    };
  }

  function createExecutionContext(actor?: AuthenticatedUserActor) {
    const request: Record<string, unknown> = {};
    if (actor) {
      request[AUTHENTICATED_ACTOR_KEY] = actor;
    }

    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as ExecutionContext;

    return context;
  }

  it('allows access when the actor session version matches the user', async () => {
    const userRepository = new InMemoryUserRepository();
    await userRepository.save(createActiveUser({ sessionVersion: 2 }));

    const guard = new SessionVersionGuard(userRepository);
    const context = createExecutionContext(createActor(2));

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('rejects access when the actor session version is stale', async () => {
    const userRepository = new InMemoryUserRepository();
    await userRepository.save(createActiveUser({ sessionVersion: 3 }));

    const guard = new SessionVersionGuard(userRepository);
    const context = createExecutionContext(createActor(2));

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(StaleSessionVersionException);
  });

  it('rejects access when the authenticated user is missing', async () => {
    const guard = new SessionVersionGuard(new InMemoryUserRepository());
    const context = createExecutionContext(createActor(1));

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(InvalidAccessTokenException);
  });

  it('rejects access when the actor is missing from the request', async () => {
    const userRepository = new InMemoryUserRepository();
    await userRepository.save(createActiveUser());

    const guard = new SessionVersionGuard(userRepository);
    const context = createExecutionContext();

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(InvalidAccessTokenException);
  });

  it('rejects suspended users', async () => {
    const userRepository = new InMemoryUserRepository();
    await userRepository.save(
      createActiveUser({ status: UserStatus.Suspended, emailVerified: true }),
    );

    const guard = new SessionVersionGuard(userRepository);
    const context = createExecutionContext(createActor(1));

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(AccountSuspendedException);
  });
});
