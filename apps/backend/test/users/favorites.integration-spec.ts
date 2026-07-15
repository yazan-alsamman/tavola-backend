import { randomUUID } from 'crypto';
import { PrismaClient, UserStatus } from '@prisma/client';
import { PrismaFavoriteRestaurantRepository } from '@modules/users/infrastructure/persistence/prisma-favorite-restaurant.repository';
import { PrismaRestaurantDirectoryReader } from '@modules/users/infrastructure/persistence/prisma-restaurant-directory-reader';
import { FavoriteRestaurant } from '@modules/users/domain/entities/favorite-restaurant.entity';
import { UserId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { TenantContextMissingException } from '@infrastructure/tenancy/tenant-context-missing.exception';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

const prisma = new PrismaClient();
const TEST_PREFIX = 'favorites-integration-';

describe('Favorites round-trip via real PostgreSQL (integration)', () => {
  let favoriteRepository: PrismaFavoriteRestaurantRepository;
  let restaurantDirectoryReader: PrismaRestaurantDirectoryReader;
  let noContextPrismaContext: PrismaContext;
  let dbAvailable = false;
  let organizationId: string;

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([
      PrismaFavoriteRestaurantRepository,
      PrismaRestaurantDirectoryReader,
    ]);
    favoriteRepository = moduleRef.get(PrismaFavoriteRestaurantRepository);
    restaurantDirectoryReader = moduleRef.get(PrismaRestaurantDirectoryReader);
    // No request/TenantContextService.run() ever executes in this module,
    // so this instance's tenant context is genuinely unbound - the same
    // state a Customer `User` actor's request is always in.
    noContextPrismaContext = moduleRef.get(PrismaContext);

    organizationId = randomUUID();
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: `${TEST_PREFIX}org`,
        slug: `${TEST_PREFIX}${randomUUID()}`,
        billingEmail: `${TEST_PREFIX}${randomUUID()}@example.com`,
      },
    });
  });

  afterAll(async () => {
    if (!dbAvailable) {
      return;
    }

    await prisma.favorite.deleteMany({ where: { restaurant: { organizationId } } });
    await prisma.restaurant.deleteMany({ where: { organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
    await prisma.$disconnect();
  });

  async function seedUser(): Promise<string> {
    const userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        firstName: 'Favorites',
        lastName: 'Tester',
        email: `${TEST_PREFIX}${randomUUID()}@example.com`,
        passwordHash: 'argon2id$test',
        phone: null,
        language: 'en',
        preferredCurrency: null,
        status: UserStatus.Active,
        emailVerified: true,
      },
    });
    return userId;
  }

  async function seedRestaurant(overrides?: {
    status?: string;
    deletedAt?: Date | null;
  }): Promise<string> {
    const restaurantId = randomUUID();
    await prisma.restaurant.create({
      data: {
        id: restaurantId,
        organizationId,
        name: `${TEST_PREFIX}restaurant`,
        slug: `${TEST_PREFIX}${randomUUID()}`,
        status: overrides?.status ?? 'Active',
        deletedAt: overrides?.deletedAt ?? null,
      },
    });
    return restaurantId;
  }

  it('persists an added favorite and lists it back', async () => {
    if (!dbAvailable) return;
    const userId = await seedUser();
    const restaurantId = await seedRestaurant();

    const saved = await favoriteRepository.add(
      FavoriteRestaurant.create({
        id: randomUUID(),
        userId,
        restaurantId,
        createdAt: new Date(),
      }),
    );
    expect(saved.restaurantId).toBe(restaurantId);

    const page = await favoriteRepository.listByUser(UserId.create(userId), 1, 20);
    expect(page.total).toBe(1);
    expect(page.items[0].restaurantId).toBe(restaurantId);

    const row = await prisma.favorite.findUnique({
      where: { userId_restaurantId: { userId, restaurantId } },
    });
    expect(row).not.toBeNull();
  });

  it('is idempotent under real concurrent duplicate adds (database unique constraint)', async () => {
    if (!dbAvailable) return;
    const userId = await seedUser();
    const restaurantId = await seedRestaurant();

    const [first, second] = await Promise.all([
      favoriteRepository.add(
        FavoriteRestaurant.create({
          id: randomUUID(),
          userId,
          restaurantId,
          createdAt: new Date(),
        }),
      ),
      favoriteRepository.add(
        FavoriteRestaurant.create({
          id: randomUUID(),
          userId,
          restaurantId,
          createdAt: new Date(),
        }),
      ),
    ]);

    expect(first.id).toBe(second.id); // both calls resolved to the same persisted row
    const rows = await prisma.favorite.findMany({ where: { userId, restaurantId } });
    expect(rows).toHaveLength(1);
  });

  it('removes a favorite idempotently (repeated remove is a no-op)', async () => {
    if (!dbAvailable) return;
    const userId = await seedUser();
    const restaurantId = await seedRestaurant();
    await favoriteRepository.add(
      FavoriteRestaurant.create({ id: randomUUID(), userId, restaurantId, createdAt: new Date() }),
    );

    await favoriteRepository.remove(UserId.create(userId), RestaurantId.create(restaurantId));
    await favoriteRepository.remove(UserId.create(userId), RestaurantId.create(restaurantId));

    const rows = await prisma.favorite.findMany({ where: { userId, restaurantId } });
    expect(rows).toHaveLength(0);
  });

  it('keeps favorites isolated across users and across restaurants', async () => {
    if (!dbAvailable) return;
    const userA = await seedUser();
    const userB = await seedUser();
    const restaurantId = await seedRestaurant();

    await favoriteRepository.add(
      FavoriteRestaurant.create({
        id: randomUUID(),
        userId: userA,
        restaurantId,
        createdAt: new Date(),
      }),
    );

    const pageA = await favoriteRepository.listByUser(UserId.create(userA), 1, 20);
    const pageB = await favoriteRepository.listByUser(UserId.create(userB), 1, 20);
    expect(pageA.total).toBe(1);
    expect(pageB.total).toBe(0);
  });

  it('orders favorites most-recently-favorited first', async () => {
    if (!dbAvailable) return;
    const userId = await seedUser();
    const restaurantOld = await seedRestaurant();
    const restaurantNew = await seedRestaurant();

    await favoriteRepository.add(
      FavoriteRestaurant.create({
        id: randomUUID(),
        userId,
        restaurantId: restaurantOld,
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
      }),
    );
    await favoriteRepository.add(
      FavoriteRestaurant.create({
        id: randomUUID(),
        userId,
        restaurantId: restaurantNew,
        createdAt: new Date('2026-07-10T00:00:00.000Z'),
      }),
    );

    const page = await favoriteRepository.listByUser(UserId.create(userId), 1, 20);
    expect(page.items.map((item) => item.restaurantId)).toEqual([restaurantNew, restaurantOld]);
  });

  it('PrismaRestaurantDirectoryReader finds an existing restaurant and excludes organizationId', async () => {
    if (!dbAvailable) return;
    const restaurantId = await seedRestaurant();

    const summary = await restaurantDirectoryReader.findById(restaurantId);

    expect(summary).not.toBeNull();
    expect(summary?.id).toBe(restaurantId);
    expect(summary).not.toHaveProperty('organizationId');
  });

  it('PrismaRestaurantDirectoryReader returns null for a soft-deleted restaurant', async () => {
    if (!dbAvailable) return;
    const restaurantId = await seedRestaurant({ deletedAt: new Date() });

    const summary = await restaurantDirectoryReader.findById(restaurantId);

    expect(summary).toBeNull();
  });

  it('PrismaRestaurantDirectoryReader batch-fetches multiple restaurants without N+1', async () => {
    if (!dbAvailable) return;
    const restaurantA = await seedRestaurant();
    const restaurantB = await seedRestaurant();

    const summaries = await restaurantDirectoryReader.findManyByIds([
      restaurantA,
      restaurantB,
      randomUUID(), // non-existent id must be silently excluded, not error
    ]);

    expect(summaries.map((summary) => summary.id).sort()).toEqual(
      [restaurantA, restaurantB].sort(),
    );
  });

  /**
   * The architectural crux this module's Favorites feature depends on:
   * proves against a real, live Postgres connection (not a mock) that a
   * standard tenant-scoped query against `Restaurant` genuinely fails closed
   * with no bound TenantContext (exactly the state a Customer `User` actor
   * is always in), while `PrismaRestaurantDirectoryReader`'s raw-client
   * exception succeeds for the identical row.
   */
  it('demonstrates why PrismaRestaurantDirectoryReader must bypass tenant scoping', async () => {
    if (!dbAvailable) return;
    const restaurantId = await seedRestaurant();

    await expect(
      noContextPrismaContext.client.restaurant.findUnique({ where: { id: restaurantId } }),
    ).rejects.toBeInstanceOf(TenantContextMissingException);

    const summary = await restaurantDirectoryReader.findById(restaurantId);
    expect(summary?.id).toBe(restaurantId);
  });
});
