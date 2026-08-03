import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { UnitOfWorkPort, UNIT_OF_WORK } from '@shared/application/ports/unit-of-work.port';
import {
  TenantContextPort,
  TENANT_CONTEXT_PORT,
} from '@shared/application/ports/tenant-context.port';
import { SubscriptionPlanId } from '@shared/domain/value-objects/identifiers.vo';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import {
  RestaurantUsageRepository,
  RESTAURANT_USAGE_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant-usage.repository';
import { Subscription } from '../../domain/entities/subscription.entity';
import { SubscriptionPlan } from '../../domain/entities/subscription-plan.entity';
import { SubscriptionUsage } from '../../domain/entities/subscription-usage.entity';
import { SubscriptionStatus } from '../../domain/enums/subscription.enums';
import {
  SubscriptionRepository,
  SUBSCRIPTION_REPOSITORY,
} from '../../domain/repositories/subscription.repository';
import {
  SubscriptionPlanRepository,
  SUBSCRIPTION_PLAN_REPOSITORY,
} from '../../domain/repositories/subscription-plan.repository';
import {
  SubscriptionUsageRepository,
  SUBSCRIPTION_USAGE_REPOSITORY,
} from '../../domain/repositories/subscription-usage.repository';
import { SubscriptionPlanNotFoundException } from '../../domain/exceptions/subscription-plan-not-found.exception';
import { ArchivedPlanNotAssignableException } from '../../domain/exceptions/archived-plan-not-assignable.exception';
import { InvalidSubscriptionStatusTransitionException } from '../../domain/exceptions/invalid-subscription-status-transition.exception';
import { SubscriptionPolicy } from '../../domain/services/subscription-policy';
import {
  SubscriptionAssignedEvent,
  SubscriptionPlanChangedEvent,
} from '../../domain/events/subscription.events';
import {
  SubscriptionExpirationSchedulerPort,
  SUBSCRIPTION_EXPIRATION_SCHEDULER,
} from '../ports/subscription-expiration-scheduler.port';
import { toSubscriptionResult } from '../mappers/subscription-result.mapper';
import { AssignSubscriptionCommand } from '../dto/assign-subscription.command';
import { SubscriptionResult } from '../dto/subscription.result';

/** Large enough that no real Organization's restaurant count is ever paginated away - PlatformAdmin-only, low-frequency, not a hot path. See ADR-027 D13/D15. */
const MAX_RESTAURANTS_PER_DOWNGRADE_CHECK = 5000;

/**
 * PlatformAdmin-only (D9). ADR-027 §7 - the single `POST
 * .../organizations/:id/subscription` endpoint serves three outcomes,
 * branching on the Organization's current Subscription state (no separate
 * "change plan" endpoint was frozen):
 *
 *  - No Subscription row exists yet (defensive - every Organization is
 *    provisioned with a default one at creation, ADR-027 §11) -> create,
 *    Active, `SubscriptionAssigned`.
 *  - `Cancelled` or `Expired` -> `reassign()`, Active,
 *    `SubscriptionAssigned` (an implementation-time reconciliation
 *    extending `reassign()` to also cover `Expired` - see that method's own
 *    doc comment).
 *  - `Active` -> `changePlan()` (immediate, no `effectiveAt`), downgrade
 *    validated first (D13), `SubscriptionPlanChanged`.
 *  - `Suspended` -> rejected; PlatformAdmin must `Reactivate` first (D8's
 *    frozen state machine keeps these as two structurally distinct resume
 *    paths).
 *
 * Binds `TenantContext` to the *target* Organization's id first
 * (`TenantContextPort`, mirroring `ProvisionRestaurantOwnerUseCase`'s
 * bootstrap pattern) - `PlatformAdminGuard` never runs
 * `TenantContextInterceptor`, so no context is otherwise bound for this
 * cross-tenant-by-URL-parameter action.
 */
@Injectable()
export class AssignSubscriptionUseCase {
  constructor(
    @Inject(SUBSCRIPTION_REPOSITORY)
    private readonly subscriptionRepository: SubscriptionRepository,
    @Inject(SUBSCRIPTION_PLAN_REPOSITORY)
    private readonly subscriptionPlanRepository: SubscriptionPlanRepository,
    @Inject(SUBSCRIPTION_USAGE_REPOSITORY)
    private readonly subscriptionUsageRepository: SubscriptionUsageRepository,
    @Inject(RESTAURANT_USAGE_REPOSITORY)
    private readonly restaurantUsageRepository: RestaurantUsageRepository,
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(SUBSCRIPTION_EXPIRATION_SCHEDULER)
    private readonly expirationScheduler: SubscriptionExpirationSchedulerPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
  ) {}

  async execute(command: AssignSubscriptionCommand): Promise<SubscriptionResult> {
    return this.tenantContext.runAsync(
      {
        organizationId: command.organizationId,
        userId: null,
        correlationId: command.correlationId ?? command.organizationId,
      },
      () => this.assign(command),
    );
  }

  private async assign(command: AssignSubscriptionCommand): Promise<SubscriptionResult> {
    const planId = SubscriptionPlanId.create(command.planId);
    const plan = await this.subscriptionPlanRepository.findById(planId);
    if (plan === null) {
      throw new SubscriptionPlanNotFoundException();
    }
    if (plan.isArchived()) {
      throw new ArchivedPlanNotAssignableException();
    }

    const existing = await this.subscriptionRepository.findByOrganizationId();
    const now = this.clock.now();

    if (existing === null) {
      return this.createFresh(command, plan.planId.value, now);
    }

    if (existing.status === SubscriptionStatus.Suspended) {
      throw new InvalidSubscriptionStatusTransitionException(
        'Subscription is Suspended - reactivate before assigning a plan.',
      );
    }

    if (
      existing.status === SubscriptionStatus.Cancelled ||
      existing.status === SubscriptionStatus.Expired
    ) {
      return this.reassign(command, existing, plan.planId.value, now);
    }

    return this.changePlan(command, existing, plan, now);
  }

  private async createFresh(
    command: AssignSubscriptionCommand,
    planId: string,
    now: Date,
  ): Promise<SubscriptionResult> {
    const subscription = Subscription.create({
      id: this.idGenerator.generate(),
      organizationId: command.organizationId,
      subscriptionPlanId: planId,
      startsAt: now,
      endsAt: command.endsAt ?? null,
      now,
    });
    const usage = SubscriptionUsage.create({
      id: this.idGenerator.generate(),
      organizationId: command.organizationId,
      now,
    });

    await this.unitOfWork.execute(async () => {
      await this.subscriptionRepository.create(subscription);
      await this.subscriptionUsageRepository.create(usage);
    });

    await this.syncExpirationSchedule(subscription, command);
    await this.publishAssigned(command, subscription, now);
    return toSubscriptionResult(subscription);
  }

  private async reassign(
    command: AssignSubscriptionCommand,
    existing: Subscription,
    planId: string,
    now: Date,
  ): Promise<SubscriptionResult> {
    const reassigned = existing.reassign(planId, now, now, command.endsAt ?? null);

    let applied = false;
    await this.unitOfWork.execute(async () => {
      applied = await this.subscriptionRepository.updateIfStatus(reassigned, existing.status);
    });
    if (!applied) {
      throw new InvalidSubscriptionStatusTransitionException(
        'Subscription state changed concurrently - retry.',
      );
    }

    await this.syncExpirationSchedule(reassigned, command);
    await this.publishAssigned(command, reassigned, now);
    return toSubscriptionResult(reassigned);
  }

  private async changePlan(
    command: AssignSubscriptionCommand,
    existing: Subscription,
    plan: SubscriptionPlan,
    now: Date,
  ): Promise<SubscriptionResult> {
    const orgUsage = await this.subscriptionUsageRepository.findByOrganizationId();
    const restaurants = await this.restaurantRepository.findMany(
      1,
      MAX_RESTAURANTS_PER_DOWNGRADE_CHECK,
    );
    const restaurantIds = restaurants.items.map((r) => r.restaurantId);
    const restaurantUsages =
      await this.restaurantUsageRepository.findManyByRestaurantIds(restaurantIds);

    if (orgUsage !== null) {
      SubscriptionPolicy.validatePlanChange(plan, orgUsage, restaurantUsages);
    }

    const oldPlanId = existing.subscriptionPlanId.value;
    const changed = existing.changePlan(plan.planId.value, now);

    let applied = false;
    await this.unitOfWork.execute(async () => {
      applied = await this.subscriptionRepository.updateIfStatus(changed, existing.status);
    });
    if (!applied) {
      throw new InvalidSubscriptionStatusTransitionException(
        'Subscription state changed concurrently - retry.',
      );
    }

    await this.eventPublisher.publish(
      new SubscriptionPlanChangedEvent(
        this.idGenerator.generate(),
        {
          subscriptionId: changed.subscriptionId.value,
          organizationId: command.organizationId,
          oldPlanId,
          newPlanId: plan.planId.value,
          actorId: command.actor.userId,
        },
        now,
        command.correlationId,
      ),
    );

    return toSubscriptionResult(changed);
  }

  /** D11 - schedules BullMQ expiration when `endsAt` is set, cancels any existing job otherwise (indefinite subscriptions have nothing to expire). */
  private async syncExpirationSchedule(
    subscription: Subscription,
    command: AssignSubscriptionCommand,
  ): Promise<void> {
    if (subscription.endsAt !== null) {
      await this.expirationScheduler.scheduleExpiration(
        subscription.subscriptionId.value,
        command.organizationId,
        subscription.endsAt,
        command.correlationId,
      );
    } else {
      await this.expirationScheduler.cancelExpiration(subscription.subscriptionId.value);
    }
  }

  private async publishAssigned(
    command: AssignSubscriptionCommand,
    subscription: Subscription,
    now: Date,
  ): Promise<void> {
    await this.eventPublisher.publish(
      new SubscriptionAssignedEvent(
        this.idGenerator.generate(),
        {
          subscriptionId: subscription.subscriptionId.value,
          organizationId: command.organizationId,
          planId: subscription.subscriptionPlanId.value,
          actorId: command.actor.userId,
        },
        now,
        command.correlationId,
      ),
    );
  }
}
