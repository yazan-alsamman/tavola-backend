import { Entity } from '@shared/domain/base/entity.base';
import { OfferId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { OfferDiscountType, OfferStatus, OfferType } from '../enums/offer.enums';
import { InvalidOfferException } from '../exceptions/invalid-offer.exception';
import { InvalidOfferStatusTransitionException } from '../exceptions/invalid-offer-status-transition.exception';
import {
  OFFER_TIME_PATTERN,
  OfferBooking,
  minutesOf,
  offerAcceptsBooking,
} from '../policies/offer-conditions.policy';

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
  daysOfWeek: number[];
  startTime: string | null;
  endTime: string | null;
  minPartySize: number | null;
  branchIds: string[];
  oncePerCustomer: boolean;
  bookingCap: number | null;
  /** Times the offer appeared in a public list (ADR-047). Never set by an edit. */
  viewCount: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/** The editable fields - identical shape for Create and Update (ADR-047). */
export interface OfferContent {
  type: OfferType;
  title: string;
  description: string;
  discountType: OfferDiscountType;
  discountValue: number;
  startsAt: Date;
  endsAt: Date;
  /** 0 = Sunday ... 6 = Saturday, branch-local. Empty = every day. */
  daysOfWeek: number[];
  /** "HH:mm" branch-local window [startTime, endTime); both null = all day. */
  startTime: string | null;
  endTime: string | null;
  minPartySize: number | null;
  /** Empty = every branch. Membership in the restaurant is checked by the use case. */
  branchIds: string[];
  oncePerCustomer: boolean;
  bookingCap: number | null;
}

/** Content defaults for callers that predate ADR-047's conditions. */
export const NO_OFFER_CONDITIONS: Pick<
  OfferContent,
  | 'daysOfWeek'
  | 'startTime'
  | 'endTime'
  | 'minPartySize'
  | 'branchIds'
  | 'oncePerCustomer'
  | 'bookingCap'
> = {
  daysOfWeek: [],
  startTime: null,
  endTime: null,
  minPartySize: null,
  branchIds: [],
  oncePerCustomer: false,
  bookingCap: null,
};

const MIN_PERCENTAGE = 0;
const MAX_PERCENTAGE = 100;
const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2000;

/**
 * Offer Aggregate root (Phase 11, architecture frozen 2026-07-28,
 * TASKS.md's "Phase 11 — Offers: Pre-implementation architecture
 * decisions"). Single generic aggregate for every offer kind (`type` is
 * display/filtering metadata only, no behavioral branching). Draft and
 * Published offers are editable, Expired ones are not (ADR-047). `discountType`/`discountValue` apply uniformly
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
      ...normalizeContent(props.content),
      status: OfferStatus.Draft,
      viewCount: 0,
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

  get daysOfWeek(): number[] {
    return [...this.props.daysOfWeek];
  }

  get startTime(): string | null {
    return this.props.startTime;
  }

  get endTime(): string | null {
    return this.props.endTime;
  }

  get minPartySize(): number | null {
    return this.props.minPartySize;
  }

  get branchIds(): string[] {
    return [...this.props.branchIds];
  }

  get oncePerCustomer(): boolean {
    return this.props.oncePerCustomer;
  }

  get bookingCap(): number | null {
    return this.props.bookingCap;
  }

  get viewCount(): number {
    return this.props.viewCount;
  }

  /** ADR-047: whether a booking meets the offer's period, branch, party and hours. */
  acceptsBooking(booking: OfferBooking): boolean {
    return offerAcceptsBooking(this.props, booking);
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
   * ADR-047 (supersedes owner decision D3's Draft-only rule): a Draft or a
   * Published offer may be edited; an Expired one may not. A Published
   * offer cannot be edited into an already-ended period, which would leave
   * it Published but over.
   */
  update(content: OfferContent, at: Date): Offer {
    if (this.statusAt(at) === OfferStatus.Expired) {
      throw new InvalidOfferStatusTransitionException(
        `Cannot update offer "${this.props.id}" - it has expired.`,
      );
    }
    validateContent(content);
    if (this.props.status === OfferStatus.Published && content.endsAt.getTime() <= at.getTime()) {
      throw new InvalidOfferException('A published offer must end in the future.');
    }
    return Offer.reconstitute({
      ...this.props,
      ...normalizeContent(content),
      updatedAt: at,
    });
  }

  isEditable(at: Date): boolean {
    return this.statusAt(at) !== OfferStatus.Expired;
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

  /**
   * The status as of `at`: a Published offer whose `endsAt` has passed reads
   * as Expired even when its expiration job never ran (lost Redis job, or a
   * row written without one). The stored row is corrected by that job; this
   * keeps the management listing truthful in the meantime.
   */
  statusAt(at: Date): OfferStatus {
    if (
      this.props.status === OfferStatus.Published &&
      this.props.endsAt.getTime() <= at.getTime()
    ) {
      return OfferStatus.Expired;
    }
    return this.props.status;
  }

  toProps(): Readonly<OfferProps> {
    return {
      ...this.props,
      daysOfWeek: [...this.props.daysOfWeek],
      branchIds: [...this.props.branchIds],
    };
  }
}

function normalizeContent(content: OfferContent): OfferContent {
  return {
    ...content,
    daysOfWeek: [...new Set(content.daysOfWeek)].sort((a, b) => a - b),
    branchIds: [...new Set(content.branchIds)],
  };
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
  validateConditions(content);
}

function validateConditions(content: OfferContent): void {
  if (content.daysOfWeek.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw new InvalidOfferException('daysOfWeek must hold integers from 0 (Sunday) to 6.');
  }
  if ((content.startTime === null) !== (content.endTime === null)) {
    throw new InvalidOfferException('startTime and endTime are given together or not at all.');
  }
  if (content.startTime !== null && content.endTime !== null) {
    if (!OFFER_TIME_PATTERN.test(content.startTime) || !OFFER_TIME_PATTERN.test(content.endTime)) {
      throw new InvalidOfferException('startTime and endTime must match "HH:mm".');
    }
    if (minutesOf(content.startTime) >= minutesOf(content.endTime)) {
      throw new InvalidOfferException('startTime must be before endTime.');
    }
  }
  if (
    content.minPartySize !== null &&
    (!Number.isInteger(content.minPartySize) || content.minPartySize < 1)
  ) {
    throw new InvalidOfferException('minPartySize must be a positive integer.');
  }
  if (
    content.bookingCap !== null &&
    (!Number.isInteger(content.bookingCap) || content.bookingCap < 1)
  ) {
    throw new InvalidOfferException('bookingCap must be a positive integer.');
  }
}
