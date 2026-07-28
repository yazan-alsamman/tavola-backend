import { Entity } from '@shared/domain/base/entity.base';
import { RestaurantReplyId, ReviewId, UserId } from '@shared/domain/value-objects/identifiers.vo';
import { InvalidRestaurantReplyException } from '../exceptions/invalid-restaurant-reply.exception';

export interface RestaurantReplyProps {
  id: string;
  reviewId: string;
  repliedByUserId: string;
  comment: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Zero-or-one reply to a Review (Phase 10, architecture frozen 2026-07-26,
 * owner decisions #10/#11/#12). `repliedByUserId` is always an Organization
 * Owner/Admin's own `User.id` - never an `Employee.id` (Employees do not
 * reply to Reviews in Phase 10; AUTHORIZATION_ARCHITECTURE.md §10 defines
 * "Restaurant Owner" as the `OrganizationMember.Owner` role, a `User`-backed
 * actor). Immutable once created: no edit, delete, or repost - this entity
 * exposes no mutation method at all beyond `create()`.
 */
export class RestaurantReply extends Entity<RestaurantReplyProps> {
  private constructor(props: RestaurantReplyProps) {
    super(props);
  }

  static create(props: RestaurantReplyProps): RestaurantReply {
    validate(props);
    return new RestaurantReply({ ...props });
  }

  static reconstitute(props: RestaurantReplyProps): RestaurantReply {
    return new RestaurantReply({ ...props });
  }

  get restaurantReplyId(): RestaurantReplyId {
    return RestaurantReplyId.create(this.props.id);
  }

  get reviewId(): ReviewId {
    return ReviewId.create(this.props.reviewId);
  }

  get repliedByUserId(): UserId {
    return UserId.create(this.props.repliedByUserId);
  }

  get comment(): string {
    return this.props.comment;
  }

  get createdAt(): Date {
    return new Date(this.props.createdAt.getTime());
  }

  get updatedAt(): Date {
    return new Date(this.props.updatedAt.getTime());
  }

  toProps(): Readonly<RestaurantReplyProps> {
    return { ...this.props };
  }
}

function validate(props: RestaurantReplyProps): void {
  if (props.reviewId.trim().length === 0) {
    throw new InvalidRestaurantReplyException('RestaurantReply must have a reviewId.');
  }
  if (props.repliedByUserId.trim().length === 0) {
    throw new InvalidRestaurantReplyException('RestaurantReply must have a repliedByUserId.');
  }
  if (props.comment.trim().length === 0) {
    throw new InvalidRestaurantReplyException('RestaurantReply must have a non-empty comment.');
  }
}
