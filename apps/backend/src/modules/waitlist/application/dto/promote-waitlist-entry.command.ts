import { AuthenticatedEmployeeActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

/**
 * No start/end time in the request body (Phase 7.5 API surface freeze item
 * 7 + final promotion-slot-semantics decision) - the Employee never supplies
 * an arbitrary slot; the entry's own `preferredDate`/`preferredTimeFrom`
 * drives promotion identically to automatic promotion.
 */
export interface PromoteWaitlistEntryCommand {
  actor: AuthenticatedEmployeeActor;
  entryId: string;
  correlationId?: string;
}
