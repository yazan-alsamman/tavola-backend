import { DomainEvent } from '@shared/domain/base/domain-event.base';

/**
 * Phase 18 (Menu Management, architecture frozen 2026-08-02, ADR-031;
 * ownership/availability/isFeatured corrected 2026-08-03, ADR-032) - the 26
 * frozen event classes (EVENTS.md's "Menu Events" section). Neither on the
 * Phase 8 realtime allow-list nor the Phase 9 NotificationDispatcher
 * allow-list - both remain fail-closed/default-deny for every Menu event,
 * exactly like Review/Offer events. Every payload's `actorId` is either an
 * `OrganizationMember.userId` (Owner/Admin) or an `Employee.id` (holding
 * `menu:manage`) - no Customer-attributed event exists in this catalog.
 */
export class MenuCreatedEvent extends DomainEvent {
  public readonly eventName = 'MenuCreated';

  constructor(
    eventId: string,
    public readonly payload: { menuId: string; restaurantId: string; actorId: string },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

/** `displayOrder` change only - `active`/`isDefault` toggles use the dedicated events below. */
export class MenuUpdatedEvent extends DomainEvent {
  public readonly eventName = 'MenuUpdated';

  constructor(
    eventId: string,
    public readonly payload: { menuId: string; restaurantId: string; actorId: string },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

export class MenuActivatedEvent extends DomainEvent {
  public readonly eventName = 'MenuActivated';

  constructor(
    eventId: string,
    public readonly payload: { menuId: string; restaurantId: string; actorId: string },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

export class MenuDeactivatedEvent extends DomainEvent {
  public readonly eventName = 'MenuDeactivated';

  constructor(
    eventId: string,
    public readonly payload: { menuId: string; restaurantId: string; actorId: string },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

/** ADR-032: atomically unmarks whichever Menu previously held `isDefault = true` - no separate "unset" event fires for the previous holder. */
export class MenuSetAsDefaultEvent extends DomainEvent {
  public readonly eventName = 'MenuSetAsDefault';

  constructor(
    eventId: string,
    public readonly payload: { menuId: string; restaurantId: string; actorId: string },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

/**
 * Soft delete (ADR-010). Not originally enumerated in ADR-031/EVENTS.md's
 * event catalog despite `Menu` being soft-deletable - the same CRUD-symmetry
 * gap ADR-031 itself already flagged and filled for OptionGroup/Option/AddOn
 * ("Update/Delete... added beyond the Phase 18 brief's literal endpoint
 * list, for CRUD symmetry... flagged as a Remaining Decision pending
 * confirmation, not a unilateral scope expansion" - DOMAIN_MODEL.md). Added
 * here at implementation time for the same reason, not a new decision.
 */
export class MenuDeletedEvent extends DomainEvent {
  public readonly eventName = 'MenuDeleted';

  constructor(
    eventId: string,
    public readonly payload: { menuId: string; restaurantId: string; actorId: string },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

export class CategoryCreatedEvent extends DomainEvent {
  public readonly eventName = 'CategoryCreated';

  constructor(
    eventId: string,
    public readonly payload: {
      categoryId: string;
      menuId: string;
      restaurantId: string;
      actorId: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

export class CategoryUpdatedEvent extends DomainEvent {
  public readonly eventName = 'CategoryUpdated';

  constructor(
    eventId: string,
    public readonly payload: { categoryId: string; restaurantId: string; actorId: string },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

export class CategoryDeletedEvent extends DomainEvent {
  public readonly eventName = 'CategoryDeleted';

  constructor(
    eventId: string,
    public readonly payload: { categoryId: string; restaurantId: string; actorId: string },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

export class CategoriesReorderedEvent extends DomainEvent {
  public readonly eventName = 'CategoriesReordered';

  constructor(
    eventId: string,
    public readonly payload: {
      menuId: string;
      restaurantId: string;
      orderedCategoryIds: string[];
      actorId: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

export class MenuItemCreatedEvent extends DomainEvent {
  public readonly eventName = 'MenuItemCreated';

  constructor(
    eventId: string,
    public readonly payload: {
      menuItemId: string;
      categoryId: string;
      restaurantId: string;
      actorId: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

export class MenuItemUpdatedEvent extends DomainEvent {
  public readonly eventName = 'MenuItemUpdated';

  constructor(
    eventId: string,
    public readonly payload: { menuItemId: string; restaurantId: string; actorId: string },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

export class MenuItemDeletedEvent extends DomainEvent {
  public readonly eventName = 'MenuItemDeleted';

  constructor(
    eventId: string,
    public readonly payload: { menuItemId: string; restaurantId: string; actorId: string },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

export class MenuItemAvailabilityChangedEvent extends DomainEvent {
  public readonly eventName = 'MenuItemAvailabilityChanged';

  constructor(
    eventId: string,
    public readonly payload: {
      menuItemId: string;
      restaurantId: string;
      availabilityMode: string;
      actorId: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

/** ADR-032: whole-set bulk replacement of a Menu Item's `MenuItemAvailability` rows - payload omits day/time values (operational configuration, not audit-relevant). */
export class MenuItemAvailabilityWindowsReplacedEvent extends DomainEvent {
  public readonly eventName = 'MenuItemAvailabilityWindowsReplaced';

  constructor(
    eventId: string,
    public readonly payload: {
      menuItemId: string;
      restaurantId: string;
      windowCount: number;
      actorId: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

export class MenuItemFeaturedEvent extends DomainEvent {
  public readonly eventName = 'MenuItemFeatured';

  constructor(
    eventId: string,
    public readonly payload: { menuItemId: string; restaurantId: string; actorId: string },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

export class MenuItemUnfeaturedEvent extends DomainEvent {
  public readonly eventName = 'MenuItemUnfeatured';

  constructor(
    eventId: string,
    public readonly payload: { menuItemId: string; restaurantId: string; actorId: string },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

export class MenuItemsReorderedEvent extends DomainEvent {
  public readonly eventName = 'MenuItemsReordered';

  constructor(
    eventId: string,
    public readonly payload: {
      categoryId: string;
      restaurantId: string;
      orderedMenuItemIds: string[];
      actorId: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

export class OptionGroupCreatedEvent extends DomainEvent {
  public readonly eventName = 'OptionGroupCreated';

  constructor(
    eventId: string,
    public readonly payload: {
      optionGroupId: string;
      menuItemId: string;
      restaurantId: string;
      actorId: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

export class OptionGroupUpdatedEvent extends DomainEvent {
  public readonly eventName = 'OptionGroupUpdated';

  constructor(
    eventId: string,
    public readonly payload: { optionGroupId: string; restaurantId: string; actorId: string },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

export class OptionGroupDeletedEvent extends DomainEvent {
  public readonly eventName = 'OptionGroupDeleted';

  constructor(
    eventId: string,
    public readonly payload: { optionGroupId: string; restaurantId: string; actorId: string },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

export class OptionCreatedEvent extends DomainEvent {
  public readonly eventName = 'OptionCreated';

  constructor(
    eventId: string,
    public readonly payload: {
      optionId: string;
      optionGroupId: string;
      restaurantId: string;
      actorId: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

export class OptionUpdatedEvent extends DomainEvent {
  public readonly eventName = 'OptionUpdated';

  constructor(
    eventId: string,
    public readonly payload: { optionId: string; restaurantId: string; actorId: string },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

export class OptionDeletedEvent extends DomainEvent {
  public readonly eventName = 'OptionDeleted';

  constructor(
    eventId: string,
    public readonly payload: { optionId: string; restaurantId: string; actorId: string },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

export class AddOnCreatedEvent extends DomainEvent {
  public readonly eventName = 'AddOnCreated';

  constructor(
    eventId: string,
    public readonly payload: {
      addOnId: string;
      menuItemId: string;
      restaurantId: string;
      actorId: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

export class AddOnUpdatedEvent extends DomainEvent {
  public readonly eventName = 'AddOnUpdated';

  constructor(
    eventId: string,
    public readonly payload: { addOnId: string; restaurantId: string; actorId: string },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

export class AddOnDeletedEvent extends DomainEvent {
  public readonly eventName = 'AddOnDeleted';

  constructor(
    eventId: string,
    public readonly payload: { addOnId: string; restaurantId: string; actorId: string },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}
