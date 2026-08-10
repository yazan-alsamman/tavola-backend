import { Entity } from '@shared/domain/base/entity.base';
import {
  AcquisitionPricingRuleId,
  CustomerAcquisitionId,
  RestaurantId,
} from '@shared/domain/value-objects/identifiers.vo';
import { ReservationSource } from '@modules/reservations/domain/enums/reservation.enums';
import { AcquisitionCreatedVia, AcquisitionStatus } from '../enums/customer-acquisition.enums';
import { AcquisitionAlreadyReversedException } from '../exceptions/acquisition-already-reversed.exception';
import { InvalidCustomerAcquisitionException } from '../exceptions/invalid-customer-acquisition.exception';

export interface CustomerAcquisitionProps {
  id: string;
  restaurantId: string;
  userId: string | null;
  reservationGuestId: string | null;
  sourceReservationId: string | null;
  reservationSource: ReservationSource | null;
  createdVia: AcquisitionCreatedVia;
  status: AcquisitionStatus;
  feeAmount: number;
  feeCurrency: string;
  pricingRuleId: string;
  recordedAt: Date;
  reversedAt: Date | null;
  reversedBy: string | null;
  reversalReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Customer Acquisition Aggregate root (ADR-033, architecture frozen
 * 2026-08-04, implemented 2026-08-09). The platform's financial source of
 * truth: one immutable row per (Restaurant, Customer-Identity) relationship
 * the platform has delivered. Never hard-deleted - `reverse()` is the only
 * correction for an over-count (§10); a `ManualPlatformAdminCorrection` row
 * (see `recordManual`) is the only correction for an under-count (§11).
 * Never a payment/invoice record (§21) - `feeAmount`/`feeCurrency` are what
 * is *owed*, snapshotted at creation time (§18), never recomputed from a
 * live `AcquisitionPricingRule` join.
 */
export class CustomerAcquisition extends Entity<CustomerAcquisitionProps> {
  private constructor(props: CustomerAcquisitionProps) {
    super(props);
  }

  static recordAutomatic(props: {
    id: string;
    restaurantId: string;
    userId: string | null;
    reservationGuestId: string | null;
    sourceReservationId: string;
    reservationSource: ReservationSource;
    feeAmount: number;
    feeCurrency: string;
    pricingRuleId: string;
    now: Date;
  }): CustomerAcquisition {
    validateParty(props.userId, props.reservationGuestId);
    validateFee(props.feeAmount, props.feeCurrency);
    return new CustomerAcquisition({
      id: props.id,
      restaurantId: props.restaurantId,
      userId: props.userId,
      reservationGuestId: props.reservationGuestId,
      sourceReservationId: props.sourceReservationId,
      reservationSource: props.reservationSource,
      createdVia: AcquisitionCreatedVia.Automatic,
      status: AcquisitionStatus.Recorded,
      feeAmount: props.feeAmount,
      feeCurrency: props.feeCurrency,
      pricingRuleId: props.pricingRuleId,
      recordedAt: props.now,
      reversedAt: null,
      reversedBy: null,
      reversalReason: null,
      createdAt: props.now,
      updatedAt: props.now,
    });
  }

  /** ADR-033 §11 - symmetric, PlatformAdmin-only path for an under-count correction. */
  static recordManual(props: {
    id: string;
    restaurantId: string;
    userId: string | null;
    reservationGuestId: string | null;
    feeAmount: number;
    feeCurrency: string;
    pricingRuleId: string;
    now: Date;
  }): CustomerAcquisition {
    validateParty(props.userId, props.reservationGuestId);
    validateFee(props.feeAmount, props.feeCurrency);
    return new CustomerAcquisition({
      id: props.id,
      restaurantId: props.restaurantId,
      userId: props.userId,
      reservationGuestId: props.reservationGuestId,
      sourceReservationId: null,
      reservationSource: null,
      createdVia: AcquisitionCreatedVia.ManualPlatformAdminCorrection,
      status: AcquisitionStatus.Recorded,
      feeAmount: props.feeAmount,
      feeCurrency: props.feeCurrency,
      pricingRuleId: props.pricingRuleId,
      recordedAt: props.now,
      reversedAt: null,
      reversedBy: null,
      reversalReason: null,
      createdAt: props.now,
      updatedAt: props.now,
    });
  }

  static reconstitute(props: CustomerAcquisitionProps): CustomerAcquisition {
    return new CustomerAcquisition({ ...props });
  }

  get acquisitionId(): CustomerAcquisitionId {
    return CustomerAcquisitionId.create(this.props.id);
  }

  get restaurantId(): RestaurantId {
    return RestaurantId.create(this.props.restaurantId);
  }

  get userId(): string | null {
    return this.props.userId;
  }

  get reservationGuestId(): string | null {
    return this.props.reservationGuestId;
  }

  get sourceReservationId(): string | null {
    return this.props.sourceReservationId;
  }

  get reservationSource(): ReservationSource | null {
    return this.props.reservationSource;
  }

  get createdVia(): AcquisitionCreatedVia {
    return this.props.createdVia;
  }

  get status(): AcquisitionStatus {
    return this.props.status;
  }

  get feeAmount(): number {
    return this.props.feeAmount;
  }

  get feeCurrency(): string {
    return this.props.feeCurrency;
  }

  get pricingRuleId(): AcquisitionPricingRuleId {
    return AcquisitionPricingRuleId.create(this.props.pricingRuleId);
  }

  get recordedAt(): Date {
    return new Date(this.props.recordedAt.getTime());
  }

  get reversedAt(): Date | null {
    return this.props.reversedAt ? new Date(this.props.reversedAt.getTime()) : null;
  }

  get reversedBy(): string | null {
    return this.props.reversedBy;
  }

  get reversalReason(): string | null {
    return this.props.reversalReason;
  }

  get createdAt(): Date {
    return new Date(this.props.createdAt.getTime());
  }

  get updatedAt(): Date {
    return new Date(this.props.updatedAt.getTime());
  }

  /**
   * ADR-033 §10 - correcting an over-count. Frees the uniqueness slot (the
   * partial unique index only covers `status != 'Reversed'`) so a genuinely
   * new qualifying event afterward may create a fresh record. `reason` is
   * mandatory together with `reversedAt`/`reversedBy`, never a bare flag flip.
   */
  reverse(reversedBy: string, reason: string, at: Date): CustomerAcquisition {
    if (this.props.status === AcquisitionStatus.Reversed) {
      throw new AcquisitionAlreadyReversedException();
    }
    if (reason.trim().length === 0) {
      throw new InvalidCustomerAcquisitionException('reversalReason must not be empty.');
    }
    return CustomerAcquisition.reconstitute({
      ...this.props,
      status: AcquisitionStatus.Reversed,
      reversedAt: at,
      reversedBy,
      reversalReason: reason,
      updatedAt: at,
    });
  }

  /** ADR-033 §1: `Customer-Identity` is `userId` if present, else `reservationGuestId`. */
  customerIdentityKey(): string {
    return this.props.userId ?? this.props.reservationGuestId!;
  }

  toProps(): Readonly<CustomerAcquisitionProps> {
    return { ...this.props };
  }
}

/** ADR-033 §1: same XOR party invariant `Reservation` already enforces. */
function validateParty(userId: string | null, reservationGuestId: string | null): void {
  const hasUser = userId !== null;
  const hasGuest = reservationGuestId !== null;
  if (hasUser === hasGuest) {
    throw new InvalidCustomerAcquisitionException(
      'Exactly one of userId/reservationGuestId must be set, never both, never neither.',
    );
  }
}

function validateFee(feeAmount: number, feeCurrency: string): void {
  if (!Number.isFinite(feeAmount) || feeAmount < 0) {
    throw new InvalidCustomerAcquisitionException(
      'feeAmount must be a non-negative finite number.',
    );
  }
  if (feeCurrency.trim().length === 0) {
    throw new InvalidCustomerAcquisitionException('feeCurrency must not be empty.');
  }
}
