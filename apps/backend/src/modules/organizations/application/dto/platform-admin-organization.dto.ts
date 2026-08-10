export interface PlatformAdminOrganizationLifecycleCommand {
  organizationId: string;
  actorId: string;
  correlationId?: string;
}

export interface TransferOrganizationOwnershipCommand {
  organizationId: string;
  newOwnerUserId: string;
  actorId: string;
  correlationId?: string;
}

/**
 * ADR-035 §3 - includes `organizationId` (the target itself, already known
 * from the route, but kept for response self-containment). `deletedAt`
 * (Phase 19.4) is included so the response of Delete/Restore is
 * self-explanatory, mirroring `PlatformAdminRestaurantResult`'s identical
 * field for the exact same reason - harmless for Suspend/Reactivate's own
 * responses, which simply always echo `null`.
 */
export interface PlatformAdminOrganizationResult {
  organizationId: string;
  name: string;
  status: string;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface OwnershipTransferResult {
  organizationId: string;
  previousOwnerUserId: string;
  newOwnerUserId: string;
}
