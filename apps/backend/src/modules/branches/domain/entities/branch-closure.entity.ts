import { Entity } from '@shared/domain/base/entity.base';
import { InvalidBranchClosureException } from '../exceptions/invalid-branch-closure.exception';

export interface BranchClosureProps {
  id: string;
  branchId: string;
  /** Inclusive calendar date (YYYY-MM-DD) in the branch timezone. */
  startDate: string;
  /** Inclusive calendar date (YYYY-MM-DD) in the branch timezone. */
  endDate: string;
  reason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Longest single closure (ADR-053); a longer stop is a pause, not a closure. */
export const MAX_CLOSURE_DAYS = 366;
export const MAX_CLOSURE_REASON_LENGTH = 200;
const MS_PER_DAY = 86_400_000;

/**
 * ADR-053: dates a branch takes no online bookings, without touching its
 * weekly hours (a holiday, renovation, a private event).
 */
export class BranchClosure extends Entity<BranchClosureProps> {
  private constructor(props: BranchClosureProps) {
    super(props);
  }

  static create(props: BranchClosureProps): BranchClosure {
    const reason = props.reason?.trim() ? props.reason.trim() : null;
    validate({ ...props, reason });
    return new BranchClosure({ ...props, reason });
  }

  static reconstitute(props: BranchClosureProps): BranchClosure {
    return new BranchClosure({ ...props });
  }

  get closureId(): string {
    return this.props.id;
  }

  get branchId(): string {
    return this.props.branchId;
  }

  get startDate(): string {
    return this.props.startDate;
  }

  get endDate(): string {
    return this.props.endDate;
  }

  get reason(): string | null {
    return this.props.reason;
  }

  get createdAt(): Date {
    return new Date(this.props.createdAt.getTime());
  }

  get updatedAt(): Date {
    return new Date(this.props.updatedAt.getTime());
  }

  covers(date: string): boolean {
    return this.props.startDate <= date && date <= this.props.endDate;
  }
}

function toUtc(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`);
}

function validate(props: BranchClosureProps): void {
  for (const [name, value] of [
    ['startDate', props.startDate],
    ['endDate', props.endDate],
  ] as const) {
    if (!CALENDAR_DATE.test(value) || Number.isNaN(toUtc(value))) {
      throw new InvalidBranchClosureException(`${name} must be a calendar date (YYYY-MM-DD).`);
    }
  }
  if (props.endDate < props.startDate) {
    throw new InvalidBranchClosureException('endDate must not be before startDate.');
  }
  const days = (toUtc(props.endDate) - toUtc(props.startDate)) / MS_PER_DAY + 1;
  if (days > MAX_CLOSURE_DAYS) {
    throw new InvalidBranchClosureException(`A closure can last at most ${MAX_CLOSURE_DAYS} days.`);
  }
  if (props.reason !== null && props.reason.length > MAX_CLOSURE_REASON_LENGTH) {
    throw new InvalidBranchClosureException(
      `reason must be at most ${MAX_CLOSURE_REASON_LENGTH} characters.`,
    );
  }
}
