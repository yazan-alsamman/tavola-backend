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
   * time - the owner sets it explicitly via PATCH once relevant). */
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
    },
    at: Date,
  ): RestaurantSettings {
    const next = {
      ...this.props,
      ...props,
      updatedAt: at,
    };
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
}
