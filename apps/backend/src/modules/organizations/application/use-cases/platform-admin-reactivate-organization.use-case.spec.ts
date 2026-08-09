import { PlatformAdminReactivateOrganizationUseCase } from './platform-admin-reactivate-organization.use-case';
import { OrganizationNotFoundException } from '../../domain/exceptions/organization-not-found.exception';
import { OrganizationReactivatedEvent } from '../../domain/events/organization.events';
import { Organization } from '../../domain/entities/organization.entity';
import { OrganizationStatus } from '../../domain/enums/organization.enums';
import {
  CollectingEventPublisher,
  FixedClock,
  InMemoryOrganizationRepository,
  RecordingTenantContextPort,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';

describe('PlatformAdminReactivateOrganizationUseCase', () => {
  const now = new Date('2026-08-06T12:00:00.000Z');
  const organizationId = '11111111-1111-4111-8111-111111111111';
  const actorId = '22222222-2222-4222-8222-222222222222';

  function build() {
    const organizationRepository = new InMemoryOrganizationRepository();
    const tenantContext = new RecordingTenantContextPort();
    const eventPublisher = new CollectingEventPublisher();
    const useCase = new PlatformAdminReactivateOrganizationUseCase(
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

  async function seedSuspendedOrganization(
    repository: InMemoryOrganizationRepository,
  ): Promise<void> {
    await repository.save(
      Organization.create({
        id: organizationId,
        name: 'Test Org',
        slug: 'test-org',
        status: OrganizationStatus.Suspended,
        billingEmail: 'billing@test-org.com',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      }),
    );
  }

  it('reactivates the Organization and Explicit-Tenant-Rebinds with actorType PlatformAdmin', async () => {
    const { useCase, organizationRepository, tenantContext } = build();
    await seedSuspendedOrganization(organizationRepository);

    const result = await useCase.execute({ organizationId, actorId });

    expect(result.status).toBe(OrganizationStatus.Active);
    expect(tenantContext.boundContexts[0]).toMatchObject({
      organizationId,
      actorType: 'PlatformAdmin',
    });
  });

  it('publishes OrganizationReactivatedEvent', async () => {
    const { useCase, organizationRepository, eventPublisher } = build();
    await seedSuspendedOrganization(organizationRepository);

    await useCase.execute({ organizationId, actorId, correlationId: 'corr-1' });

    const event = eventPublisher.events[0] as OrganizationReactivatedEvent;
    expect(event).toBeInstanceOf(OrganizationReactivatedEvent);
    expect(event.payload).toEqual({ organizationId, actorId });
    expect(event.correlationId).toBe('corr-1');
  });

  it('is idempotent - reactivating an already-Active Organization is a no-op', async () => {
    const { useCase, organizationRepository } = build();
    await seedSuspendedOrganization(organizationRepository);
    await useCase.execute({ organizationId, actorId });

    await expect(useCase.execute({ organizationId, actorId })).resolves.toMatchObject({
      status: OrganizationStatus.Active,
    });
  });

  it('M1: a no-op repeat call publishes no second OrganizationReactivatedEvent and writes no second audit row', async () => {
    const { useCase, organizationRepository, eventPublisher } = build();
    await seedSuspendedOrganization(organizationRepository);

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
