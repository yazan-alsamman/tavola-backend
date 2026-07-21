import { Entity } from '@shared/domain/base/entity.base';
import { BranchId } from '@shared/domain/value-objects/identifiers.vo';
import { InvalidBranchWorkingHoursException } from '../exceptions/invalid-branch-working-hours.exception';

export interface BranchWorkingHoursProps {
  id: string;
  branchId: string;
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
 * Branch-level working hours override (Phase 5.2) - a separate child entity
 * of the Branch aggregate, not a `branchId` bolted onto the Restaurant-level
 * `WorkingHours` entity (see this entity's own Prisma model comment). One row
 * per day-of-week per branch; a day with no row has no override configured
 * for that branch (whether that means "closed" or "falls back to the
 * Restaurant default" is a future consumer's decision, out of this phase's
 * CRUD-only scope).
 */
export class BranchWorkingHours extends Entity<BranchWorkingHoursProps> {
  private constructor(props: BranchWorkingHoursProps) {
    super(props);
  }

  static create(props: BranchWorkingHoursProps): BranchWorkingHours {
    validate(props);
    return new BranchWorkingHours({ ...props });
  }

  static reconstitute(props: BranchWorkingHoursProps): BranchWorkingHours {
    return new BranchWorkingHours({ ...props });
  }

  get branchWorkingHoursId(): string {
    return this.props.id;
  }

  get branchId(): BranchId {
    return BranchId.create(this.props.branchId);
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

  toProps(): Readonly<BranchWorkingHoursProps> {
    return { ...this.props };
  }
}

function validate(props: BranchWorkingHoursProps): void {
  if (!Number.isInteger(props.dayOfWeek) || props.dayOfWeek < 0 || props.dayOfWeek > 6) {
    throw new InvalidBranchWorkingHoursException('dayOfWeek must be an integer between 0 and 6.');
  }
  if (!TIME_REGEX.test(props.openingTime)) {
    throw new InvalidBranchWorkingHoursException('openingTime must be in HH:mm 24-hour format.');
  }
  if (!TIME_REGEX.test(props.closingTime)) {
    throw new InvalidBranchWorkingHoursException('closingTime must be in HH:mm 24-hour format.');
  }
  const hasBreakStart = props.breakStartTime !== null;
  const hasBreakEnd = props.breakEndTime !== null;
  if (hasBreakStart !== hasBreakEnd) {
    throw new InvalidBranchWorkingHoursException(
      'breakStartTime and breakEndTime must both be set or both be null.',
    );
  }
  if (hasBreakStart && hasBreakEnd) {
    if (!TIME_REGEX.test(props.breakStartTime as string)) {
      throw new InvalidBranchWorkingHoursException(
        'breakStartTime must be in HH:mm 24-hour format.',
      );
    }
    if (!TIME_REGEX.test(props.breakEndTime as string)) {
      throw new InvalidBranchWorkingHoursException('breakEndTime must be in HH:mm 24-hour format.');
    }
    if ((props.breakStartTime as string) >= (props.breakEndTime as string)) {
      throw new InvalidBranchWorkingHoursException(
        'breakStartTime must be earlier than breakEndTime.',
      );
    }
  }
}
