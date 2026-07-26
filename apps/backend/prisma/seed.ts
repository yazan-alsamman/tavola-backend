/**
 * Phase 2.1 foundation seed — reference data only.
 * No demo users, restaurants, or reservations.
 *
 * Organization Owner is an OrganizationMemberRole enum value, not a Roles row.
 * Customer is an implicit actor (no Employee / Roles row).
 *
 * @see docs/AUTHENTICATION_ARCHITECTURE.md §7.12
 * @see docs/AUTHORIZATION_ARCHITECTURE.md §5
 */

import { NotificationChannel, PrismaClient, RolePermissionType, RoleScope } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Phase 9 (Notification System, architecture frozen 2026-07-25) - one
 * `isDefault: true` English row per `(eventType, channel)` pair the frozen
 * event -> notification allow-list requires (TASKS.md decision item 17).
 * `ReservationNoShow` seeds only `InApp` (its frozen classification is
 * In-App-only - `NotificationDispatcher` never resolves a Push template for
 * it, so seeding one would be dead data). Generic, lock-screen-safe copy
 * only - never `ReservationGuest` contact fields, internal ids, or notes
 * (the frozen PII policy). Additional languages are a pure content/data
 * addition (LOCALIZATION.md), never a code change - not seeded here.
 */
const NOTIFICATION_TEMPLATES: Array<{
  eventType: string;
  channel: NotificationChannel;
  title: string;
  body: string;
}> = [
  {
    eventType: 'ReservationApproved',
    channel: NotificationChannel.InApp,
    title: 'Reservation confirmed',
    body: 'Your reservation has been confirmed.',
  },
  {
    eventType: 'ReservationApproved',
    channel: NotificationChannel.Push,
    title: 'Reservation confirmed',
    body: 'Your reservation has been confirmed. Tap to view details.',
  },
  {
    eventType: 'ReservationCancelled',
    channel: NotificationChannel.InApp,
    title: 'Reservation cancelled',
    body: 'Your reservation has been cancelled.',
  },
  {
    eventType: 'ReservationCancelled',
    channel: NotificationChannel.Push,
    title: 'Reservation cancelled',
    body: 'Your reservation has been cancelled. Tap for details.',
  },
  {
    eventType: 'ReservationRescheduled',
    channel: NotificationChannel.InApp,
    title: 'Reservation rescheduled',
    body: 'Your reservation time has changed.',
  },
  {
    eventType: 'ReservationRescheduled',
    channel: NotificationChannel.Push,
    title: 'Reservation rescheduled',
    body: 'Your reservation time has changed. Tap to view the new details.',
  },
  {
    eventType: 'ReservationReminderDue',
    channel: NotificationChannel.InApp,
    title: 'Upcoming reservation',
    body: 'You have an upcoming reservation soon.',
  },
  {
    eventType: 'ReservationReminderDue',
    channel: NotificationChannel.Push,
    title: 'Reservation reminder',
    body: 'Your reservation is coming up soon.',
  },
  {
    eventType: 'TableReadyNotified',
    channel: NotificationChannel.InApp,
    title: 'Your table is ready',
    body: 'Your table is ready for seating.',
  },
  {
    eventType: 'TableReadyNotified',
    channel: NotificationChannel.Push,
    title: 'Table ready',
    body: 'Your table is ready. Please head to the host stand.',
  },
  {
    eventType: 'WaitlistEntryPromoted',
    channel: NotificationChannel.InApp,
    title: "You're off the waitlist",
    body: 'A table is now available for you.',
  },
  {
    eventType: 'WaitlistEntryPromoted',
    channel: NotificationChannel.Push,
    title: 'Table available',
    body: 'A table is now available for you. Tap to view details.',
  },
  {
    eventType: 'ReservationNoShow',
    channel: NotificationChannel.InApp,
    title: 'Marked as no-show',
    body: 'Your reservation was marked as a no-show.',
  },
];

const SYSTEM_CONFIGURATION: Array<{
  key: string;
  value: number | boolean;
  description: string;
}> = [
  {
    key: 'passwordResetTokenTtlHours',
    value: 1,
    description: 'Password reset link lifetime in hours',
  },
  {
    key: 'passwordHistoryCount',
    value: 5,
    description: 'Number of previous passwords retained for reuse prevention',
  },
  {
    key: 'maxFailedLoginAttempts',
    value: 5,
    description: 'Failed login attempts before account lock',
  },
  {
    key: 'accountLockDurationMinutes',
    value: 30,
    description: 'Automatic account unlock duration in minutes',
  },
  {
    key: 'maxActiveSessionsPerUser',
    value: 10,
    description: 'Maximum concurrent active device sessions per user',
  },
  {
    key: 'refreshTokenTtlDays',
    value: 30,
    description: 'Refresh token lifetime in days',
  },
  {
    key: 'otpExpiryMinutes',
    value: 5,
    description: 'ADR-022: WhatsApp OTP lifetime in minutes (registration and password recovery)',
  },
  {
    key: 'otpMaxIncorrectAttempts',
    value: 5,
    description: 'ADR-022: max incorrect OTP attempts before the code becomes unusable',
  },
  {
    key: 'otpResendCooldownSeconds',
    value: 60,
    description: 'ADR-022: minimum seconds between OTP resend requests for the same phone',
  },
];

const PERMISSIONS: Array<{ slug: string; description: string }> = [
  {
    slug: 'organization:members:manage',
    description: 'Invite, remove, and change organization member roles',
  },
  {
    slug: 'restaurants:manage',
    description: 'Create, update, and configure restaurants',
  },
  {
    slug: 'branches:manage',
    description: 'Create, update, and configure branches',
  },
  {
    slug: 'reservations:create',
    description: 'Create reservations on behalf of guests',
  },
  {
    slug: 'reservations:approve',
    description: 'Approve or reject pending reservations',
  },
  {
    slug: 'reservations:cancel',
    description: 'Cancel reservations on behalf of guests',
  },
  {
    slug: 'reservations:reschedule',
    description: 'Reschedule reservations on behalf of guests',
  },
  {
    slug: 'reservations:complete',
    description: 'Mark approved reservations as completed',
  },
  {
    slug: 'reservations:noshow',
    description: 'Mark approved reservations as a no-show',
  },
  {
    slug: 'reservations:tableready',
    description: 'Mark an approved reservation\'s table as ready for the guest',
  },
  {
    slug: 'reservations:waitlist',
    description: 'Join, cancel, and promote branch waitlist entries on behalf of guests',
  },
  {
    slug: 'tables:manage',
    description: 'Manage tables, merge, and split operations',
  },
  {
    slug: 'employees:manage',
    description: 'Invite, assign roles, and manage employees',
  },
  {
    slug: 'reports:view',
    description: 'View operational and analytics reports',
  },
  {
    slug: 'offers:manage',
    description: 'Create and publish restaurant offers',
  },
];

const ROLES: Array<{
  name: string;
  slug: string;
  description: string;
  scope: RoleScope;
  permissionSlugs: string[];
}> = [
  {
    name: 'Restaurant Manager',
    slug: 'manager',
    description: 'Full restaurant operational access within assigned scope',
    scope: RoleScope.Restaurant,
    permissionSlugs: [
      'restaurants:manage',
      'branches:manage',
      'reservations:create',
      'reservations:approve',
      'reservations:cancel',
      'reservations:reschedule',
      'reservations:complete',
      'reservations:noshow',
      'reservations:tableready',
      'reservations:waitlist',
      'tables:manage',
      'employees:manage',
      'reports:view',
      'offers:manage',
    ],
  },
  {
    name: 'Receptionist',
    slug: 'receptionist',
    description: 'Front-of-house reservation and guest management',
    scope: RoleScope.Restaurant,
    permissionSlugs: [
      'reservations:create',
      'reservations:approve',
      'reservations:cancel',
      'reservations:reschedule',
      'reservations:complete',
      'reservations:noshow',
      'reservations:tableready',
      'reservations:waitlist',
    ],
  },
  {
    name: 'Cashier',
    slug: 'cashier',
    description: 'Payment and checkout operations within branch scope',
    scope: RoleScope.Restaurant,
    permissionSlugs: ['reservations:create'],
  },
];

const CUISINE_CATEGORIES: Array<{ slug: string; name: string; sortOrder: number }> = [
  { slug: 'italian', name: 'Italian', sortOrder: 0 },
  { slug: 'japanese', name: 'Japanese', sortOrder: 1 },
  { slug: 'chinese', name: 'Chinese', sortOrder: 2 },
  { slug: 'indian', name: 'Indian', sortOrder: 3 },
  { slug: 'mexican', name: 'Mexican', sortOrder: 4 },
  { slug: 'french', name: 'French', sortOrder: 5 },
  { slug: 'turkish', name: 'Turkish', sortOrder: 6 },
  { slug: 'lebanese', name: 'Lebanese', sortOrder: 7 },
  { slug: 'american', name: 'American', sortOrder: 8 },
  { slug: 'seafood', name: 'Seafood', sortOrder: 9 },
  { slug: 'vegetarian', name: 'Vegetarian', sortOrder: 10 },
  { slug: 'steakhouse', name: 'Steakhouse', sortOrder: 11 },
];

const OCCASION_CATEGORIES: Array<{ slug: string; name: string; sortOrder: number }> = [
  { slug: 'date-night', name: 'Date Night', sortOrder: 0 },
  { slug: 'business-lunch', name: 'Business Lunch', sortOrder: 1 },
  { slug: 'family', name: 'Family', sortOrder: 2 },
  { slug: 'birthday', name: 'Birthday', sortOrder: 3 },
  { slug: 'group-gathering', name: 'Group Gathering', sortOrder: 4 },
  { slug: 'casual', name: 'Casual', sortOrder: 5 },
  { slug: 'fine-dining', name: 'Fine Dining', sortOrder: 6 },
];

async function seedCuisineCategories(): Promise<void> {
  for (const category of CUISINE_CATEGORIES) {
    await prisma.cuisineCategory.upsert({
      where: { slug: category.slug },
      create: { slug: category.slug, name: category.name, sortOrder: category.sortOrder },
      update: { name: category.name, sortOrder: category.sortOrder },
    });
  }
}

async function seedOccasionCategories(): Promise<void> {
  for (const category of OCCASION_CATEGORIES) {
    await prisma.occasionCategory.upsert({
      where: { slug: category.slug },
      create: { slug: category.slug, name: category.name, sortOrder: category.sortOrder },
      update: { name: category.name, sortOrder: category.sortOrder },
    });
  }
}

async function seedSystemConfiguration(): Promise<void> {
  for (const entry of SYSTEM_CONFIGURATION) {
    await prisma.systemConfiguration.upsert({
      where: { key: entry.key },
      create: {
        key: entry.key,
        value: entry.value,
        description: entry.description,
      },
      update: {
        value: entry.value,
        description: entry.description,
      },
    });
  }
}

async function seedPermissions(): Promise<Map<string, string>> {
  const permissionIds = new Map<string, string>();

  for (const permission of PERMISSIONS) {
    const row = await prisma.permission.upsert({
      where: { slug: permission.slug },
      create: permission,
      update: { description: permission.description },
    });
    permissionIds.set(permission.slug, row.id);
  }

  return permissionIds;
}

async function seedRoles(permissionIds: Map<string, string>): Promise<void> {
  for (const role of ROLES) {
    const roleRow = await prisma.role.upsert({
      where: { slug: role.slug },
      create: {
        name: role.name,
        slug: role.slug,
        description: role.description,
        scope: role.scope,
      },
      update: {
        name: role.name,
        description: role.description,
        scope: role.scope,
      },
    });

    for (const slug of role.permissionSlugs) {
      const permissionId = permissionIds.get(slug);
      if (!permissionId) {
        throw new Error(`Missing permission slug in catalog: ${slug}`);
      }

      const existing = await prisma.rolePermission.findFirst({
        where: {
          roleId: roleRow.id,
          permissionId,
          type: RolePermissionType.RoleGrant,
        },
      });

      if (!existing) {
        await prisma.rolePermission.create({
          data: {
            roleId: roleRow.id,
            permissionId,
            type: RolePermissionType.RoleGrant,
          },
        });
      }
    }
  }
}

async function seedNotificationTemplates(): Promise<void> {
  for (const template of NOTIFICATION_TEMPLATES) {
    await prisma.notificationTemplate.upsert({
      where: {
        eventType_language_channel: {
          eventType: template.eventType,
          language: 'en',
          channel: template.channel,
        },
      },
      create: {
        eventType: template.eventType,
        language: 'en',
        channel: template.channel,
        title: template.title,
        body: template.body,
        isDefault: true,
      },
      update: {
        title: template.title,
        body: template.body,
        isDefault: true,
      },
    });
  }
}

async function main(): Promise<void> {
  await seedSystemConfiguration();
  const permissionIds = await seedPermissions();
  await seedRoles(permissionIds);
  await seedCuisineCategories();
  await seedOccasionCategories();
  await seedNotificationTemplates();
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
