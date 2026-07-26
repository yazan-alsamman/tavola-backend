import { ReservationWaitlistEntry } from '@modules/waitlist/domain/entities/reservation-waitlist-entry.entity';
import { WaitlistStatus } from '@modules/waitlist/domain/enums/waitlist.enums';
import { WaitlistPositionConflictException } from '@modules/waitlist/domain/exceptions/waitlist-position-conflict.exception';
import { ReservationWaitlistEntryRepository } from '@modules/waitlist/domain/repositories/reservation-waitlist-entry.repository';
import { BranchId } from '@shared/domain/value-objects/identifiers.vo';

function sameDate(a: Date, b: Date): boolean {
  return a.getTime() === b.getTime();
}

export class InMemoryReservationWaitlistEntryRepository implements ReservationWaitlistEntryRepository {
  private readonly rows = new Map<string, ReservationWaitlistEntry>();
  public readonly acquiredLockKeys: string[] = [];

  async findById(id: string): Promise<ReservationWaitlistEntry | null> {
    return this.rows.get(id) ?? null;
  }

  async acquireQueueLock(branchId: BranchId, preferredDate: Date): Promise<void> {
    this.acquiredLockKeys.push(
      `waitlist:${branchId.value}:${preferredDate.toISOString().slice(0, 10)}`,
    );
  }

  async findMaxPositionForScope(branchId: BranchId, preferredDate: Date): Promise<number> {
    let max = 0;
    for (const row of this.rows.values()) {
      if (
        row.branchId.value === branchId.value &&
        sameDate(row.preferredDate, preferredDate) &&
        row.deletedAt === null &&
        row.position > max
      ) {
        max = row.position;
      }
    }
    return max;
  }

  async createInTransaction(entry: ReservationWaitlistEntry): Promise<void> {
    const activeConflict = [...this.rows.values()].some(
      (row) =>
        row.branchId.value === entry.branchId.value &&
        sameDate(row.preferredDate, entry.preferredDate) &&
        row.position === entry.position &&
        row.deletedAt === null &&
        (row.status === WaitlistStatus.Waiting || row.status === WaitlistStatus.Notified),
    );
    if (activeConflict) {
      throw new WaitlistPositionConflictException();
    }
    this.rows.set(entry.entryId, entry);
  }

  async findActiveByBranchAndDateOrderedByPosition(
    branchId: BranchId,
    preferredDate: Date,
  ): Promise<ReservationWaitlistEntry[]> {
    return [...this.rows.values()]
      .filter(
        (row) =>
          row.branchId.value === branchId.value &&
          sameDate(row.preferredDate, preferredDate) &&
          row.deletedAt === null &&
          (row.status === WaitlistStatus.Waiting || row.status === WaitlistStatus.Notified),
      )
      .sort((a, b) => a.position - b.position);
  }

  async updateTransitioningFrom(
    entry: ReservationWaitlistEntry,
    expectedCurrentStatus: WaitlistStatus,
  ): Promise<boolean> {
    const current = this.rows.get(entry.entryId);
    if (!current || current.status !== expectedCurrentStatus) {
      return false;
    }
    this.rows.set(entry.entryId, entry);
    return true;
  }

  async claimStatusOnly(
    id: string,
    targetStatus: WaitlistStatus,
    expectedCurrentStatus: WaitlistStatus,
    updatedAt: Date,
  ): Promise<boolean> {
    const current = this.rows.get(id);
    if (!current || current.status !== expectedCurrentStatus) {
      return false;
    }
    this.rows.set(
      id,
      ReservationWaitlistEntry.reconstitute({
        ...current.toProps(),
        status: targetStatus,
        updatedAt,
      }),
    );
    return true;
  }

  /** Test-only helper: seeds a row directly. */
  seed(entry: ReservationWaitlistEntry): void {
    this.rows.set(entry.entryId, entry);
  }
}

// Type-check that the fake actually satisfies the real interface.
const _typeCheck: ReservationWaitlistEntryRepository =
  new InMemoryReservationWaitlistEntryRepository();
void _typeCheck;
