/** TS mirror of the Prisma `NotificationBroadcastSenderType` enum (ADR-037). */
export enum NotificationBroadcastSenderType {
  PlatformAdmin = 'PlatformAdmin',
  OrganizationMember = 'OrganizationMember',
}

/** TS mirror of the Prisma `NotificationBroadcastStatus` enum (ADR-037). */
export enum NotificationBroadcastStatus {
  Pending = 'Pending',
  Processing = 'Processing',
  Completed = 'Completed',
  Failed = 'Failed',
}
