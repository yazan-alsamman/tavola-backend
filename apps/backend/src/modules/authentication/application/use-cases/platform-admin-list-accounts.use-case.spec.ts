import { PlatformAdminListAccountsUseCase } from './platform-admin-list-accounts.use-case';
import { PlatformAdminGetAccountUseCase } from './platform-admin-get-account.use-case';
import { UserNotFoundException } from '../exceptions/user-not-found.exception';
import {
  PlatformAdminAccountDetailRow,
  PlatformAdminAccountQuery,
  PlatformAdminAccountReaderPort,
  PlatformAdminAccountRow,
} from '../ports/platform-admin-account-reader.port';

const ROW: PlatformAdminAccountRow = {
  userId: '5e2a9c14-8d37-4b61-a0f5-72c1e9b4d803',
  email: 'farid@example.com',
  phone: null,
  username: 'farid',
  firstName: 'Farid',
  lastName: 'Haddad',
  status: 'Active',
  accountType: 'Customer',
  emailVerified: true,
  lastLoginAt: null,
  createdAt: new Date('2026-06-11T07:22:19.004Z'),
  deletedAt: null,
};

class FakeReader implements PlatformAdminAccountReaderPort {
  lastQuery: PlatformAdminAccountQuery | undefined;
  constructor(
    private readonly page: { items: PlatformAdminAccountRow[]; total: number },
    private readonly detail: PlatformAdminAccountDetailRow | null = null,
  ) {}
  async search(query: PlatformAdminAccountQuery) {
    this.lastQuery = query;
    return this.page;
  }
  async findDetailById() {
    return this.detail;
  }
}

describe('PlatformAdminListAccountsUseCase', () => {
  it('passes every filter through and echoes pagination metadata', async () => {
    const reader = new FakeReader({ items: [ROW], total: 137 });
    const useCase = new PlatformAdminListAccountsUseCase(reader);

    const result = await useCase.execute({
      q: 'farid',
      status: 'Active',
      accountType: 'Customer',
      page: 3,
      limit: 50,
    });

    expect(reader.lastQuery).toEqual({
      q: 'farid',
      status: 'Active',
      accountType: 'Customer',
      page: 3,
      limit: 50,
    });
    // `total` is the full match count, not the page size - a console needs it
    // to render "page 3 of N" correctly.
    expect(result).toEqual({ items: [ROW], total: 137, page: 3, limit: 50 });
  });

  it('returns the ordinary list for an empty q rather than short-circuiting to nothing', async () => {
    // The whole reason this endpoint exists: a console must be able to browse
    // accounts to obtain a userId. Treating a blank search as "no results"
    // would push it straight back to asking an operator to paste a UUID.
    const reader = new FakeReader({ items: [ROW], total: 1 });
    const useCase = new PlatformAdminListAccountsUseCase(reader);

    const result = await useCase.execute({ q: '', page: 1, limit: 20 });

    expect(reader.lastQuery?.q).toBe('');
    expect(result.items).toEqual([ROW]);
    expect(result.total).toBe(1);
  });

  it('reports an empty page honestly when nothing matches', async () => {
    const reader = new FakeReader({ items: [], total: 0 });
    const useCase = new PlatformAdminListAccountsUseCase(reader);

    const result = await useCase.execute({ q: 'nobody', page: 1, limit: 20 });

    expect(result).toEqual({ items: [], total: 0, page: 1, limit: 20 });
  });
});

describe('PlatformAdminGetAccountUseCase', () => {
  const detail: PlatformAdminAccountDetailRow = {
    ...ROW,
    language: 'en',
    preferredCurrency: null,
    notificationOptIn: true,
    marketingOptIn: false,
    failedLoginCount: 0,
    lockedUntil: null,
    passwordChangedAt: null,
    deletionRequestedAt: null,
    scheduledAnonymizationAt: null,
    anonymizedAt: null,
    activeSessionCount: 2,
    organizations: [],
    updatedAt: new Date('2026-09-02T13:45:00.000Z'),
  };

  it('returns the full detail row', async () => {
    const useCase = new PlatformAdminGetAccountUseCase(
      new FakeReader({ items: [], total: 0 }, detail),
    );

    await expect(useCase.execute({ userId: ROW.userId })).resolves.toEqual(detail);
  });

  it('returns a soft-deleted account rather than hiding it behind a 404', async () => {
    // Seeing that an account was deleted is the point of looking it up - a
    // 404 here would be indistinguishable from "never existed".
    const deleted = { ...detail, status: 'Deleted', deletedAt: new Date() };
    const useCase = new PlatformAdminGetAccountUseCase(
      new FakeReader({ items: [], total: 0 }, deleted),
    );

    const result = await useCase.execute({ userId: ROW.userId });

    expect(result.deletedAt).not.toBeNull();
    expect(result.status).toBe('Deleted');
  });

  it('throws UserNotFoundException only for a genuinely nonexistent id', async () => {
    const useCase = new PlatformAdminGetAccountUseCase(new FakeReader({ items: [], total: 0 }));

    await expect(useCase.execute({ userId: ROW.userId })).rejects.toBeInstanceOf(
      UserNotFoundException,
    );
  });
});
