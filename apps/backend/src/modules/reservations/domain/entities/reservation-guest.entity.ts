import { Entity } from '@shared/domain/base/entity.base';
import { PhoneNumber } from '@shared/domain/value-objects/phone-number.vo';
import { InvalidReservationException } from '../exceptions/invalid-reservation.exception';

export interface ReservationGuestProps {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  anonymizedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Dependent entity of the Reservation Aggregate (DOMAIN_MODEL.md's
 * `ReservationGuest` notes; Phase 7.4 decision #4) - represents the person a
 * Phone/WalkIn reservation is for when no registered `User` account exists.
 * `phone` is always the canonical E.164 form produced by the `PhoneNumber`
 * value object (ADR-022) - `create()` re-derives it from country code +
 * national number exactly like Customer registration does, never trusting a
 * client-assembled E.164 string directly.
 */
export class ReservationGuest extends Entity<ReservationGuestProps> {
  private constructor(props: ReservationGuestProps) {
    super(props);
  }

  static create(props: {
    id: string;
    fullName: string;
    countryCode: string;
    phoneNumber: string;
    email: string | null;
    now: Date;
  }): ReservationGuest {
    const fullName = props.fullName?.trim();
    if (!fullName) {
      throw new InvalidReservationException('reservationGuest.fullName must not be empty.');
    }
    const phone = PhoneNumber.create(props.countryCode, props.phoneNumber);

    return new ReservationGuest({
      id: props.id,
      fullName,
      phone: phone.value,
      email: props.email,
      anonymizedAt: null,
      createdAt: props.now,
      updatedAt: props.now,
    });
  }

  static reconstitute(props: ReservationGuestProps): ReservationGuest {
    return new ReservationGuest({ ...props });
  }

  get guestId(): string {
    return this.props.id;
  }

  get fullName(): string {
    return this.props.fullName;
  }

  get phone(): string {
    return this.props.phone;
  }

  get email(): string | null {
    return this.props.email;
  }

  get anonymizedAt(): Date | null {
    return this.props.anonymizedAt;
  }

  get createdAt(): Date {
    return new Date(this.props.createdAt.getTime());
  }

  get updatedAt(): Date {
    return new Date(this.props.updatedAt.getTime());
  }

  toProps(): Readonly<ReservationGuestProps> {
    return { ...this.props };
  }
}
