import { Entity } from '@shared/domain/base/entity.base';
import { RestaurantId, OrganizationId } from '@shared/domain/value-objects/identifiers.vo';
import { RestaurantSlug } from '@shared/domain/value-objects/restaurant-slug.vo';
import { RestaurantStatus } from '../enums/restaurant.enums';

export interface RestaurantProps {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  logoId: string | null;
  coverImageId: string | null;
  description: string | null;
  cuisineType: string | null;
  averageRating: number | null;
  priceLevel: number | null;
  status: RestaurantStatus;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export class Restaurant extends Entity<RestaurantProps> {
  private constructor(props: RestaurantProps) {
    super(props);
  }

  static create(props: RestaurantProps): Restaurant {
    RestaurantSlug.create(props.slug);
    return new Restaurant({ ...props });
  }

  static reconstitute(props: RestaurantProps): Restaurant {
    return new Restaurant({ ...props });
  }

  get restaurantId(): RestaurantId {
    return RestaurantId.create(this.props.id);
  }

  get organizationId(): OrganizationId {
    return OrganizationId.create(this.props.organizationId);
  }

  get name(): string {
    return this.props.name;
  }

  get slug(): RestaurantSlug {
    return RestaurantSlug.create(this.props.slug);
  }

  get logoId(): string | null {
    return this.props.logoId;
  }

  get coverImageId(): string | null {
    return this.props.coverImageId;
  }

  get description(): string | null {
    return this.props.description;
  }

  get cuisineType(): string | null {
    return this.props.cuisineType;
  }

  get averageRating(): number | null {
    return this.props.averageRating;
  }

  get priceLevel(): number | null {
    return this.props.priceLevel;
  }

  get status(): RestaurantStatus {
    return this.props.status;
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

  isActive(): boolean {
    return this.props.status === RestaurantStatus.Active && !this.isSoftDeleted();
  }

  /**
   * Self-service profile fields only - never `organizationId` (immutable
   * after creation, ADR-011), `slug` (URL-stable once created), `status`
   * (dedicated `activate()`/`suspend()` invariant-bearing methods below), or
   * `averageRating` (computed by the future Reviews module, never
   * client-settable - accepting it here would let an owner fake their own
   * rating).
   */
  updateProfile(
    props: {
      name: string;
      description: string | null;
      cuisineType: string | null;
      priceLevel: number | null;
    },
    at: Date,
  ): Restaurant {
    return Restaurant.reconstitute({
      ...this.props,
      name: props.name,
      description: props.description,
      cuisineType: props.cuisineType,
      priceLevel: props.priceLevel,
      updatedAt: at,
    });
  }

  activate(at: Date): Restaurant {
    if (this.props.status === RestaurantStatus.Active) {
      return this;
    }
    return Restaurant.reconstitute({
      ...this.props,
      status: RestaurantStatus.Active,
      updatedAt: at,
    });
  }

  suspend(at: Date): Restaurant {
    if (this.props.status === RestaurantStatus.Suspended) {
      return this;
    }
    return Restaurant.reconstitute({
      ...this.props,
      status: RestaurantStatus.Suspended,
      updatedAt: at,
    });
  }

  softDelete(at: Date): Restaurant {
    return Restaurant.reconstitute({
      ...this.props,
      deletedAt: at,
      updatedAt: at,
    });
  }

  toProps(): Readonly<RestaurantProps> {
    return { ...this.props };
  }
}
