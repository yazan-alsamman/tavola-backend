import { Entity } from '@shared/domain/base/entity.base';
import { BranchId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { InvalidBranchCoordinatesException } from '../exceptions/invalid-branch-coordinates.exception';

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
    return new Branch({ ...props });
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
