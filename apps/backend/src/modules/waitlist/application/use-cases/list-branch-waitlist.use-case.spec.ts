import { ListBranchWaitlistUseCase } from './list-branch-waitlist.use-case';
import {
  StaffWaitlistFilters,
  StaffWaitlistItem,
  StaffWaitlistReaderPort,
} from '../ports/staff-waitlist-reader.port';
import { WaitlistStatus } from '../../domain/enums/waitlist.enums';
import { PermissionDeniedException } from '@modules/authorization/domain/exceptions/permission-denied.exception';
import { EmployeeBranchNotAssignedException } from '@modules/authorization/domain/exceptions/employee-branch-not-assigned.exception';
import { BranchNotFoundException } from '@modules/branches/domain/exceptions/branch-not-found.exception';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { Branch } from '@modules/branches/domain/entities/branch.entity';
import { InMemoryBranchRepository } from '../../../../../test/branches/support/in-memory-branch.repository';
import {
  organizationMemberActor,
  restaurantRepositoryWith,
} from '../../../../../test/waitlist/support/waitlist-staff-fixtures';

class RecordingStaffWaitlistReader implements StaffWaitlistReaderPort {
  readonly calls: Array<{ restaurantId: string; branchId: string; filters: StaffWaitlistFilters }> =
    [];
  constructor(private readonly items: StaffWaitlistItem[]) {}

  async listForBranchDay(
    restaurantId: string,
    branchId: string,
    filters: StaffWaitlistFilters,
  ): Promise<StaffWaitlistItem[]> {
    this.calls.push({ restaurantId, branchId, filters });
    return this.items;
  }
}

describe('ListBranchWaitlistUseCase', () => {
  const now = new Date('2026-08-01T10:00:00.000Z');
  const restaurantId = '33333333-3333-4333-8333-333333333333';
  const branchId = '44444444-4444-4444-8444-444444444444';
  const preferredDate = new Date('2026-08-01T00:00:00.000Z');

  const item: StaffWaitlistItem = {
    entryId: '11111111-1111-4111-8111-111111111111',
    restaurantId,
    branchId,
    userId: null,
    reservationGuestId: '22222222-2222-4222-8222-222222222222',
    partySize: 3,
    preferredDate,
    preferredTimeFrom: new Date(Date.UTC(1970, 0, 1, 19, 0, 0)),
    preferredTimeTo: null,
    status: WaitlistStatus.Waiting,
    position: 1,
    convertedReservationId: null,
    notifiedAt: null,
    expiresAt: new Date('2026-08-01T23:59:59.999Z'),
    notes: null,
    createdAt: now,
    updatedAt: now,
    customer: { type: 'Guest', name: 'Rami', phone: '+96170000000' },
  } as StaffWaitlistItem;

  function employeeActor(overrides?: {
    branchIds?: string[];
    permissions?: string[];
    restaurantId?: string;
  }) {
    return {
      actorType: AccessTokenActorType.Employee as const,
      userId: 'employee-user-1',
      sessionId: 'session-1',
      sessionVersion: 1,
      tokenFamilyId: 'family-1',
      employeeId: 'employee-1',
      organizationId: 'org-1',
      restaurantId: overrides?.restaurantId ?? restaurantId,
      branchIds: overrides?.branchIds ?? [],
      permissions: overrides?.permissions ?? ['reservations:waitlist'],
      permissionsVersion: 1,
    } as AuthenticatedActor;
  }

  async function build() {
    const branchRepository = new InMemoryBranchRepository();
    await branchRepository.save(
      Branch.create({
        id: branchId,
        restaurantId,
        city: 'Beirut',
        district: null,
        address: 'Hamra',
        latitude: null,
        longitude: null,
        countryCode: 'LB',
        currency: null,
        timezone: 'Asia/Beirut',
        phone: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      }),
    );
    const reader = new RecordingStaffWaitlistReader([item]);
    const useCase = new ListBranchWaitlistUseCase(
      reader,
      branchRepository,
      await restaurantRepositoryWith(restaurantId, now),
    );
    return { useCase, reader };
  }

  it('lets the organization Owner read the day queue', async () => {
    const { useCase, reader } = await build();
    const result = await useCase.execute({
      actor: organizationMemberActor('Owner'),
      restaurantId,
      branchId,
      preferredDate,
      status: WaitlistStatus.Waiting,
    });
    expect(result).toEqual([item]);
    expect(reader.calls).toEqual([
      { restaurantId, branchId, filters: { preferredDate, status: WaitlistStatus.Waiting } },
    ]);
  });

  it('refuses an organization member who is not Owner/Admin', async () => {
    const { useCase, reader } = await build();
    await expect(
      useCase.execute({
        actor: organizationMemberActor('Staff'),
        restaurantId,
        branchId,
        preferredDate,
      }),
    ).rejects.toThrow(PermissionDeniedException);
    expect(reader.calls).toHaveLength(0);
  });

  it('lets an Employee with reservations:waitlist read it', async () => {
    const { useCase } = await build();
    await expect(
      useCase.execute({ actor: employeeActor(), restaurantId, branchId, preferredDate }),
    ).resolves.toEqual([item]);
  });

  it('refuses an Employee without the permission', async () => {
    const { useCase } = await build();
    await expect(
      useCase.execute({
        actor: employeeActor({ permissions: [] }),
        restaurantId,
        branchId,
        preferredDate,
      }),
    ).rejects.toThrow(PermissionDeniedException);
  });

  it('refuses an Employee outside branch scope', async () => {
    const { useCase } = await build();
    await expect(
      useCase.execute({
        actor: employeeActor({ branchIds: ['other-branch'] }),
        restaurantId,
        branchId,
        preferredDate,
      }),
    ).rejects.toThrow(EmployeeBranchNotAssignedException);
  });

  it('hides another restaurant as not found', async () => {
    const { useCase } = await build();
    await expect(
      useCase.execute({
        actor: employeeActor({ restaurantId: '99999999-9999-4999-8999-999999999999' }),
        restaurantId,
        branchId,
        preferredDate,
      }),
    ).rejects.toThrow(BranchNotFoundException);
  });

  it('returns not found for a branch of the restaurant that does not exist', async () => {
    const { useCase } = await build();
    await expect(
      useCase.execute({
        actor: employeeActor(),
        restaurantId,
        branchId: '55555555-5555-4555-8555-555555555555',
        preferredDate,
      }),
    ).rejects.toThrow(BranchNotFoundException);
  });

  it('refuses a customer', async () => {
    const { useCase } = await build();
    const customer = {
      actorType: AccessTokenActorType.User,
      userId: 'customer-1',
      sessionId: 's',
      sessionVersion: 1,
      tokenFamilyId: 'f',
    } as AuthenticatedActor;
    await expect(
      useCase.execute({ actor: customer, restaurantId, branchId, preferredDate }),
    ).rejects.toThrow(PermissionDeniedException);
  });
});
