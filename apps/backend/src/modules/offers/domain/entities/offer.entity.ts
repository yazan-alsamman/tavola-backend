import { Entity } from '@shared/domain/base/entity.base';
import { OfferId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { OfferDiscountType, OfferStatus, OfferType } from '../enums/offer.enums';
import { InvalidOfferException } from '../exceptions/invalid-offer.exception';
import { InvalidOfferStatusTransitionException } from '../exceptions/invalid-offer-status-transition.exception';

export interface OfferProps {
  id: string;
  restaurantId: string;
  type: OfferType;
  title: string;
  description: string;
  discountType: OfferDiscountType;
  discountValue: number;
  startsAt: Date;
  endsAt: Date;
  status: OfferStatus;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/** The mutable content fields - identical shape for Create and Draft-only Update. */
export interface OfferContent {
  type: OfferType;
  title: string;
  description: string;
  discountType: OfferDiscountType;
  discountValue: number;
  startsAt: Date;
  endsAt: Date;
}

const MIN_PERCENTAGE = 0;
const MAX_PERCENTAGE = 100;
const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2000;

/**
 * Offer Aggregate root (Phase 11, architecture frozen 2026-07-28,
 * TASKS.md's "Phase 11 — Offers: Pre-implementation architecture
 * decisions"). Single generic aggregate for Promotions/Coupons/Events (`type`
 * is display/filtering metadata only, no behavioral branching). Content is
 * mutable only while `status = Draft` (owner decision D3); `Published`/
 * `Expired` are immutable. `discountType`/`discountValue` apply uniformly
 * regardless of `type` - Coupons are display-only in v1, no redemption
 * semantics exist to special-case.
 */
export class Offer extends Entity<OfferProps> {
  private constructor(props: OfferProps) {
    super(props);
  }

  static create(props: {
    id: string;
    restaurantId: string;
    content: OfferContent;
    now: Date;
  }): Offer {
    validateContent(props.content);
    return new Offer({
      id: props.id,
      restaurantId: props.restaurantId,
      ...props.content,
      status: OfferStatus.Draft,
      createdAt: props.now,
      updatedAt: props.now,
      deletedAt: null,
    });
  }

  static reconstitute(props: OfferProps): Offer {
    return new Offer({ ...props });
  }

  get offerId(): OfferId {
    return OfferId.create(this.props.id);
  }

  get restaurantId(): RestaurantId {
    return RestaurantId.create(this.props.restaurantId);
  }

  get type(): OfferType {
    return this.props.type;
  }

  get title(): string {
    return this.props.title;
  }

  get description(): string {
    return this.props.description;
  }

  get discountType(): OfferDiscountType {
    return this.props.discountType;
  }

  get discountValue(): number {
    return this.props.discountValue;
  }

  get startsAt(): Date {
    return new Date(this.props.startsAt.getTime());
  }

  get endsAt(): Date {
    return new Date(this.props.endsAt.getTime());
  }

  get status(): OfferStatus {
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

  isDeleted(): boolean {
    return this.props.deletedAt !== null;
  }

  /**
   * Owner decision D3: content is editable only while Draft - re-asserted
   * here defensively (the domain layer never trusts the application layer
   * alone), even though `UpdateOfferUseCase` has already checked it.
   */
  update(content: OfferContent, at: Date): Offer {
    if (this.props.status !== OfferStatus.Draft) {
      throw new InvalidOfferStatusTransitionException(
        `Cannot update offer "${this.props.id}" - only a Draft offer may be edited.`,
      );
    }
    validateContent(content);
    return Offer.reconstitute({
      ...this.props,
      ...content,
      updatedAt: at,
    });
  }

  /**
   * `Draft -> Published` only. Rejects publishing an Offer whose window has
   * already fully elapsed (`endsAt <= at`) - it would never be publicly
   * visible at all and would need no expiration job.
   */
  publish(at: Date): Offer {
    if (this.props.status !== OfferStatus.Draft) {
      throw new InvalidOfferStatusTransitionException(
        `Cannot publish offer "${this.props.id}" - it is no longer Draft.`,
      );
    }
    if (this.props.endsAt.getTime() <= at.getTime()) {
      throw new InvalidOfferException('Cannot publish an offer whose endsAt has already passed.');
    }
    return Offer.reconstitute({
      ...this.props,
      status: OfferStatus.Published,
      updatedAt: at,
    });
  }

  /**
   * `Published -> Expired` only. The actual concurrency authority is the
   * repository's CAS (`WHERE status = 'Published' AND deleted_at IS NULL`) -
   * this method builds the next in-memory state the same way every other
   * domain action does; it is not itself a concurrency guarantee.
   */
  expire(at: Date): Offer {
    if (this.props.status !== OfferStatus.Published) {
      throw new InvalidOfferStatusTransitionException(
        `Cannot expire offer "${this.props.id}" - it is not Published.`,
      );
    }
    return Offer.reconstitute({
      ...this.props,
      status: OfferStatus.Expired,
      updatedAt: at,
    });
  }

  /** Soft delete (ADR-010), reachable by Owner/Admin from any state. */
  softDelete(at: Date): Offer {
    return Offer.reconstitute({
      ...this.props,
      deletedAt: at,
      updatedAt: at,
    });
  }

  /**
   * D5's public visibility predicate: Published, currently within
   * `[startsAt, endsAt)`, not soft-deleted. Mirrored exactly by
   * `OfferRepository.findManyPublicByRestaurantId`'s SQL `WHERE` clause -
   * the public API must never depend solely on whether the asynchronous
   * expiration worker has already run (an Offer past `endsAt` is never
   * "currently active" even if its BullMQ job is delayed).
   */
  isPubliclyActive(at: Date): boolean {
    return (
      this.props.status === OfferStatus.Published &&
      this.props.deletedAt === null &&
      this.props.startsAt.getTime() <= at.getTime() &&
      this.props.endsAt.getTime() > at.getTime()
    );
  }

  toProps(): Readonly<OfferProps> {
    return { ...this.props };
  }
}

function validateContent(content: OfferContent): void {
  if (content.title.trim().length === 0) {
    throw new InvalidOfferException('title must not be empty.');
  }
  if (content.title.length > MAX_TITLE_LENGTH) {
    throw new InvalidOfferException(`title must not exceed ${MAX_TITLE_LENGTH} characters.`);
  }
  if (content.description.trim().length === 0) {
    throw new InvalidOfferException('description must not be empty.');
  }
  if (content.description.length > MAX_DESCRIPTION_LENGTH) {
    throw new InvalidOfferException(
      `description must not exceed ${MAX_DESCRIPTION_LENGTH} characters.`,
    );
  }
  if (!Number.isFinite(content.discountValue)) {
    throw new InvalidOfferException('discountValue must be a finite number.');
  }
  if (content.discountType === OfferDiscountType.Percentage) {
    if (content.discountValue <= MIN_PERCENTAGE || content.discountValue > MAX_PERCENTAGE) {
      throw new InvalidOfferException(
        'A Percentage discountValue must be greater than 0 and at most 100.',
      );
    }
  } else if (content.discountValue <= 0) {
    throw new InvalidOfferException('A FixedAmount discountValue must be greater than 0.');
  }
  if (content.startsAt.getTime() >= content.endsAt.getTime()) {
    throw new InvalidOfferException('startsAt must be strictly before endsAt.');
  }
}
