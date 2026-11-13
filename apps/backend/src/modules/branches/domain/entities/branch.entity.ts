import { Entity } from '@shared/domain/base/entity.base';
import { BranchId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { InvalidBranchCoordinatesException } from '../exceptions/invalid-branch-coordinates.exception';
import { BranchFeature, BranchSubscriptionStatus, BranchVenueType } from '../enums/branch.enums';

export interface BranchProps {
  id: string;
  restaurantId: string;
  city: string;
  district: string | null;
  address: string;
  latitude: number | null;
  longitude: number | null;
  countryCode: string;
  currency: string | null;
  timezone: string;
  phone: string | null;
  /** ADR-051: File id of the branch cover, written only by the cover upload. */
  coverImageId?: string | null;
  /** ADR-053: what kind of place this is; null until the owner picks one. */
  venueType?: BranchVenueType | null;
  /** ADR-053: amenities, each at most once. */
  features?: BranchFeature[];
  /** ADR-053: end of the free period; null for branches older than per-branch plans. */
  trialEndsAt?: Date | null;
  /** ADR-053: set while the owner has paused the branch. */
  pausedAt?: Date | null;
  /** Read-only, recomputed from the menu (ADR-046): never set by create/update. */
  referencePrice?: number | null;
  /** Read-only 1-4 price level (ADR-046). */
  priceLevel?: number | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/**
 * Phase 5.1 CRUD + Phase 5.3 Geo Coordinates (ADR-018). `openingHours`
 * (deferred to "Working Schedule", resolved separately by `BranchWorkingHours`
 * in Phase 5.2) remains a real, already-migrated but unused `Json?` column on
 * the `branches` table - this entity never reads or writes it.
 */
export class Branch extends Entity<BranchProps> {
  private constructor(props: BranchProps) {
    super(props);
  }

  static create(props: BranchProps): Branch {
    validateCoordinates(props.latitude, props.longitude);
    return new Branch({
      ...props,
      features: props.features === undefined ? undefined : [...new Set(props.features)],
    });
  }

  static reconstitute(props: BranchProps): Branch {
    return new Branch({ ...props });
  }

  get branchId(): BranchId {
    return BranchId.create(this.props.id);
  }

  get restaurantId(): RestaurantId {
    return RestaurantId.create(this.props.restaurantId);
  }

  get city(): string {
    return this.props.city;
  }

  get district(): string | null {
    return this.props.district;
  }

  get address(): string {
    return this.props.address;
  }

  get latitude(): number | null {
    return this.props.latitude;
  }

  get longitude(): number | null {
    return this.props.longitude;
  }

  get countryCode(): string {
    return this.props.countryCode;
  }

  get currency(): string | null {
    return this.props.currency;
  }

  get coverImageId(): string | null {
    return this.props.coverImageId ?? null;
  }

  get venueType(): BranchVenueType | null {
    return this.props.venueType ?? null;
  }

  get features(): BranchFeature[] {
    return [...(this.props.features ?? [])];
  }

  get trialEndsAt(): Date | null {
    return this.props.trialEndsAt ? new Date(this.props.trialEndsAt.getTime()) : null;
  }

  get pausedAt(): Date | null {
    return this.props.pausedAt ? new Date(this.props.pausedAt.getTime()) : null;
  }

  isPaused(): boolean {
    return (this.props.pausedAt ?? null) !== null;
  }

  subscriptionStatus(now: Date): BranchSubscriptionStatus {
    if (this.isPaused()) {
      return BranchSubscriptionStatus.Paused;
    }
    const trialEndsAt = this.props.trialEndsAt ?? null;
    return trialEndsAt !== null && trialEndsAt.getTime() > now.getTime()
      ? BranchSubscriptionStatus.Trial
      : BranchSubscriptionStatus.Active;
  }

  /** ADR-053: stop online bookings and hide the branch from guests. Idempotent. */
  pause(at: Date): Branch {
    if (this.isPaused()) {
      return this;
    }
    return Branch.reconstitute({ ...this.props, pausedAt: at, updatedAt: at });
  }

  /** ADR-053: undo `pause`. Idempotent. */
  resume(at: Date): Branch {
    if (!this.isPaused()) {
      return this;
    }
    return Branch.reconstitute({ ...this.props, pausedAt: null, updatedAt: at });
  }

  get referencePrice(): number | null {
    return this.props.referencePrice ?? null;
  }

  get priceLevel(): number | null {
    return this.props.priceLevel ?? null;
  }

  get timezone(): string {
    return this.props.timezone;
  }

  get phone(): string | null {
    return this.props.phone;
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

  isSoftDeleted(): boolean {
    return this.props.deletedAt !== null;
  }

  /**
   * Full-replace profile fields only - never `restaurantId` (immutable
   * after creation; moving a branch to another restaurant is not a supported
   * operation) or `openingHours` (out of this entity's scope, see class doc).
   */
  updateProfile(
    props: {
      city: string;
      district: string | null;
      address: string;
      latitude: number | null;
      longitude: number | null;
      countryCode: string;
      currency: string | null;
      timezone: string;
      phone: string | null;
      /** ADR-053: omitted keeps the stored value. */
      venueType?: BranchVenueType | null;
      features?: BranchFeature[];
    },
    at: Date,
  ): Branch {
    validateCoordinates(props.latitude, props.longitude);
    return Branch.reconstitute({
      ...this.props,
      city: props.city,
      district: props.district,
      address: props.address,
      latitude: props.latitude,
      longitude: props.longitude,
      countryCode: props.countryCode,
      currency: props.currency,
      timezone: props.timezone,
      phone: props.phone,
      venueType: props.venueType === undefined ? this.props.venueType : props.venueType,
      features: props.features === undefined ? this.props.features : [...new Set(props.features)],
      updatedAt: at,
    });
  }

  /**
   * Unconditional soft delete. DOMAIN_MODEL.md's business rule ("a Branch may
   * only be soft-deleted if it has no Pending or Approved reservations with a
   * future date/time") is not enforceable yet - the Reservation aggregate
   * does not exist until Phase 7. Deferred, not silently dropped: revisit
   * this method when Phase 7 ships, same precedent as Restaurant's own
   * unconditional softDelete() in Phase 4.1.
   */
  softDelete(at: Date): Branch {
    return Branch.reconstitute({
      ...this.props,
      deletedAt: at,
      updatedAt: at,
    });
  }

  toProps(): Readonly<BranchProps> {
    return { ...this.props };
  }
}

/**
 * Both null (no coordinates configured) or both present (valid, paired
 * coordinates) - one without the other is meaningless for a bounding-box
 * query (ADR-018) and is rejected rather than silently tolerated.
 */
function validateCoordinates(latitude: number | null, longitude: number | null): void {
  const hasLatitude = latitude !== null;
  const hasLongitude = longitude !== null;
  if (hasLatitude !== hasLongitude) {
    throw new InvalidBranchCoordinatesException(
      'latitude and longitude must both be set or both be null.',
    );
  }
  if (hasLatitude && (latitude < -90 || latitude > 90)) {
    throw new InvalidBranchCoordinatesException('latitude must be between -90 and 90.');
  }
  if (hasLongitude && (longitude < -180 || longitude > 180)) {
    throw new InvalidBranchCoordinatesException('longitude must be between -180 and 180.');
  }
}
