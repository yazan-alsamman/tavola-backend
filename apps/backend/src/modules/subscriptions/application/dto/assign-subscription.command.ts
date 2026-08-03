import { PlatformAdminActor } from '@modules/platform-admin/application/dto/platform-admin-actor.dto';

/**
 * PlatformAdmin-only (D9). Serves both initial assignment (no Subscription
 * yet, or resuming a `Cancelled`/`Expired` one - `SubscriptionAssigned`) and
 * an immediate plan change on an `Active` Subscription
 * (`SubscriptionPlanChanged`) - one endpoint, `POST
 * .../organizations/:id/subscription`, branches internally on current
 * status (see `AssignSubscriptionUseCase`'s own doc comment for the exact
 * reconciliation). No `effectiveAt` scheduling (D12).
 */
export interface AssignSubscriptionCommand {
  actor: PlatformAdminActor;
  organizationId: string;
  planId: string;
  /** Nullable/omitted = indefinite (D10 default). When set, schedules BullMQ expiration (D11). No advance/future-`startsAt` scheduling (D10/D12) - always takes effect immediately. */
  endsAt?: Date | null;
  correlationId?: string;
}
