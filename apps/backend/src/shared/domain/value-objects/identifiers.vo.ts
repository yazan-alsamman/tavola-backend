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
