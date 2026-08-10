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

import * as argon2 from 'argon2';
import {
  NotificationChannel,
  PlatformAdminRole,
  PrismaClient,
  RolePermissionType,
  RoleScope,
  UserStatus,
} from '@prisma/client';

const prisma = new PrismaClient();

const PLATFORM_ADMIN_BOOTSTRAP_MIN_PASSWORD_LENGTH = 12;

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
  {
    // Phase 15.6 (Messaging, DECISIONS.md D6) - customer-only: only a staff
    // reply (Employee/OrganizationMember sender) ever reaches
    // NotificationDispatcher for this eventType; a Customer-sent message
    // never does (see resolveNotificationIntent's own MessageSent branch).
    eventType: 'MessageSent',
    channel: NotificationChannel.InApp,
    title: 'New message',
    body: 'You have a new message from the restaurant.',
  },
  {
    eventType: 'MessageSent',
    channel: NotificationChannel.Push,
    title: 'New message',
    body: 'You have a new message from the restaurant. Tap to view.',
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
  {
    key: 'anonymizationGracePeriodDays',
    value: 30,
    description:
      'ADR-014: days between a verified Request Account Deletion and irreversible anonymization; cancellable within this window',
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
  {
    slug: 'conversations:manage',
    description: 'Read and reply to customer-restaurant conversations within assigned branch scope',
  },
  {
    slug: 'menu:manage',
    description: 'Create and manage menus, categories, items, options, and add-ons',
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
      'conversations:manage',
      'menu:manage',
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
      'conversations:manage',
    ],
  },
  {
    name: 'Cashier',
    slug: 'cashier',
    description: 'Reservation operations within branch scope',
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

/**
 * Phase 12 (Subscriptions, architecture frozen 2026-07-28, ADR-027 §11/D2/D3).
 * Generic architecture - no commercial tier name is frozen (D3); `default`
 * is a seed-managed provisioning slug, not a product/marketing name.
 * Referenced by `SYSTEM_CONFIG_KEYS.defaultSubscriptionPlanSlug`'s fallback
 * (`ProvisionRestaurantOwnerUseCase`) for automatic provisioning at
 * Organization creation (D7). Limits are a starting default only, not a
 * frozen commercial commitment - adjust via a new seeded plan + explicit
 * subscription migration (ADR-027 §10 Plan Immutability), never by editing
 * this row's numbers once any Subscription references it.
 */
const DEFAULT_SUBSCRIPTION_PLAN = {
  name: 'Default Plan',
  slug: 'default',
  maxRestaurants: 10,
  maxBranchesPerRestaurant: 10,
  maxEmployeesPerRestaurant: 50,
};

async function seedSubscriptionPlans(): Promise<void> {
  await prisma.subscriptionPlan.upsert({
    where: { slug: DEFAULT_SUBSCRIPTION_PLAN.slug },
    create: DEFAULT_SUBSCRIPTION_PLAN,
    update: {
      name: DEFAULT_SUBSCRIPTION_PLAN.name,
      maxRestaurants: DEFAULT_SUBSCRIPTION_PLAN.maxRestaurants,
      maxBranchesPerRestaurant: DEFAULT_SUBSCRIPTION_PLAN.maxBranchesPerRestaurant,
      maxEmployeesPerRestaurant: DEFAULT_SUBSCRIPTION_PLAN.maxEmployeesPerRestaurant,
    },
  });
}

/**
 * ADR-033 §20 - the Platform default acquisition fee (1000 SYP), seeded as a
 * single `Platform`-scope `AcquisitionPricingRule` row - never a hardcoded
 * application constant (CLAUDE.md's "never hardcoded values" rule, the same
 * way `DEFAULT_SUBSCRIPTION_PLAN` above satisfies it for Subscriptions).
 * `AcquisitionPricingRule` rows are never edited in place (ADR-033 §15), so
 * this is idempotent by existence check, not `upsert`-by-natural-key like
 * `seedSubscriptionPlans` above (this entity intentionally has no natural
 * unique business key - re-running this seed against an environment that
 * already has ANY non-archived Platform-scope rule is a pure no-op, exactly
 * like `seedPlatformAdminBootstrap` below).
 */
const DEFAULT_ACQUISITION_PRICING_RULE = {
  scopeType: 'Platform',
  feeType: 'Flat',
  flatAmount: 1000,
  flatCurrency: 'SYP',
  label: 'Default Platform acquisition fee',
  // No PlatformAdmin actor exists at first-deploy seed time (this seed can
  // run before `PLATFORM_ADMIN_BOOTSTRAP_*` creates one) - `createdBy` on
  // this table is a plain audit-trail UUID column with no FK constraint
  // (mirrors `AuditLog.actorId`'s own precedent), so a fixed system
  // sentinel is safe here, never a real user id.
  createdBy: '00000000-0000-4000-8000-000000000000',
} as const;

async function seedDefaultAcquisitionPricingRule(): Promise<void> {
  const existing = await prisma.acquisitionPricingRule.findFirst({
    where: { scopeType: 'Platform', archivedAt: null },
  });
  if (existing) {
    return;
  }

  await prisma.acquisitionPricingRule.create({
    data: {
      scopeType: DEFAULT_ACQUISITION_PRICING_RULE.scopeType,
      scopeId: null,
      feeType: DEFAULT_ACQUISITION_PRICING_RULE.feeType,
      flatAmount: DEFAULT_ACQUISITION_PRICING_RULE.flatAmount,
      flatCurrency: DEFAULT_ACQUISITION_PRICING_RULE.flatCurrency,
      effectiveFrom: new Date(),
      effectiveTo: null,
      label: DEFAULT_ACQUISITION_PRICING_RULE.label,
      createdBy: DEFAULT_ACQUISITION_PRICING_RULE.createdBy,
    },
  });
}

/**
 * ADR-034 §10 (FR-19.1) operational bootstrap for the very first
 * PlatformAdmin account (`CreatePlatformAdminUseCase`'s own doc comment
 * references this exact `PLATFORM_ADMIN_BOOTSTRAP_*` row).
 * AUTHENTICATION_ARCHITECTURE.md §7.12: PlatformAdmin accounts are
 * provisioned operationally, seeded directly, never via any API — this is
 * that seed path, not a new API surface.
 *
 * Only runs when every `PLATFORM_ADMIN_BOOTSTRAP_*` variable is set. Unset
 * in every already-provisioned environment's env file, so re-running this
 * seed there is a pure no-op — existing installations are unaffected.
 * Idempotent by email: if a User with this email already exists, its
 * password/name are left untouched and a PlatformAdmin row is created for
 * it only if one doesn't already exist yet — never a second PlatformAdmin
 * row for the same account.
 */
async function seedPlatformAdminBootstrap(): Promise<void> {
  const email = process.env.PLATFORM_ADMIN_BOOTSTRAP_EMAIL;
  const password = process.env.PLATFORM_ADMIN_BOOTSTRAP_PASSWORD;
  const firstName = process.env.PLATFORM_ADMIN_BOOTSTRAP_FIRST_NAME;
  const lastName = process.env.PLATFORM_ADMIN_BOOTSTRAP_LAST_NAME;

  if (!email || !password || !firstName || !lastName) {
    return;
  }

  if (password.length < PLATFORM_ADMIN_BOOTSTRAP_MIN_PASSWORD_LENGTH) {
    throw new Error(
      `PLATFORM_ADMIN_BOOTSTRAP_PASSWORD must be at least ${PLATFORM_ADMIN_BOOTSTRAP_MIN_PASSWORD_LENGTH} characters (matches PasswordPolicy).`,
    );
  }

  const existingUser = await prisma.user.findUnique({
    where: { email },
    include: { platformAdmin: true },
  });

  if (existingUser) {
    if (!existingUser.platformAdmin) {
      await prisma.platformAdmin.create({
        data: { userId: existingUser.id, role: PlatformAdminRole.PlatformAdmin, revokedAt: null },
      });
    }
    return;
  }

  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: Number(process.env.ARGON2_MEMORY_COST ?? 65536),
    timeCost: Number(process.env.ARGON2_TIME_COST ?? 3),
    parallelism: Number(process.env.ARGON2_PARALLELISM ?? 1),
  });

  await prisma.user.create({
    data: {
      firstName,
      lastName,
      email,
      passwordHash,
      language: 'en',
      status: UserStatus.Active,
      emailVerified: true,
      platformAdmin: { create: { role: PlatformAdminRole.PlatformAdmin, revokedAt: null } },
    },
  });
}

async function main(): Promise<void> {
  await seedSystemConfiguration();
  const permissionIds = await seedPermissions();
  await seedRoles(permissionIds);
  await seedCuisineCategories();
  await seedOccasionCategories();
  await seedNotificationTemplates();
  await seedSubscriptionPlans();
  await seedDefaultAcquisitionPricingRule();
  await seedPlatformAdminBootstrap();
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
