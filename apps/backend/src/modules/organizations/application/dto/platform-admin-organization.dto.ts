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

/** ADR-035 §3 - includes `organizationId` (the target itself, already known from the route, but kept for response self-containment). */
export interface PlatformAdminOrganizationResult {
  organizationId: string;
  name: string;
  status: string;
  updatedAt: Date;
}

export interface OwnershipTransferResult {
  organizationId: string;
  previousOwnerUserId: string;
  newOwnerUserId: string;
}
