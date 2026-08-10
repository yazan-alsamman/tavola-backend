import { PlatformAdminRestoreOrganizationUseCase } from './platform-admin-restore-organization.use-case';
import { OrganizationNotFoundException } from '../../domain/exceptions/organization-not-found.exception';
import { OrganizationNotSoftDeletedException } from '../../domain/exceptions/organization-not-soft-deleted.exception';
import { OrganizationRestoredEvent } from '../../domain/events/organization.events';
import { Organization } from '../../domain/entities/organization.entity';
import { OrganizationStatus } from '../../domain/enums/organization.enums';
import {
  CollectingEventPublisher,
  FixedClock,
  InMemoryOrganizationRepository,
  RecordingTenantContextPort,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';

describe('PlatformAdminRestoreOrganizationUseCase', () => {
  const now = new Date('2026-08-10T12:00:00.000Z');
  const deletedAt = new Date('2026-08-05T00:00:00.000Z');
  const organizationId = '11111111-1111-4111-8111-111111111111';
  const actorId = '22222222-2222-4222-8222-222222222222';

  function build() {
    const organizationRepository = new InMemoryOrganizationRepository();
    const tenantContext = new RecordingTenantContextPort();
    const eventPublisher = new CollectingEventPublisher();
    const useCase = new PlatformAdminRestoreOrganizationUseCase(
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

  it('restores a soft-deleted Organization and Explicit-Tenant-Rebinds with actorType PlatformAdmin (pure Pattern 1)', async () => {
    const { useCase, organizationRepository, tenantContext } = build();
    await seedOrganization(organizationRepository, { deletedAt });

    const result = await useCase.execute({ organizationId, actorId });

    expect(result.deletedAt).toBeNull();
    expect(tenantContext.boundContexts[0]).toMatchObject({
      organizationId,
      actorType: 'PlatformAdmin',
    });
  });

  it('restoring a Suspended-and-deleted Organization clears deletedAt but leaves status Suspended (separate Reactivate call required)', async () => {
    const { useCase, organizationRepository } = build();
    await seedOrganization(organizationRepository, {
      status: OrganizationStatus.Suspended,
      deletedAt,
    });

    const result = await useCase.execute({ organizationId, actorId });

    expect(result.deletedAt).toBeNull();
    expect(result.status).toBe(OrganizationStatus.Suspended);
  });

  it('publishes OrganizationRestoredEvent', async () => {
    const { useCase, organizationRepository, eventPublisher } = build();
    await seedOrganization(organizationRepository, { deletedAt });

    await useCase.execute({ organizationId, actorId, correlationId: 'corr-1' });

    const event = eventPublisher.events[0] as OrganizationRestoredEvent;
    expect(event).toBeInstanceOf(OrganizationRestoredEvent);
    expect(event.payload).toEqual({ organizationId, actorId });
    expect(event.correlationId).toBe('corr-1');
  });

  it('rejects (409) restoring an Organization that is not currently deleted, rather than a silent no-op', async () => {
    const { useCase, organizationRepository, eventPublisher } = build();
    await seedOrganization(organizationRepository);

    await expect(useCase.execute({ organizationId, actorId })).rejects.toThrow(
      OrganizationNotSoftDeletedException,
    );
    expect(eventPublisher.events).toHaveLength(0);
  });

  it('rejects an unknown Organization id (IDOR-safe)', async () => {
    const { useCase } = build();

    await expect(useCase.execute({ organizationId, actorId })).rejects.toThrow(
      OrganizationNotFoundException,
    );
  });
});
