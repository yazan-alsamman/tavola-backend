import { Entity } from '@shared/domain/base/entity.base';
import {
  MenuItemAvailabilityId,
  MenuItemId,
  RestaurantId,
} from '@shared/domain/value-objects/identifiers.vo';
import { InvalidMenuItemAvailabilityException } from '../exceptions/invalid-menu-item-availability.exception';

export interface MenuItemAvailabilityProps {
  id: string;
  menuItemId: string;
  restaurantId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  createdAt: Date;
  updatedAt: Date;
}

const MIN_DAY_OF_WEEK = 0;
const MAX_DAY_OF_WEEK = 6;
const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * One serving window for a Menu Item (Phase 18, added by ADR-032, replacing
 * `MenuItem.scheduleJson`). Matches the `WorkingHours`/`BranchWorkingHours`
 * relational day-of-week/time-window convention rather than a `Json` column.
 * No `deletedAt` - whole-set replaced by
 * `ReplaceMenuItemAvailabilityWindowsUseCase`, never individually
 * soft-deleted (matching `WorkingHours`/`BranchWorkingHours`'s own
 * precedent). More than one row per `dayOfWeek` is permitted - a Menu Item
 * may have multiple disjoint serving windows in a day.
 */
export class MenuItemAvailability extends Entity<MenuItemAvailabilityProps> {
  private constructor(props: MenuItemAvailabilityProps) {
    super(props);
  }

  static create(props: {
    id: string;
    menuItemId: string;
    restaurantId: string;
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    now: Date;
  }): MenuItemAvailability {
    validate(props);
    return new MenuItemAvailability({
      id: props.id,
      menuItemId: props.menuItemId,
      restaurantId: props.restaurantId,
      dayOfWeek: props.dayOfWeek,
      startTime: props.startTime,
      endTime: props.endTime,
      createdAt: props.now,
      updatedAt: props.now,
    });
  }

  static reconstitute(props: MenuItemAvailabilityProps): MenuItemAvailability {
    return new MenuItemAvailability({ ...props });
  }

  get menuItemAvailabilityId(): MenuItemAvailabilityId {
    return MenuItemAvailabilityId.create(this.props.id);
  }

  get menuItemId(): MenuItemId {
    return MenuItemId.create(this.props.menuItemId);
  }

  get restaurantId(): RestaurantId {
    return RestaurantId.create(this.props.restaurantId);
  }

  get dayOfWeek(): number {
    return this.props.dayOfWeek;
  }

  get startTime(): string {
    return this.props.startTime;
  }

  get endTime(): string {
    return this.props.endTime;
  }

  get createdAt(): Date {
    return new Date(this.props.createdAt.getTime());
  }

  get updatedAt(): Date {
    return new Date(this.props.updatedAt.getTime());
  }

  toProps(): Readonly<MenuItemAvailabilityProps> {
    return { ...this.props };
  }
}

function validate(props: { dayOfWeek: number; startTime: string; endTime: string }): void {
  if (
    !Number.isInteger(props.dayOfWeek) ||
    props.dayOfWeek < MIN_DAY_OF_WEEK ||
    props.dayOfWeek > MAX_DAY_OF_WEEK
  ) {
    throw new InvalidMenuItemAvailabilityException(
      `dayOfWeek must be an integer between ${MIN_DAY_OF_WEEK} and ${MAX_DAY_OF_WEEK}.`,
    );
  }
  if (!TIME_REGEX.test(props.startTime)) {
    throw new InvalidMenuItemAvailabilityException('startTime must match "HH:mm".');
  }
  if (!TIME_REGEX.test(props.endTime)) {
    throw new InvalidMenuItemAvailabilityException('endTime must match "HH:mm".');
  }
  if (props.startTime >= props.endTime) {
    throw new InvalidMenuItemAvailabilityException('startTime must be strictly before endTime.');
  }
}
