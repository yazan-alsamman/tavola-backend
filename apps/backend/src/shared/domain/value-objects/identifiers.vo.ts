import { UuidId } from './uuid-id.vo';

export class UserId extends UuidId {
  private constructor(value: string) {
    super(value, 'UserId');
  }

  static create(value: string): UserId {
    return new UserId(value);
  }
}

export class OrganizationId extends UuidId {
  private constructor(value: string) {
    super(value, 'OrganizationId');
  }

  static create(value: string): OrganizationId {
    return new OrganizationId(value);
  }
}

export class SessionId extends UuidId {
  private constructor(value: string) {
    super(value, 'SessionId');
  }

  static create(value: string): SessionId {
    return new SessionId(value);
  }
}

export class TokenFamilyId extends UuidId {
  private constructor(value: string) {
    super(value, 'TokenFamilyId');
  }

  static create(value: string): TokenFamilyId {
    return new TokenFamilyId(value);
  }
}

export class RestaurantId extends UuidId {
  private constructor(value: string) {
    super(value, 'RestaurantId');
  }

  static create(value: string): RestaurantId {
    return new RestaurantId(value);
  }
}

export class BranchId extends UuidId {
  private constructor(value: string) {
    super(value, 'BranchId');
  }

  static create(value: string): BranchId {
    return new BranchId(value);
  }
}

export class EmployeeId extends UuidId {
  private constructor(value: string) {
    super(value, 'EmployeeId');
  }

  static create(value: string): EmployeeId {
    return new EmployeeId(value);
  }
}

export class RoleId extends UuidId {
  private constructor(value: string) {
    super(value, 'RoleId');
  }

  static create(value: string): RoleId {
    return new RoleId(value);
  }
}

export class PermissionId extends UuidId {
  private constructor(value: string) {
    super(value, 'PermissionId');
  }

  static create(value: string): PermissionId {
    return new PermissionId(value);
  }
}

export class FileId extends UuidId {
  private constructor(value: string) {
    super(value, 'FileId');
  }

  static create(value: string): FileId {
    return new FileId(value);
  }
}

export class FloorPlanId extends UuidId {
  private constructor(value: string) {
    super(value, 'FloorPlanId');
  }

  static create(value: string): FloorPlanId {
    return new FloorPlanId(value);
  }
}

export class TableId extends UuidId {
  private constructor(value: string) {
    super(value, 'TableId');
  }

  static create(value: string): TableId {
    return new TableId(value);
  }
}

export class ReservationId extends UuidId {
  private constructor(value: string) {
    super(value, 'ReservationId');
  }

  static create(value: string): ReservationId {
    return new ReservationId(value);
  }
}

export class ReservationGuestId extends UuidId {
  private constructor(value: string) {
    super(value, 'ReservationGuestId');
  }

  static create(value: string): ReservationGuestId {
    return new ReservationGuestId(value);
  }
}

export class NotificationId extends UuidId {
  private constructor(value: string) {
    super(value, 'NotificationId');
  }

  static create(value: string): NotificationId {
    return new NotificationId(value);
  }
}

export class ReviewId extends UuidId {
  private constructor(value: string) {
    super(value, 'ReviewId');
  }

  static create(value: string): ReviewId {
    return new ReviewId(value);
  }
}

export class ReviewImageId extends UuidId {
  private constructor(value: string) {
    super(value, 'ReviewImageId');
  }

  static create(value: string): ReviewImageId {
    return new ReviewImageId(value);
  }
}

export class RestaurantReplyId extends UuidId {
  private constructor(value: string) {
    super(value, 'RestaurantReplyId');
  }

  static create(value: string): RestaurantReplyId {
    return new RestaurantReplyId(value);
  }
}

export class OfferId extends UuidId {
  private constructor(value: string) {
    super(value, 'OfferId');
  }

  static create(value: string): OfferId {
    return new OfferId(value);
  }
}

export class SubscriptionId extends UuidId {
  private constructor(value: string) {
    super(value, 'SubscriptionId');
  }

  static create(value: string): SubscriptionId {
    return new SubscriptionId(value);
  }
}

export class SubscriptionPlanId extends UuidId {
  private constructor(value: string) {
    super(value, 'SubscriptionPlanId');
  }

  static create(value: string): SubscriptionPlanId {
    return new SubscriptionPlanId(value);
  }
}

export class ConversationId extends UuidId {
  private constructor(value: string) {
    super(value, 'ConversationId');
  }

  static create(value: string): ConversationId {
    return new ConversationId(value);
  }
}

export class ConversationParticipantId extends UuidId {
  private constructor(value: string) {
    super(value, 'ConversationParticipantId');
  }

  static create(value: string): ConversationParticipantId {
    return new ConversationParticipantId(value);
  }
}

export class MessageId extends UuidId {
  private constructor(value: string) {
    super(value, 'MessageId');
  }

  static create(value: string): MessageId {
    return new MessageId(value);
  }
}

export class MenuId extends UuidId {
  private constructor(value: string) {
    super(value, 'MenuId');
  }

  static create(value: string): MenuId {
    return new MenuId(value);
  }
}

export class MenuCategoryId extends UuidId {
  private constructor(value: string) {
    super(value, 'MenuCategoryId');
  }

  static create(value: string): MenuCategoryId {
    return new MenuCategoryId(value);
  }
}

export class MenuItemId extends UuidId {
  private constructor(value: string) {
    super(value, 'MenuItemId');
  }

  static create(value: string): MenuItemId {
    return new MenuItemId(value);
  }
}

export class MenuItemOptionGroupId extends UuidId {
  private constructor(value: string) {
    super(value, 'MenuItemOptionGroupId');
  }

  static create(value: string): MenuItemOptionGroupId {
    return new MenuItemOptionGroupId(value);
  }
}

export class MenuItemOptionId extends UuidId {
  private constructor(value: string) {
    super(value, 'MenuItemOptionId');
  }

  static create(value: string): MenuItemOptionId {
    return new MenuItemOptionId(value);
  }
}

export class MenuItemAddOnId extends UuidId {
  private constructor(value: string) {
    super(value, 'MenuItemAddOnId');
  }

  static create(value: string): MenuItemAddOnId {
    return new MenuItemAddOnId(value);
  }
}

export class MenuItemAvailabilityId extends UuidId {
  private constructor(value: string) {
    super(value, 'MenuItemAvailabilityId');
  }

  static create(value: string): MenuItemAvailabilityId {
    return new MenuItemAvailabilityId(value);
  }
}
