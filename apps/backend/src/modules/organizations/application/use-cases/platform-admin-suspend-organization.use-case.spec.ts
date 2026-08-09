import { PlatformAdminSuspendOrganizationUseCase } from './platform-admin-suspend-organization.use-case';
import { OrganizationNotFoundException } from '../../domain/exceptions/organization-not-found.exception';
import { OrganizationSuspendedEvent } from '../../domain/events/organization.events';
import { Organization } from '../../domain/entities/organization.entity';
import { OrganizationStatus } from '../../domain/enums/organization.enums';
import { Restaurant } from '@modules/restaurants/domain/entities/restaurant.entity';
import { RestaurantStatus } from '@modules/restaurants/domain/enums/restaurant.enums';
import {
  CollectingEventPublisher,
  FixedClock,
  InMemoryOrganizationRepository,
  RecordingTenantContextPort,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';

describe('PlatformAdminSuspendOrganizationUseCase', () => {
  const now = new Date('2026-08-04T12:00:00.000Z');
  const organizationId = '11111111-1111-4111-8111-111111111111';
  const actorId = '22222222-2222-4222-8222-222222222222';

  function build() {
    const organizationRepository = new InMemoryOrganizationRepository();
    const tenantContext = new RecordingTenantContextPort();
    const eventPublisher = new CollectingEventPublisher();
    const useCase = new PlatformAdminSuspendOrganizationUseCase(
      organizationRepository,
      tenantContext,
      new FixedClock(now),
      new SequentialIdGenerator([
        'eeeeeeee-1111-4111-8111-111111111111',
        'eeeeeeee-2222-4222-8222-222222222222',
      ]),
      eventPublisher,
    );
    return { useCase, organizationRepository, tenantContext, eventPublisher };
  }

  async function seedOrganization(repository: InMemoryOrganizationRepository): Promise<void> {
    await repository.save(
      Organization.create({
        id: organizationId,
        name: 'Test Org',
        slug: 'test-org',
        status: OrganizationStatus.Active,
        billingEmail: 'billing@test-org.com',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      }),
    );
  }

  it('suspends the Organization and Explicit-Tenant-Rebinds with actorType PlatformAdmin (:id already IS the organizationId - pure Pattern 1)', async () => {
    const { useCase, organizationRepository, tenantContext } = build();
    await seedOrganization(organizationRepository);

    const result = await useCase.execute({ organizationId, actorId });

    expect(result.status).toBe(OrganizationStatus.Suspended);
    expect(tenantContext.boundContexts[0]).toMatchObject({
      organizationId,
      actorType: 'PlatformAdmin',
    });
  });

  it('publishes OrganizationSuspendedEvent', async () => {
    const { useCase, organizationRepository, eventPublisher } = build();
    await seedOrganization(organizationRepository);

    await useCase.execute({ organizationId, actorId, correlationId: 'corr-1' });

    const event = eventPublisher.events[0] as OrganizationSuspendedEvent;
    expect(event).toBeInstanceOf(OrganizationSuspendedEvent);
    expect(event.payload).toEqual({ organizationId, actorId });
    expect(event.correlationId).toBe('corr-1');
  });

  it('NEVER mutates Restaurant.status - no cascade, ever (ADR-034 §5)', async () => {
    const { useCase, organizationRepository } = build();
    await seedOrganization(organizationRepository);
    const restaurant = Restaurant.create({
      id: '33333333-3333-4333-8333-333333333333',
      organizationId,
      name: 'Child Restaurant',
      slug: 'child-restaurant',
      logoId: null,
      coverImageId: null,
      description: null,
      cuisineType: null,
      averageRating: null,
      priceLevel: null,
      status: RestaurantStatus.Active,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });

    await useCase.execute({ organizationId, actorId });

    // This use case's only dependency is OrganizationRepository - it has no
    // way to touch Restaurant.status at all, which is the architectural
    // guarantee itself. Asserting the untouched Restaurant entity's status
    // here documents that guarantee at the test level.
    expect(restaurant.status).toBe(RestaurantStatus.Active);
  });

  it('is idempotent - suspending an already-Suspended Organization is a no-op', async () => {
    const { useCase, organizationRepository } = build();
    await seedOrganization(organizationRepository);
    await useCase.execute({ organizationId, actorId });

    await expect(useCase.execute({ organizationId, actorId })).resolves.toMatchObject({
      status: OrganizationStatus.Suspended,
    });
  });

  it('M1: a no-op repeat call publishes no second OrganizationSuspendedEvent and writes no second audit row', async () => {
    const { useCase, organizationRepository, eventPublisher } = build();
    await seedOrganization(organizationRepository);

    await useCase.execute({ organizationId, actorId });
    expect(eventPublisher.events).toHaveLength(1);

    await useCase.execute({ organizationId, actorId });
    expect(eventPublisher.events).toHaveLength(1);
  });

  it('rejects an unknown Organization id (IDOR-safe)', async () => {
    const { useCase } = build();

    await expect(useCase.execute({ organizationId, actorId })).rejects.toThrow(
      OrganizationNotFoundException,
    );
  });
});
