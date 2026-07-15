import { GetCurrentUserPreferencesUseCase } from './get-current-user-preferences.use-case';
import { RegistrationPolicy } from '@modules/authentication/domain/services/registration-policy';
import { Email } from '@shared/domain/value-objects/email.vo';
import { PasswordHash } from '@shared/domain/value-objects/password-hash.vo';
import { UserNotFoundException } from '@modules/authentication/application/exceptions/user-not-found.exception';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { InMemoryUserRepository } from '../../../../../test/authentication/support/in-memory-registration.dependencies';

describe('GetCurrentUserPreferencesUseCase', () => {
  const fixedNow = new Date('2026-07-15T12:00:00.000Z');
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

  async function seedUser(userRepository: InMemoryUserRepository): Promise<void> {
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
  }

  it('returns the default opt-in values for a newly registered user', async () => {
    const userRepository = new InMemoryUserRepository();
    await seedUser(userRepository);

    const useCase = new GetCurrentUserPreferencesUseCase(userRepository);
    const result = await useCase.execute({ actor: baseActor() });

    expect(result).toEqual({
      userId,
      notificationOptIn: true,
      marketingOptIn: false,
      updatedAt: expect.any(Date),
    });
  });

  it('never includes profile or Authentication-internal fields', async () => {
    const userRepository = new InMemoryUserRepository();
    await seedUser(userRepository);

    const useCase = new GetCurrentUserPreferencesUseCase(userRepository);
    const result = await useCase.execute({ actor: baseActor() });

    expect(result).not.toHaveProperty('firstName');
    expect(result).not.toHaveProperty('language');
    expect(result).not.toHaveProperty('preferredCurrency');
    expect(result).not.toHaveProperty('passwordHash');
    expect(result).not.toHaveProperty('status');
  });

  it('throws UserNotFoundException when the actor has no matching user', async () => {
    const userRepository = new InMemoryUserRepository();
    const useCase = new GetCurrentUserPreferencesUseCase(userRepository);

    await expect(useCase.execute({ actor: baseActor() })).rejects.toBeInstanceOf(
      UserNotFoundException,
    );
  });
});
