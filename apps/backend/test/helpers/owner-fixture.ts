import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import authConfig from '@config/auth.config';
import { Argon2PasswordHasher } from '@modules/authentication/infrastructure/security/argon2-password-hasher';
import { Password } from '@shared/domain/value-objects/password.vo';

/**
 * ADR-022 (Phase 2.23) retired the public `POST /auth/register` Owner
 * self-registration route - Restaurant Owners are now provisioned
 * exclusively via an authenticated Platform Admin action
 * (`POST /platform-admin/restaurant-owners`). Many e2e suites across other
 * modules (reservations, restaurants, employees, tables, branches, taxonomy)
 * only needed `/auth/register` as a way to get a real, logged-in Owner
 * fixture into the database - not to exercise registration itself - so they
 * seed the User/Organization/OrganizationMember rows directly here (the same
 * end state `RegisterOrganizationOwnerUseCase` used to leave behind: an
 * `Active`/`emailVerified` User owning a fresh Organization) and still
 * authenticate through the real `POST /auth/login` endpoint.
 */
export async function hashTestPassword(password: string): Promise<string> {
  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true, load: [authConfig] })],
    providers: [Argon2PasswordHasher],
  }).compile();
  const hasher = moduleRef.get(Argon2PasswordHasher);
  return (await hasher.hash(Password.create(password))).value;
}

export interface SeedOwnerAndOrganizationInput {
  email: string;
  passwordHash: string;
  firstName?: string;
  lastName?: string;
  organizationName: string;
  organizationSlug?: string;
}

export interface SeedOwnerAndOrganizationResult {
  userId: string;
  organizationId: string;
}

export async function seedOwnerAndOrganization(
  prisma: PrismaClient,
  input: SeedOwnerAndOrganizationInput,
): Promise<SeedOwnerAndOrganizationResult> {
  const userId = randomUUID();
  const organizationId = randomUUID();
  const now = new Date();

  await prisma.user.create({
    data: {
      id: userId,
      firstName: input.firstName ?? 'Owner',
      lastName: input.lastName ?? 'Fixture',
      email: input.email,
      passwordHash: input.passwordHash,
      language: 'en',
      status: 'Active',
      emailVerified: true,
    },
  });

  await prisma.organization.create({
    data: {
      id: organizationId,
      name: input.organizationName,
      slug: input.organizationSlug ?? input.organizationName,
      billingEmail: input.email,
    },
  });

  await prisma.organizationMember.create({
    data: {
      id: randomUUID(),
      organizationId,
      userId,
      role: 'Owner',
      status: 'Active',
      invitedAt: now,
      joinedAt: now,
    },
  });

  // Phase 12 (Subscriptions, ADR-027 §11, D7/D26): every Organization must
  // have exactly one Subscription. This fixture bypasses
  // `ProvisionRestaurantOwnerUseCase` (the real code path that provisions
  // one), so it mirrors that provisioning step here directly - the same
  // "default" seeded plan (`prisma/seed.ts`), Active, indefinite. Without
  // this, every e2e suite using this fixture and then creating a
  // Restaurant/Branch/Employee through the real API would fail with
  // SubscriptionNotFoundException.
  const defaultPlan = await prisma.subscriptionPlan.findUnique({ where: { slug: 'default' } });
  if (defaultPlan) {
    await prisma.subscription.create({
      data: {
        id: randomUUID(),
        organizationId,
        subscriptionPlanId: defaultPlan.id,
        status: 'Active',
        startsAt: now,
        endsAt: null,
      },
    });
    await prisma.subscriptionUsage.create({
      data: { id: randomUUID(), organizationId, restaurantCount: 0, updatedAt: now },
    });
  }

  return { userId, organizationId };
}
