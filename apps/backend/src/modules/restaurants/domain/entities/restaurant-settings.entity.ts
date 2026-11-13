import { Entity } from '@shared/domain/base/entity.base';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { InvalidRestaurantSettingsException } from '../exceptions/invalid-restaurant-settings.exception';

export interface RestaurantSettingsProps {
  id: string;
  restaurantId: string;
  reservationIntervalMinutes: number;
  maxGuestsPerReservation: number;
  cancellationWindowMinutes: number;
  pendingReservationTimeoutMinutes: number;
  defaultReservationDurationMinutes: number;
  autoApproval: boolean;
  timezone: string;
  defaultCurrency: string | null;
  reservationReminderMinutesBefore: number;
  lateArrivalGraceMinutes: number;
  /** ADR-053: auto-approval stops above this party size; null means any size. */
  autoApprovalMaxGuests?: number | null;
  /** ADR-053: an online booking must start at least this far from now. */
  minLeadTimeMinutes?: number;
  /** ADR-053: furthest day ahead to book online; null means the platform limit. */
  maxDaysAhead?: number | null;
  /** ADR-053: most guests accepted online on one day; null means no cap. */
  dailyGuestCap?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

const CURRENCY_REGEX = /^[A-Z]{3}$/;

export class RestaurantSettings extends Entity<RestaurantSettingsProps> {
  private constructor(props: RestaurantSettingsProps) {
    super(props);
  }

  static create(props: RestaurantSettingsProps): RestaurantSettings {
    validate(props);
    return new RestaurantSettings({ ...props });
  }

  static reconstitute(props: RestaurantSettingsProps): RestaurantSettings {
    return new RestaurantSettings({ ...props });
  }

  /** Sensible platform defaults for a brand-new restaurant (DECISIONS.md
   * references 15/30-minute reservation intervals as the typical range;
   * `autoApproval: false` is the safe default - staff review required until
   * the owner explicitly opts into auto-approval; `defaultCurrency: null`
   * since no Country/Currency selection exists yet at restaurant-creation
   * time - the owner sets it explicitly via PATCH once relevant).
   * `reservationReminderMinutesBefore`/`lateArrivalGraceMinutes` (Phase 7.6,
   * ADR-019) default to 60/15 minutes - the same sensible-default reasoning
   * as `pendingReservationTimeoutMinutes`/`cancellationWindowMinutes`. */
  static createDefault(id: string, restaurantId: string, at: Date): RestaurantSettings {
    return RestaurantSettings.create({
      id,
      restaurantId,
      reservationIntervalMinutes: 30,
      maxGuestsPerReservation: 20,
      cancellationWindowMinutes: 60,
      pendingReservationTimeoutMinutes: 15,
      defaultReservationDurationMinutes: 90,
      autoApproval: false,
      timezone: 'UTC',
      defaultCurrency: null,
      reservationReminderMinutesBefore: 60,
      lateArrivalGraceMinutes: 15,
      createdAt: at,
      updatedAt: at,
    });
  }

  get restaurantSettingsId(): string {
    return this.props.id;
  }

  get restaurantId(): RestaurantId {
    return RestaurantId.create(this.props.restaurantId);
  }

  get reservationIntervalMinutes(): number {
    return this.props.reservationIntervalMinutes;
  }

  get maxGuestsPerReservation(): number {
    return this.props.maxGuestsPerReservation;
  }

  get cancellationWindowMinutes(): number {
    return this.props.cancellationWindowMinutes;
  }

  get pendingReservationTimeoutMinutes(): number {
    return this.props.pendingReservationTimeoutMinutes;
  }

  get defaultReservationDurationMinutes(): number {
    return this.props.defaultReservationDurationMinutes;
  }

  get autoApproval(): boolean {
    return this.props.autoApproval;
  }

  get timezone(): string {
    return this.props.timezone;
  }

  get defaultCurrency(): string | null {
    return this.props.defaultCurrency;
  }

  get reservationReminderMinutesBefore(): number {
    return this.props.reservationReminderMinutesBefore;
  }

  get lateArrivalGraceMinutes(): number {
    return this.props.lateArrivalGraceMinutes;
  }

  get autoApprovalMaxGuests(): number | null {
    return this.props.autoApprovalMaxGuests ?? null;
  }

  get minLeadTimeMinutes(): number {
    return this.props.minLeadTimeMinutes ?? 0;
  }

  get maxDaysAhead(): number | null {
    return this.props.maxDaysAhead ?? null;
  }

  get dailyGuestCap(): number | null {
    return this.props.dailyGuestCap ?? null;
  }

  /** ADR-053: true when a party of this size is approved without staff review. */
  autoApprovesParty(guests: number): boolean {
    if (!this.props.autoApproval) {
      return false;
    }
    const limit = this.autoApprovalMaxGuests;
    return limit === null || guests <= limit;
  }

  get createdAt(): Date {
    return new Date(this.props.createdAt.getTime());
  }

  get updatedAt(): Date {
    return new Date(this.props.updatedAt.getTime());
  }

  /** Full-replace semantics, matching `Restaurant.updateProfile()`. Never
   * touches `restaurantId` (immutable, one settings row per restaurant). */
  updateSettings(
    props: {
      reservationIntervalMinutes: number;
      maxGuestsPerReservation: number;
      cancellationWindowMinutes: number;
      pendingReservationTimeoutMinutes: number;
      defaultReservationDurationMinutes: number;
      autoApproval: boolean;
      timezone: string;
      defaultCurrency: string | null;
      reservationReminderMinutesBefore: number;
      lateArrivalGraceMinutes: number;
      /** ADR-053: each omitted limit keeps its stored value. */
      autoApprovalMaxGuests?: number | null;
      minLeadTimeMinutes?: number;
      maxDaysAhead?: number | null;
      dailyGuestCap?: number | null;
    },
    at: Date,
  ): RestaurantSettings {
    const next: RestaurantSettingsProps = { ...this.props, updatedAt: at };
    for (const [key, value] of Object.entries(props)) {
      if (value !== undefined) {
        (next as unknown as Record<string, unknown>)[key] = value;
      }
    }
    validate(next);
    return RestaurantSettings.reconstitute(next);
  }

  toProps(): Readonly<RestaurantSettingsProps> {
    return { ...this.props };
  }
}

function validate(props: RestaurantSettingsProps): void {
  if (props.reservationIntervalMinutes < 5 || props.reservationIntervalMinutes > 240) {
    throw new InvalidRestaurantSettingsException(
      'reservationIntervalMinutes must be between 5 and 240.',
    );
  }
  if (props.maxGuestsPerReservation < 1 || props.maxGuestsPerReservation > 100) {
    throw new InvalidRestaurantSettingsException(
      'maxGuestsPerReservation must be between 1 and 100.',
    );
  }
  if (props.cancellationWindowMinutes < 0 || props.cancellationWindowMinutes > 10080) {
    throw new InvalidRestaurantSettingsException(
      'cancellationWindowMinutes must be between 0 and 10080.',
    );
  }
  if (props.pendingReservationTimeoutMinutes < 1 || props.pendingReservationTimeoutMinutes > 1440) {
    throw new InvalidRestaurantSettingsException(
      'pendingReservationTimeoutMinutes must be between 1 and 1440.',
    );
  }
  if (
    props.defaultReservationDurationMinutes < 15 ||
    props.defaultReservationDurationMinutes > 480
  ) {
    throw new InvalidRestaurantSettingsException(
      'defaultReservationDurationMinutes must be between 15 and 480.',
    );
  }
  if (props.timezone.trim().length === 0) {
    throw new InvalidRestaurantSettingsException('timezone must not be empty.');
  }
  if (props.defaultCurrency !== null && !CURRENCY_REGEX.test(props.defaultCurrency)) {
    throw new InvalidRestaurantSettingsException(
      'defaultCurrency must be a three-letter ISO 4217 code.',
    );
  }
  if (
    props.reservationReminderMinutesBefore < 1 ||
    props.reservationReminderMinutesBefore > 10080
  ) {
    throw new InvalidRestaurantSettingsException(
      'reservationReminderMinutesBefore must be between 1 and 10080.',
    );
  }
  if (props.lateArrivalGraceMinutes < 1 || props.lateArrivalGraceMinutes > 1440) {
    throw new InvalidRestaurantSettingsException(
      'lateArrivalGraceMinutes must be between 1 and 1440.',
    );
  }
  validateBookingLimits(props);
}

/** Furthest a branch may let guests book online (ADR-053), matching the platform horizon. */
export const MAX_DAYS_AHEAD_LIMIT = 90;

function validateBookingLimits(props: RestaurantSettingsProps): void {
  const autoMax = props.autoApprovalMaxGuests ?? null;
  if (autoMax !== null && (!Number.isInteger(autoMax) || autoMax < 1 || autoMax > 100)) {
    throw new InvalidRestaurantSettingsException(
      'autoApprovalMaxGuests must be between 1 and 100.',
    );
  }
  const lead = props.minLeadTimeMinutes ?? 0;
  if (!Number.isInteger(lead) || lead < 0 || lead > 10080) {
    throw new InvalidRestaurantSettingsException('minLeadTimeMinutes must be between 0 and 10080.');
  }
  const daysAhead = props.maxDaysAhead ?? null;
  if (
    daysAhead !== null &&
    (!Number.isInteger(daysAhead) || daysAhead < 1 || daysAhead > MAX_DAYS_AHEAD_LIMIT)
  ) {
    throw new InvalidRestaurantSettingsException(
      `maxDaysAhead must be between 1 and ${MAX_DAYS_AHEAD_LIMIT}.`,
    );
  }
  const cap = props.dailyGuestCap ?? null;
  if (cap !== null && (!Number.isInteger(cap) || cap < 1 || cap > 100000)) {
    throw new InvalidRestaurantSettingsException('dailyGuestCap must be between 1 and 100000.');
  }
}
