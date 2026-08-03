import { GetOrganizationSubscriptionUseCase } from './get-organization-subscription.use-case';
import { Subscription } from '../../domain/entities/subscription.entity';
import { SubscriptionStatus } from '../../domain/enums/subscription.enums';
import { SubscriptionNotFoundException } from '../../domain/exceptions/subscription-not-found.exception';
import { InMemorySubscriptionRepository } from '../../../../../test/subscriptions/support/in-memory-subscription.repository';
import { RecordingTenantContextPort } from '../../../../../test/authentication/support/in-memory-registration.dependencies';

describe('GetOrganizationSubscriptionUseCase', () => {
  const now = new Date('2026-07-28T12:00:00.000Z');
  const organizationId = '11111111-1111-4111-8111-111111111111';
  const planId = '22222222-2222-4222-8222-222222222222';
  const subscriptionId = '33333333-3333-4333-8333-333333333333';

  function build(repository: InMemorySubscriptionRepository) {
    const tenantContext = new RecordingTenantContextPort();
    const useCase = new GetOrganizationSubscriptionUseCase(repository, tenantContext);
    return { useCase, tenantContext };
  }

  it('returns the current subscription for the given organizationId', async () => {
    const repository = new InMemorySubscriptionRepository(organizationId);
    await repository.create(
      Subscription.create({
        id: subscriptionId,
        organizationId,
        subscriptionPlanId: planId,
        startsAt: now,
        now,
      }),
    );
    const { useCase } = build(repository);

    const result = await useCase.execute(organizationId);

    expect(result).toEqual({
      subscriptionId,
      organizationId,
      planId,
      status: SubscriptionStatus.Active,
      startsAt: now,
      endsAt: null,
    });
  });

  it('(re)binds TenantContext to the requested organizationId - the only way this resolves for a PlatformAdmin caller', async () => {
    const repository = new InMemorySubscriptionRepository(organizationId);
    await repository.create(
      Subscription.create({
        id: subscriptionId,
        organizationId,
        subscriptionPlanId: planId,
        startsAt: now,
        now,
      }),
    );
    const { useCase, tenantContext } = build(repository);

    await useCase.execute(organizationId);

    expect(tenantContext.boundContexts).toHaveLength(1);
    expect(tenantContext.boundContexts[0]).toMatchObject({ organizationId, userId: null });
  });

  it('throws SubscriptionNotFoundException when the organization has no subscription', async () => {
    const repository = new InMemorySubscriptionRepository(organizationId);
    const { useCase } = build(repository);

    await expect(useCase.execute(organizationId)).rejects.toBeInstanceOf(
      SubscriptionNotFoundException,
    );
  });
});
