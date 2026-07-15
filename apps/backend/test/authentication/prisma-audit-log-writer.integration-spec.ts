import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaAuditLogWriter } from '@infrastructure/audit/prisma-audit-log-writer';
import { AuditLogEntry } from '@shared/application/ports/audit-log-writer.port';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

const rawPrisma = new PrismaClient();

function baseEntry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    actorId: null,
    actorType: 'User',
    action: 'auth.login.success',
    targetType: null,
    targetId: null,
    organizationId: null,
    correlationId: null,
    ipAddress: null,
    occurredAt: new Date('2026-07-12T10:00:00.000Z'),
    ...overrides,
  };
}

describe('PrismaAuditLogWriter (integration, real Postgres)', () => {
  let dbAvailable = false;
  let writer: PrismaAuditLogWriter;

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([PrismaAuditLogWriter]);
    writer = moduleRef.get(PrismaAuditLogWriter);
  });

  afterAll(async () => {
    if (dbAvailable) {
      await rawPrisma.auditLog.deleteMany({
        where: { correlationId: { startsWith: 'audit-writer-' } },
      });
      await rawPrisma.$disconnect();
    }
  });

  it('persists every documented field exactly as given', async () => {
    if (!dbAvailable) return;

    const correlationId = `audit-writer-${randomUUID()}`;
    const actorId = randomUUID();
    const organizationId = randomUUID();
    const occurredAt = new Date('2026-07-12T10:15:00.000Z');

    await writer.record(
      baseEntry({
        actorId,
        actorType: 'Employee',
        action: 'auth.permission.denied',
        targetType: 'Permission',
        targetId: 'reservations:approve',
        organizationId,
        correlationId,
        ipAddress: '203.0.113.7',
        occurredAt,
      }),
    );

    const row = await rawPrisma.auditLog.findFirst({ where: { correlationId } });
    expect(row).toMatchObject({
      actorId,
      actorType: 'Employee',
      action: 'auth.permission.denied',
      targetType: 'Permission',
      targetId: 'reservations:approve',
      organizationId,
      correlationId,
      ipAddress: '203.0.113.7',
    });
    expect(row?.occurredAt).toEqual(occurredAt);
  });

  it('persists null actorId/organizationId/targetType for pre-authentication actions', async () => {
    if (!dbAvailable) return;

    const correlationId = `audit-writer-${randomUUID()}`;
    await writer.record(
      baseEntry({ action: 'auth.login.failed', correlationId, ipAddress: '198.51.100.1' }),
    );

    const row = await rawPrisma.auditLog.findFirst({ where: { correlationId } });
    expect(row?.actorId).toBeNull();
    expect(row?.organizationId).toBeNull();
    expect(row?.targetType).toBeNull();
    expect(row?.targetId).toBeNull();
  });

  it('is idempotent-safe to call repeatedly - each call creates its own immutable row', async () => {
    if (!dbAvailable) return;

    const correlationId = `audit-writer-${randomUUID()}`;
    await writer.record(baseEntry({ action: 'auth.login.success', correlationId }));
    await writer.record(baseEntry({ action: 'auth.login.success', correlationId }));

    const rows = await rawPrisma.auditLog.findMany({ where: { correlationId } });
    expect(rows).toHaveLength(2);
  });

  it('never throws even when given a value the database will reject, and logs instead', async () => {
    if (!dbAvailable) return;

    const correlationId = `audit-writer-${randomUUID()}`;
    // actorType isn't a valid AuditActorType enum member at the DB level -
    // Prisma will reject this at the database, and the writer's documented
    // contract is to swallow it, not propagate a failure to the caller.
    await expect(
      writer.record(
        baseEntry({
          actorType: 'NotARealActorType' as unknown as AuditLogEntry['actorType'],
          correlationId,
        }),
      ),
    ).resolves.toBeUndefined();

    const row = await rawPrisma.auditLog.findFirst({ where: { correlationId } });
    expect(row).toBeNull();
  });
});
