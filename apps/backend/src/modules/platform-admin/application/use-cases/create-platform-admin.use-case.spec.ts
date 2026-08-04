import { CreatePlatformAdminUseCase } from './create-platform-admin.use-case';
import {
  PlatformAdminAuthContext,
  PlatformAdminListPage,
  PlatformAdminRecord,
  PlatformAdminRepository,
} from '../../domain/repositories/platform-admin.repository';
import { PlatformAdminRole } from '../../domain/enums/platform-admin.enums';
import { PlatformAdminAccountCreatedEvent } from '../../domain/events/platform-admin.events';
import { EmailAlreadyExistsException } from '@modules/authentication/domain/exceptions/email-already-exists.exception';
import { Email } from '@shared/domain/value-objects/email.vo';
import {
  CollectingEventPublisher,
  FakePasswordHasher,
  FixedClock,
  ImmediateUnitOfWork,
  InMemoryUserRepository,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';

class FakePlatformAdminRepository implements PlatformAdminRepository {
  readonly rows = new Map<string, PlatformAdminRecord>();

  async findActiveAdminContext(): Promise<PlatformAdminAuthContext | null> {
    throw new Error('Not needed by this suite.');
  }
  async findById(id: string): Promise<PlatformAdminRecord | null> {
    return this.rows.get(id) ?? null;
  }
  async findByUserId(): Promise<PlatformAdminRecord | null> {
    throw new Error('Not needed by this suite.');
  }
  async list(): Promise<PlatformAdminListPage> {
    throw new Error('Not needed by this suite.');
  }
  async create(record: PlatformAdminRecord): Promise<void> {
    this.rows.set(record.id, record);
  }
  async updateRole(): Promise<void> {
    throw new Error('Not needed by this suite.');
  }
  async revoke(): Promise<void> {
    throw new Error('Not needed by this suite.');
  }
  async reactivate(): Promise<void> {
    throw new Error('Not needed by this suite.');
  }
}

describe('CreatePlatformAdminUseCase', () => {
  const now = new Date('2026-08-04T12:00:00.000Z');
  const requestingAdminId = '11111111-1111-4111-8111-111111111111';

  function build() {
    const userRepository = new InMemoryUserRepository();
    const platformAdminRepository = new FakePlatformAdminRepository();
    const eventPublisher = new CollectingEventPublisher();
    const useCase = new CreatePlatformAdminUseCase(
      userRepository,
      platformAdminRepository,
      new FakePasswordHasher(),
      new ImmediateUnitOfWork(),
      eventPublisher,
      new FixedClock(now),
      new SequentialIdGenerator([
        'aaaaaaaa-1111-4111-8111-111111111111',
        'bbbbbbbb-2222-4222-8222-222222222222',
        'cccccccc-3333-4333-8333-333333333333',
        'dddddddd-4444-4444-8444-444444444444',
        'eeeeeeee-5555-4555-8555-555555555555',
        'ffffffff-6666-4666-8666-666666666666',
      ]),
    );
    return { useCase, userRepository, platformAdminRepository, eventPublisher };
  }

  it('creates a User immediately Active/emailVerified and a PlatformAdmin row with the requested role', async () => {
    const { useCase, userRepository, platformAdminRepository } = build();

    const result = await useCase.execute({
      email: 'newsupport@tavla.internal',
      password: 'SecurePass123!',
      firstName: 'New',
      lastName: 'Support',
      role: PlatformAdminRole.PlatformSupport,
      actorId: requestingAdminId,
    });

    expect(result.role).toBe(PlatformAdminRole.PlatformSupport);
    expect(result.email).toBe('newsupport@tavla.internal');
    expect(platformAdminRepository.rows.size).toBe(1);
    const savedUser = await userRepository.findByEmail(Email.create('newsupport@tavla.internal'));
    expect(savedUser?.emailVerified).toBe(true);
  });

  it('publishes PlatformAdminAccountCreatedEvent attributing the requesting admin as actor', async () => {
    const { useCase, eventPublisher } = build();

    await useCase.execute({
      email: 'newsupport@tavla.internal',
      password: 'SecurePass123!',
      firstName: 'New',
      lastName: 'Support',
      role: PlatformAdminRole.PlatformSupport,
      actorId: requestingAdminId,
    });

    const event = eventPublisher.events[0] as PlatformAdminAccountCreatedEvent;
    expect(event).toBeInstanceOf(PlatformAdminAccountCreatedEvent);
    expect(event.payload.actorId).toBe(requestingAdminId);
    expect(event.payload.role).toBe(PlatformAdminRole.PlatformSupport);
  });

  it('rejects a duplicate email with EmailAlreadyExistsException, matching every other provisioning use case', async () => {
    const { useCase } = build();
    await useCase.execute({
      email: 'dup@tavla.internal',
      password: 'SecurePass123!',
      firstName: 'A',
      lastName: 'B',
      role: PlatformAdminRole.PlatformSupport,
      actorId: requestingAdminId,
    });

    await expect(
      useCase.execute({
        email: 'dup@tavla.internal',
        password: 'SecurePass123!',
        firstName: 'C',
        lastName: 'D',
        role: PlatformAdminRole.PlatformAdmin,
        actorId: requestingAdminId,
      }),
    ).rejects.toThrow(EmailAlreadyExistsException);
  });
});
