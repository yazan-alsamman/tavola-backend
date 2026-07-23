import { Entity } from '@shared/domain/base/entity.base';
import { ReservationStatus } from '../enums/reservation.enums';

export interface ReservationHistoryProps {
  id: string;
  reservationId: string;
  oldStatus: ReservationStatus;
  newStatus: ReservationStatus;
  oldReservationDate: Date | null;
  oldReservationStartTime: Date | null;
  newReservationDate: Date | null;
  newReservationStartTime: Date | null;
  oldTableId: string | null;
  newTableId: string | null;
  withinCancellationWindow: boolean | null;
  changedBy: string | null;
  changedAt: Date;
  reason: string | null;
}

/**
 * Child entity of the Reservation Aggregate (DOMAIN_MODEL.md). Introduced by
 * Phase 7.3 (Reservation Lifecycle) - an immutable audit-trail row, one per
 * Cancel/Reschedule/Complete/NoShow/Expire (Approve/Reject are not
 * retroactively extended to write here; they retain their existing
 * `AuditingEventPublisher`-only auditing from Phase 7.2, unchanged). No
 * domain methods beyond creation - it records what happened, it does not
 * itself transition or get mutated once written.
 */
export class ReservationHistory extends Entity<ReservationHistoryProps> {
  private constructor(props: ReservationHistoryProps) {
    super(props);
  }

  static create(props: ReservationHistoryProps): ReservationHistory {
    return new ReservationHistory({ ...props });
  }

  get historyId(): string {
    return this.props.id;
  }

  get reservationId(): string {
    return this.props.reservationId;
  }

  get oldStatus(): ReservationStatus {
    return this.props.oldStatus;
  }

  get newStatus(): ReservationStatus {
    return this.props.newStatus;
  }

  get oldReservationDate(): Date | null {
    return this.props.oldReservationDate;
  }

  get oldReservationStartTime(): Date | null {
    return this.props.oldReservationStartTime;
  }

  get newReservationDate(): Date | null {
    return this.props.newReservationDate;
  }

  get newReservationStartTime(): Date | null {
    return this.props.newReservationStartTime;
  }

  get oldTableId(): string | null {
    return this.props.oldTableId;
  }

  get newTableId(): string | null {
    return this.props.newTableId;
  }

  get withinCancellationWindow(): boolean | null {
    return this.props.withinCancellationWindow;
  }

  get changedBy(): string | null {
    return this.props.changedBy;
  }

  get changedAt(): Date {
    return this.props.changedAt;
  }

  get reason(): string | null {
    return this.props.reason;
  }

  toProps(): Readonly<ReservationHistoryProps> {
    return { ...this.props };
  }
}
