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

import { PrismaClient, RolePermissionType, RoleScope } from '@prisma/client';

const prisma = new PrismaClient();

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
    permissionSlugs: ['reservations:create', 'reservations:approve'],
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

async function main(): Promise<void> {
  await seedSystemConfiguration();
  const permissionIds = await seedPermissions();
  await seedRoles(permissionIds);
  await seedCuisineCategories();
  await seedOccasionCategories();
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
