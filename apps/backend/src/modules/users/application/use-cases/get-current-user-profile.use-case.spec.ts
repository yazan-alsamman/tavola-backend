import { GetCurrentUserProfileUseCase } from './get-current-user-profile.use-case';
import { RegistrationPolicy } from '@modules/authentication/domain/services/registration-policy';
import { Email } from '@shared/domain/value-objects/email.vo';
import { PasswordHash } from '@shared/domain/value-objects/password-hash.vo';
import { UserNotFoundException } from '@modules/authentication/application/exceptions/user-not-found.exception';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { InMemoryUserRepository } from '../../../../../test/authentication/support/in-memory-registration.dependencies';

describe('GetCurrentUserProfileUseCase', () => {
  const fixedNow = new Date('2026-07-07T12:00:00.000Z');
  const userId = '11111111-1111-4111-8111-111111111111';

  function baseActor() {
    return {
      userId,
      sessionId: '22222222-2222-4222-8222-222222222222',
      sessionVersion: 1,
      tokenFamilyId: '33333333-3333-4333-8333-333333333333',
      actorType: AccessTokenActorType.User as const,
    };
  }

  it('returns the profile fields for the authenticated actor', async () => {
    const userRepository = new InMemoryUserRepository();
    const user = RegistrationPolicy.createPendingUser({
      id: userId,
      email: Email.create('jane@example.com'),
      passwordHash: PasswordHash.create('argon2id$fake$SecurePass123!'),
      firstName: 'Jane',
      lastName: 'Doe',
      phone: '+963900000000',
      language: 'en',
      at: fixedNow,
    }).verifyEmail(fixedNow);
    await userRepository.save(user);

    const useCase = new GetCurrentUserProfileUseCase(userRepository);
    const result = await useCase.execute({ actor: baseActor() });

    expect(result).toEqual({
      userId,
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      phone: '+963900000000',
      language: 'en',
      preferredCurrency: null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });
  });

  it('never includes passwordHash or other Authentication-internal fields', async () => {
    const userRepository = new InMemoryUserRepository();
    const user = RegistrationPolicy.createPendingUser({
      id: userId,
      email: Email.create('jane@example.com'),
      passwordHash: PasswordHash.create('argon2id$fake$SecurePass123!'),
      firstName: 'Jane',
      lastName: 'Doe',
      phone: null,
      language: 'en',
      at: fixedNow,
    }).verifyEmail(fixedNow);
    await userRepository.save(user);

    const useCase = new GetCurrentUserProfileUseCase(userRepository);
    const result = await useCase.execute({ actor: baseActor() });

    expect(result).not.toHaveProperty('passwordHash');
    expect(result).not.toHaveProperty('status');
    expect(result).not.toHaveProperty('sessionVersion');
    expect(result).not.toHaveProperty('permissionsVersion');
  });

  it('throws UserNotFoundException when the actor has no matching user', async () => {
    const userRepository = new InMemoryUserRepository();
    const useCase = new GetCurrentUserProfileUseCase(userRepository);

    await expect(useCase.execute({ actor: baseActor() })).rejects.toBeInstanceOf(
      UserNotFoundException,
    );
  });
});
