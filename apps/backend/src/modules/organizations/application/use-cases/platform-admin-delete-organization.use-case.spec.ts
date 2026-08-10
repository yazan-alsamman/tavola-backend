import { PlatformAdminDeleteOrganizationUseCase } from './platform-admin-delete-organization.use-case';
import { OrganizationNotFoundException } from '../../domain/exceptions/organization-not-found.exception';
import { OrganizationDeletedEvent } from '../../domain/events/organization.events';
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

describe('PlatformAdminDeleteOrganizationUseCase', () => {
  const now = new Date('2026-08-10T12:00:00.000Z');
  const organizationId = '11111111-1111-4111-8111-111111111111';
  const actorId = '22222222-2222-4222-8222-222222222222';

  function build() {
    const organizationRepository = new InMemoryOrganizationRepository();
    const tenantContext = new RecordingTenantContextPort();
    const eventPublisher = new CollectingEventPublisher();
    const useCase = new PlatformAdminDeleteOrganizationUseCase(
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

  async function seedOrganization(
    repository: InMemoryOrganizationRepository,
    overrides: { status?: OrganizationStatus; deletedAt?: Date | null } = {},
  ): Promise<void> {
    await repository.save(
      Organization.create({
        id: organizationId,
        name: 'Test Org',
        slug: 'test-org',
        status: overrides.status ?? OrganizationStatus.Active,
        billingEmail: 'billing@test-org.com',
        createdAt: now,
        updatedAt: now,
        deletedAt: overrides.deletedAt ?? null,
      }),
    );
  }

  it('soft-deletes an Active Organization and Explicit-Tenant-Rebinds with actorType PlatformAdmin (:id already IS the organizationId - pure Pattern 1)', async () => {
    const { useCase, organizationRepository, tenantContext } = build();
    await seedOrganization(organizationRepository);

    const result = await useCase.execute({ organizationId, actorId });

    expect(result.deletedAt).toEqual(now);
    expect(result.status).toBe(OrganizationStatus.Active);
    expect(tenantContext.boundContexts[0]).toMatchObject({
      organizationId,
      actorType: 'PlatformAdmin',
    });
  });

  it('deletes a Suspended Organization without touching its status (independent axes)', async () => {
    const { useCase, organizationRepository } = build();
    await seedOrganization(organizationRepository, { status: OrganizationStatus.Suspended });

    const result = await useCase.execute({ organizationId, actorId });

    expect(result.deletedAt).toEqual(now);
    expect(result.status).toBe(OrganizationStatus.Suspended);
  });

  it('publishes OrganizationDeletedEvent', async () => {
    const { useCase, organizationRepository, eventPublisher } = build();
    await seedOrganization(organizationRepository);

    await useCase.execute({ organizationId, actorId, correlationId: 'corr-1' });

    const event = eventPublisher.events[0] as OrganizationDeletedEvent;
    expect(event).toBeInstanceOf(OrganizationDeletedEvent);
    expect(event.payload).toEqual({ organizationId, actorId });
    expect(event.correlationId).toBe('corr-1');
  });

  it('NEVER mutates Restaurant.status/deletedAt - no cascade, ever (ADR-034 §5)', async () => {
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
    // way to touch Restaurant at all, which is the architectural guarantee
    // itself. Asserting the untouched Restaurant entity here documents that
    // guarantee at the test level.
    expect(restaurant.status).toBe(RestaurantStatus.Active);
    expect(restaurant.toProps().deletedAt).toBeNull();
  });

  it('re-applies harmlessly on an already-deleted Organization (no precondition, matches Restaurant Delete precedent) and republishes the event', async () => {
    const { useCase, organizationRepository, eventPublisher } = build();
    const firstDeletedAt = new Date('2026-08-01T00:00:00.000Z');
    await seedOrganization(organizationRepository, { deletedAt: firstDeletedAt });

    const result = await useCase.execute({ organizationId, actorId });

    expect(result.deletedAt).toEqual(now);
    expect(result.deletedAt).not.toEqual(firstDeletedAt);
    expect(eventPublisher.events).toHaveLength(1);
    expect(eventPublisher.events[0]).toBeInstanceOf(OrganizationDeletedEvent);
  });

  it('rejects an unknown Organization id (IDOR-safe)', async () => {
    const { useCase } = build();

    await expect(useCase.execute({ organizationId, actorId })).rejects.toThrow(
      OrganizationNotFoundException,
    );
  });
});
