import { ListAuditLogsUseCase } from './list-audit-logs.use-case';
import {
  AuditLogReaderPort,
  AuditLogRow,
  ListAuditLogsFilter,
  ListAuditLogsResult,
} from '../ports/audit-log-reader.port';
import { InvalidAuditLogQueryException } from '../../domain/exceptions/invalid-audit-log-query.exception';

class FakeAuditLogReader implements AuditLogReaderPort {
  rows: AuditLogRow[] = [];
  total = 0;
  lastFilter: ListAuditLogsFilter | undefined;

  async list(filter: ListAuditLogsFilter): Promise<ListAuditLogsResult> {
    this.lastFilter = filter;
    return { items: this.rows, total: this.total };
  }
}

describe('ListAuditLogsUseCase', () => {
  const from = new Date('2026-01-01T00:00:00.000Z');
  const to = new Date('2026-02-01T00:00:00.000Z');
  const sampleRow: AuditLogRow = {
    id: '11111111-1111-4111-8111-111111111111',
    actorId: '22222222-2222-4222-8222-222222222222',
    actorType: 'PlatformAdmin',
    action: 'platform_admin.admin_account.created',
    targetType: 'PlatformAdmin',
    targetId: '33333333-3333-4333-8333-333333333333',
    organizationId: null,
    correlationId: null,
    ipAddress: null,
    occurredAt: new Date('2026-01-15T10:00:00.000Z'),
  };

  function build() {
    const reader = new FakeAuditLogReader();
    const useCase = new ListAuditLogsUseCase(reader);
    return { useCase, reader };
  }

  it('rejects a range where from is not strictly before to', async () => {
    const { useCase } = build();

    await expect(
      useCase.execute({ from: to, to: from, page: 1, limit: 20 }),
    ).rejects.toBeInstanceOf(InvalidAuditLogQueryException);
  });

  it('rejects a range equal to from/to (from must be strictly before to)', async () => {
    const { useCase } = build();

    await expect(useCase.execute({ from, to: from, page: 1, limit: 20 })).rejects.toBeInstanceOf(
      InvalidAuditLogQueryException,
    );
  });

  it('rejects a range exceeding 366 days', async () => {
    const { useCase } = build();
    const tooFar = new Date(from.getTime() + 367 * 24 * 60 * 60 * 1000);

    await expect(useCase.execute({ from, to: tooFar, page: 1, limit: 20 })).rejects.toBeInstanceOf(
      InvalidAuditLogQueryException,
    );
  });

  it('accepts a range of exactly 366 days', async () => {
    const { useCase, reader } = build();
    const exactlyMax = new Date(from.getTime() + 366 * 24 * 60 * 60 * 1000);
    reader.total = 0;

    await expect(useCase.execute({ from, to: exactlyMax, page: 1, limit: 20 })).resolves.toEqual({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
    });
  });

  it('passes every filter through to the reader unchanged', async () => {
    const { useCase, reader } = build();

    await useCase.execute({
      from,
      to,
      actorId: 'actor-1',
      targetType: 'Restaurant',
      targetId: 'target-1',
      action: 'restaurant.suspended',
      organizationId: 'org-1',
      page: 3,
      limit: 50,
    });

    expect(reader.lastFilter).toEqual({
      from,
      to,
      actorId: 'actor-1',
      targetType: 'Restaurant',
      targetId: 'target-1',
      action: 'restaurant.suspended',
      organizationId: 'org-1',
      page: 3,
      limit: 50,
    });
  });

  it('returns an empty result unchanged', async () => {
    const { useCase } = build();

    const result = await useCase.execute({ from, to, page: 1, limit: 20 });

    expect(result).toEqual({ items: [], total: 0, page: 1, limit: 20 });
  });

  it('returns a bounded result with pagination echoed back from the query, not the reader', async () => {
    const { useCase, reader } = build();
    reader.rows = [sampleRow];
    reader.total = 1;

    const result = await useCase.execute({ from, to, page: 2, limit: 5 });

    expect(result).toEqual({ items: [sampleRow], total: 1, page: 2, limit: 5 });
  });
});
