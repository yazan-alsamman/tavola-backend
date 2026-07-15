import { Entity } from '@shared/domain/base/entity.base';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { InvalidWorkingHoursException } from '../exceptions/invalid-working-hours.exception';

export interface WorkingHoursProps {
  id: string;
  restaurantId: string;
  dayOfWeek: number;
  openingTime: string;
  closingTime: string;
  breakStartTime: string | null;
  breakEndTime: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Restaurant-level default working hours only (Phase 4.3 explicit scope
 * decision) - one row per day-of-week per restaurant; a day with no row is
 * closed that day. Branch-level override is deferred to Phase 5 and does not
 * exist on this entity.
 */
export class WorkingHours extends Entity<WorkingHoursProps> {
  private constructor(props: WorkingHoursProps) {
    super(props);
  }

  static create(props: WorkingHoursProps): WorkingHours {
    validate(props);
    return new WorkingHours({ ...props });
  }

  static reconstitute(props: WorkingHoursProps): WorkingHours {
    return new WorkingHours({ ...props });
  }

  get workingHoursId(): string {
    return this.props.id;
  }

  get restaurantId(): RestaurantId {
    return RestaurantId.create(this.props.restaurantId);
  }

  get dayOfWeek(): number {
    return this.props.dayOfWeek;
  }

  get openingTime(): string {
    return this.props.openingTime;
  }

  get closingTime(): string {
    return this.props.closingTime;
  }

  get breakStartTime(): string | null {
    return this.props.breakStartTime;
  }

  get breakEndTime(): string | null {
    return this.props.breakEndTime;
  }

  get createdAt(): Date {
    return new Date(this.props.createdAt.getTime());
  }

  get updatedAt(): Date {
    return new Date(this.props.updatedAt.getTime());
  }

  toProps(): Readonly<WorkingHoursProps> {
    return { ...this.props };
  }
}

function validate(props: WorkingHoursProps): void {
  if (!Number.isInteger(props.dayOfWeek) || props.dayOfWeek < 0 || props.dayOfWeek > 6) {
    throw new InvalidWorkingHoursException('dayOfWeek must be an integer between 0 and 6.');
  }
  if (!TIME_REGEX.test(props.openingTime)) {
    throw new InvalidWorkingHoursException('openingTime must be in HH:mm 24-hour format.');
  }
  if (!TIME_REGEX.test(props.closingTime)) {
    throw new InvalidWorkingHoursException('closingTime must be in HH:mm 24-hour format.');
  }
  const hasBreakStart = props.breakStartTime !== null;
  const hasBreakEnd = props.breakEndTime !== null;
  if (hasBreakStart !== hasBreakEnd) {
    throw new InvalidWorkingHoursException(
      'breakStartTime and breakEndTime must both be set or both be null.',
    );
  }
  if (hasBreakStart && hasBreakEnd) {
    if (!TIME_REGEX.test(props.breakStartTime as string)) {
      throw new InvalidWorkingHoursException('breakStartTime must be in HH:mm 24-hour format.');
    }
    if (!TIME_REGEX.test(props.breakEndTime as string)) {
      throw new InvalidWorkingHoursException('breakEndTime must be in HH:mm 24-hour format.');
    }
    if ((props.breakStartTime as string) >= (props.breakEndTime as string)) {
      throw new InvalidWorkingHoursException('breakStartTime must be earlier than breakEndTime.');
    }
  }
}
