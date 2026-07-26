import { Entity } from '@shared/domain/base/entity.base';
import { BranchId, RestaurantId, UserId } from '@shared/domain/value-objects/identifiers.vo';
import { WaitlistStatus } from '../enums/waitlist.enums';
import { InvalidWaitlistEntryException } from '../exceptions/invalid-waitlist-entry.exception';
import { InvalidWaitlistStatusTransitionException } from '../exceptions/invalid-waitlist-status-transition.exception';

export interface ReservationWaitlistEntryProps {
  id: string;
  restaurantId: string;
  branchId: string;
  userId: string | null;
  reservationGuestId: string | null;
  partySize: number;
  preferredDate: Date;
  preferredTimeFrom: Date;
  preferredTimeTo: Date | null;
  status: WaitlistStatus;
  position: number;
  convertedReservationId: string | null;
  notifiedAt: Date | null;
  expiresAt: Date;
  notes: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/**
 * ReservationWaitlistEntry Aggregate (DOMAIN_MODEL.md "Reservation Waitlist
 * Aggregate", Phase 7.5 architecture freeze). Exactly one of
 * `userId`/`reservationGuestId` must be set (freeze item 5, mirroring
 * `Reservation`'s own XOR invariant). The frozen state machine (freeze item
 * 6): `Waiting -> {Notified, Converted, Cancelled, Expired}`,
 * `Notified -> {Converted, Cancelled, Expired}`; `Converted`/`Cancelled`/
 * `Expired` are terminal. `position` is immutable once assigned (freeze item
 * 13) - no method on this entity ever changes it. Carries no direct
 * `organizationId` (Phase 7.5 tenancy correction, 2026-07-24, superseding the
 * originally-documented shape) - tenant ownership is resolved transitively
 * (`branchId -> Branch.restaurantId -> Restaurant.organizationId`), exactly
 * like `Reservation` itself, since a required direct `organizationId` cannot
 * be populated for a Customer-initiated Join (no bound `TenantContext`).
 */
export class ReservationWaitlistEntry extends Entity<ReservationWaitlistEntryProps> {
  private static readonly ALLOWED_TRANSITIONS: Readonly<
    Record<WaitlistStatus, readonly WaitlistStatus[]>
  > = {
    [WaitlistStatus.Waiting]: [
      WaitlistStatus.Notified,
      WaitlistStatus.Converted,
      WaitlistStatus.Cancelled,
      WaitlistStatus.Expired,
    ],
    [WaitlistStatus.Notified]: [
      WaitlistStatus.Converted,
      WaitlistStatus.Cancelled,
      WaitlistStatus.Expired,
    ],
    [WaitlistStatus.Converted]: [],
    [WaitlistStatus.Cancelled]: [],
    [WaitlistStatus.Expired]: [],
  };

  private constructor(props: ReservationWaitlistEntryProps) {
    super(props);
  }

  /**
   * The only way a new entry is created (`JoinWaitlistUseCase`). `status` is
   * always `Waiting`, `position` is supplied by the caller (already computed
   * under the branch+preferredDate advisory lock - see
   * `PrismaReservationWaitlistEntryRepository`), `notifiedAt`/
   * `convertedReservationId` always start `null`.
   */
  static create(props: {
    id: string;
    restaurantId: string;
    branchId: string;
    userId: string | null;
    reservationGuestId: string | null;
    partySize: number;
    preferredDate: Date;
    preferredTimeFrom: Date;
    preferredTimeTo: Date | null;
    position: number;
    expiresAt: Date;
    notes: string | null;
    createdBy: string;
    now: Date;
  }): ReservationWaitlistEntry {
    validate(props);
    validateParty(props.userId, props.reservationGuestId);

    return new ReservationWaitlistEntry({
      id: props.id,
      restaurantId: props.restaurantId,
      branchId: props.branchId,
      userId: props.userId,
      reservationGuestId: props.reservationGuestId,
      partySize: props.partySize,
      preferredDate: props.preferredDate,
      preferredTimeFrom: props.preferredTimeFrom,
      preferredTimeTo: props.preferredTimeTo,
      status: WaitlistStatus.Waiting,
      position: props.position,
      convertedReservationId: null,
      notifiedAt: null,
      expiresAt: props.expiresAt,
      notes: props.notes,
      createdBy: props.createdBy,
      createdAt: props.now,
      updatedAt: props.now,
      deletedAt: null,
    });
  }

  static reconstitute(props: ReservationWaitlistEntryProps): ReservationWaitlistEntry {
    return new ReservationWaitlistEntry({ ...props });
  }

  get entryId(): string {
    return this.props.id;
  }

  get restaurantId(): RestaurantId {
    return RestaurantId.create(this.props.restaurantId);
  }

  get branchId(): BranchId {
    return BranchId.create(this.props.branchId);
  }

  get userId(): UserId | null {
    return this.props.userId ? UserId.create(this.props.userId) : null;
  }

  get reservationGuestId(): string | null {
    return this.props.reservationGuestId;
  }

  get partySize(): number {
    return this.props.partySize;
  }

  get preferredDate(): Date {
    return new Date(this.props.preferredDate.getTime());
  }

  get preferredTimeFrom(): Date {
    return new Date(this.props.preferredTimeFrom.getTime());
  }

  get preferredTimeTo(): Date | null {
    return this.props.preferredTimeTo ? new Date(this.props.preferredTimeTo.getTime()) : null;
  }

  get status(): WaitlistStatus {
    return this.props.status;
  }

  get position(): number {
    return this.props.position;
  }

  get convertedReservationId(): string | null {
    return this.props.convertedReservationId;
  }

  get notifiedAt(): Date | null {
    return this.props.notifiedAt ? new Date(this.props.notifiedAt.getTime()) : null;
  }

  get expiresAt(): Date {
    return new Date(this.props.expiresAt.getTime());
  }

  get notes(): string | null {
    return this.props.notes;
  }

  get createdBy(): string {
    return this.props.createdBy;
  }

  get createdAt(): Date {
    return new Date(this.props.createdAt.getTime());
  }

  get updatedAt(): Date {
    return new Date(this.props.updatedAt.getTime());
  }

  get deletedAt(): Date | null {
    return this.props.deletedAt ? new Date(this.props.deletedAt.getTime()) : null;
  }

  /** Reserved for Phase 7.6 (Operational Signals) - no Phase 7.5 use case
   *  calls this method (Phase 7.5 architecture freeze item 15's own note:
   *  the entity method and event class exist so Phase 7.6 has something to
   *  call). */
  notify(at: Date): ReservationWaitlistEntry {
    this.assertTransition(WaitlistStatus.Notified);
    return ReservationWaitlistEntry.reconstitute({
      ...this.props,
      status: WaitlistStatus.Notified,
      notifiedAt: at,
      updatedAt: at,
    });
  }

  /**
   * `WaitlistPromotionService`'s claim step - transitions to `Converted` and
   * sets `convertedReservationId` (frozen immutable once set, DOMAIN_MODEL.md
   * invariant). Never called directly by a controller.
   */
  convert(reservationId: string, at: Date): ReservationWaitlistEntry {
    this.assertTransition(WaitlistStatus.Converted);
    return ReservationWaitlistEntry.reconstitute({
      ...this.props,
      status: WaitlistStatus.Converted,
      convertedReservationId: reservationId,
      updatedAt: at,
    });
  }

  cancel(at: Date): ReservationWaitlistEntry {
    this.assertTransition(WaitlistStatus.Cancelled);
    return ReservationWaitlistEntry.reconstitute({
      ...this.props,
      status: WaitlistStatus.Cancelled,
      updatedAt: at,
    });
  }

  /** BullMQ-driven expiration job only - no public endpoint. */
  expire(at: Date): ReservationWaitlistEntry {
    this.assertTransition(WaitlistStatus.Expired);
    return ReservationWaitlistEntry.reconstitute({
      ...this.props,
      status: WaitlistStatus.Expired,
      updatedAt: at,
    });
  }

  private assertTransition(target: WaitlistStatus): void {
    const allowed = ReservationWaitlistEntry.ALLOWED_TRANSITIONS[this.props.status];
    if (!allowed.includes(target)) {
      throw new InvalidWaitlistStatusTransitionException(
        `Cannot transition waitlist entry status from "${this.props.status}" to "${target}".`,
      );
    }
  }

  toProps(): Readonly<ReservationWaitlistEntryProps> {
    return { ...this.props };
  }
}

function validate(props: { partySize: number }): void {
  if (!Number.isInteger(props.partySize) || props.partySize <= 0) {
    throw new InvalidWaitlistEntryException('partySize must be a positive integer.');
  }
}

/**
 * Mirrors `Reservation`'s own `validateParty` (Phase 7.4 decision #5) -
 * DOMAIN_MODEL.md: "Exactly one of userId or reservationGuestId must be set."
 */
function validateParty(userId: string | null, reservationGuestId: string | null): void {
  const hasUser = userId !== null;
  const hasGuest = reservationGuestId !== null;
  if (hasUser === hasGuest) {
    throw new InvalidWaitlistEntryException(
      'A waitlist entry must reference exactly one of userId or reservationGuestId, never both and never neither.',
    );
  }
}
