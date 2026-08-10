import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaAuditLogReader } from '@modules/platform-admin/infrastructure/persistence/prisma-audit-log.reader';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

const rawPrisma = new PrismaClient();
const CORRELATION_PREFIX = 'audit-log-reader-';

describe('PrismaAuditLogReader (integration, real Postgres)', () => {
  let dbAvailable = false;
  let reader: PrismaAuditLogReader;

  const from = new Date('2026-03-01T00:00:00.000Z');
  const to = new Date('2026-03-02T00:00:00.000Z');

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([PrismaAuditLogReader]);
    reader = moduleRef.get(PrismaAuditLogReader);
  });

  afterAll(async () => {
    if (dbAvailable) {
      await rawPrisma.auditLog.deleteMany({
        where: { correlationId: { startsWith: CORRELATION_PREFIX } },
      });
      await rawPrisma.$disconnect();
    }
  });

  async function seedRow(overrides: {
    actorId?: string | null;
    actorType?: 'User' | 'Employee' | 'System' | 'PlatformAdmin';
    action: string;
    targetType?: string | null;
    targetId?: string | null;
    organizationId?: string | null;
    occurredAt: Date;
  }): Promise<void> {
    await rawPrisma.auditLog.create({
      data: {
        id: randomUUID(),
        actorId: overrides.actorId ?? null,
        actorType: overrides.actorType ?? 'System',
        action: overrides.action,
        targetType: overrides.targetType ?? null,
        targetId: overrides.targetId ?? null,
        organizationId: overrides.organizationId ?? null,
        correlationId: `${CORRELATION_PREFIX}${randomUUID()}`,
        ipAddress: null,
        occurredAt: overrides.occurredAt,
      },
    });
  }

  it('retrieves rows within the date range, ordered newest-first', async () => {
    if (!dbAvailable) return;
    const actorId = randomUUID();
    await seedRow({
      actorId,
      action: 'ordering.first',
      occurredAt: new Date('2026-03-01T10:00:00.000Z'),
    });
    await seedRow({
      actorId,
      action: 'ordering.second',
      occurredAt: new Date('2026-03-01T12:00:00.000Z'),
    });

    const result = await reader.list({ from, to, actorId, page: 1, limit: 20 });

    expect(result.total).toBe(2);
    expect(result.items.map((r) => r.action)).toEqual(['ordering.second', 'ordering.first']);
  });

  it('excludes rows outside the [from, to) window', async () => {
    if (!dbAvailable) return;
    const actorId = randomUUID();
    await seedRow({
      actorId,
      action: 'outside.before',
      occurredAt: new Date('2026-02-28T23:00:00.000Z'),
    });
    await seedRow({
      actorId,
      action: 'inside.window',
      occurredAt: new Date('2026-03-01T05:00:00.000Z'),
    });
    await seedRow({
      actorId,
      action: 'outside.after',
      occurredAt: new Date('2026-03-02T01:00:00.000Z'),
    });

    const result = await reader.list({ from, to, actorId, page: 1, limit: 20 });

    expect(result.items.map((r) => r.action)).toEqual(['inside.window']);
  });

  it('filters by actorId (UUID)', async () => {
    if (!dbAvailable) return;
    const targetActor = randomUUID();
    const otherActor = randomUUID();
    await seedRow({
      actorId: targetActor,
      action: 'actor.match',
      occurredAt: new Date('2026-03-01T08:00:00.000Z'),
    });
    await seedRow({
      actorId: otherActor,
      action: 'actor.no-match',
      occurredAt: new Date('2026-03-01T08:00:00.000Z'),
    });

    const result = await reader.list({ from, to, actorId: targetActor, page: 1, limit: 20 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].action).toBe('actor.match');
  });

  it('filters by action', async () => {
    if (!dbAvailable) return;
    const actorId = randomUUID();
    await seedRow({
      actorId,
      action: 'restaurant.suspended',
      occurredAt: new Date('2026-03-01T08:00:00.000Z'),
    });
    await seedRow({
      actorId,
      action: 'restaurant.reactivated',
      occurredAt: new Date('2026-03-01T08:00:00.000Z'),
    });

    const result = await reader.list({
      from,
      to,
      actorId,
      action: 'restaurant.suspended',
      page: 1,
      limit: 20,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].action).toBe('restaurant.suspended');
  });

  it('filters by targetType and targetId together', async () => {
    if (!dbAvailable) return;
    const actorId = randomUUID();
    const targetId = randomUUID();
    await seedRow({
      actorId,
      action: 'target.match',
      targetType: 'Restaurant',
      targetId,
      occurredAt: new Date('2026-03-01T08:00:00.000Z'),
    });
    await seedRow({
      actorId,
      action: 'target.wrong-type',
      targetType: 'Organization',
      targetId,
      occurredAt: new Date('2026-03-01T08:00:00.000Z'),
    });

    const result = await reader.list({
      from,
      to,
      actorId,
      targetType: 'Restaurant',
      targetId,
      page: 1,
      limit: 20,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].action).toBe('target.match');
  });

  it('filters by organizationId (UUID)', async () => {
    if (!dbAvailable) return;
    const actorId = randomUUID();
    const organizationId = randomUUID();
    await seedRow({
      actorId,
      action: 'org.match',
      organizationId,
      occurredAt: new Date('2026-03-01T08:00:00.000Z'),
    });
    await seedRow({
      actorId,
      action: 'org.no-match',
      organizationId: randomUUID(),
      occurredAt: new Date('2026-03-01T08:00:00.000Z'),
    });

    const result = await reader.list({ from, to, actorId, organizationId, page: 1, limit: 20 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].action).toBe('org.match');
  });

  it('paginates - page 2 returns the next slice, total reflects the full match count', async () => {
    if (!dbAvailable) return;
    const actorId = randomUUID();
    for (let i = 0; i < 5; i += 1) {
      await seedRow({
        actorId,
        action: `page.item.${i}`,
        occurredAt: new Date(from.getTime() + i * 60 * 60 * 1000),
      });
    }

    const page1 = await reader.list({ from, to, actorId, page: 1, limit: 2 });
    const page2 = await reader.list({ from, to, actorId, page: 2, limit: 2 });

    expect(page1.total).toBe(5);
    expect(page1.items).toHaveLength(2);
    expect(page2.total).toBe(5);
    expect(page2.items).toHaveLength(2);
    expect(page1.items[0].id).not.toBe(page2.items[0].id);
  });

  it('returns an empty page when nothing matches', async () => {
    if (!dbAvailable) return;

    const result = await reader.list({
      from,
      to,
      actorId: randomUUID(),
      page: 1,
      limit: 20,
    });

    expect(result).toEqual({ items: [], total: 0 });
  });

  it('never exposes any field beyond the documented AuditLog schema (no credential/token leakage surface)', async () => {
    if (!dbAvailable) return;
    const actorId = randomUUID();
    await seedRow({
      actorId,
      action: 'shape.check',
      occurredAt: new Date('2026-03-01T08:00:00.000Z'),
    });

    const result = await reader.list({ from, to, actorId, page: 1, limit: 20 });

    expect(Object.keys(result.items[0]).sort()).toEqual(
      [
        'id',
        'actorId',
        'actorType',
        'action',
        'targetType',
        'targetId',
        'organizationId',
        'correlationId',
        'ipAddress',
        'occurredAt',
      ].sort(),
    );
  });
});
