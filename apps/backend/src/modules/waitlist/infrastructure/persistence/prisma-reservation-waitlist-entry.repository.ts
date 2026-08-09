import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { BranchId, UserId } from '@shared/domain/value-objects/identifiers.vo';
import { ReservationWaitlistEntry } from '../../domain/entities/reservation-waitlist-entry.entity';
import { WaitlistStatus } from '../../domain/enums/waitlist.enums';
import { WaitlistPositionConflictException } from '../../domain/exceptions/waitlist-position-conflict.exception';
import { ReservationWaitlistEntryRepository } from '../../domain/repositories/reservation-waitlist-entry.repository';
import { ReservationWaitlistEntryPrismaMapper } from './reservation-waitlist-entry.prisma-mapper';

/**
 * Partial unique index (`reservation_waitlist_entries_active_position_key`)
 * is not modeled in `schema.prisma` (raw SQL only, same technique as
 * ADR-013's exclusion constraint) - a violation surfaces as a standard
 * unique-violation, which Prisma DOES recognize natively as `P2002` (unlike
 * an exclusion-constraint violation, which it cannot). Verified against a
 * live Postgres instance: `error.meta.target` is the raw **column list**
 * (`['branch_id', 'preferred_date', 'position']`), never the index name
 * itself - matched on that column set, not a name substring (a name-substring
 * check against the stringified column array can never match, since Prisma
 * never includes the constraint name in `meta.target` for P2002). Matched
 * defensively as an unknown-request error too, in case a future Prisma/driver
 * version surfaces it differently (mirrors `isReservationExclusionViolation`'s
 * own belt-and-suspenders style).
 */
const ACTIVE_POSITION_INDEX_NAME = 'reservation_waitlist_entries_active_position_key';
const ACTIVE_POSITION_INDEX_COLUMNS = ['branch_id', 'preferred_date', 'position'];

function isWaitlistPositionConflict(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const target = error.meta?.target;
    const columns = Array.isArray(target) ? target : typeof target === 'string' ? [target] : [];
    if (ACTIVE_POSITION_INDEX_COLUMNS.every((column) => columns.includes(column))) {
      return true;
    }
  }
  return (
    error instanceof Prisma.PrismaClientUnknownRequestError &&
    error.message.includes(ACTIVE_POSITION_INDEX_NAME)
  );
}

/**
 * `ReservationWaitlistEntry` carries no direct `organizationId` (Phase 7.5
 * tenancy correction) and is not registered in `withTenantScoping`'s
 * `DIRECT_TENANT_OWNED_MODELS` - the ordinary tenant-scoped `PrismaContext`
 * client is a safe no-op passthrough here, exactly like
 * `PrismaReservationRepository`'s own doc comment explains for `Reservation`.
 */
@Injectable()
export class PrismaReservationWaitlistEntryRepository implements ReservationWaitlistEntryRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async findById(id: string): Promise<ReservationWaitlistEntry | null> {
    const row = await this.prismaContext.client.reservationWaitlistEntry.findUnique({
      where: { id },
    });
    return row ? ReservationWaitlistEntryPrismaMapper.toDomain(row) : null;
  }

  async acquireQueueLock(branchId: BranchId, preferredDate: Date): Promise<void> {
    const key = this.queueLockKey(branchId, preferredDate);
    await this.prismaContext.client
      .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  }

  async findMaxPositionForScope(branchId: BranchId, preferredDate: Date): Promise<number> {
    const result = await this.prismaContext.client.reservationWaitlistEntry.aggregate({
      where: {
        branchId: branchId.value,
        preferredDate,
        deletedAt: null,
      },
      _max: { position: true },
    });
    return result._max.position ?? 0;
  }

  async createInTransaction(entry: ReservationWaitlistEntry): Promise<void> {
    const data = ReservationWaitlistEntryPrismaMapper.toPersistence(entry);
    try {
      await this.prismaContext.client.reservationWaitlistEntry.create({ data });
    } catch (error) {
      if (isWaitlistPositionConflict(error)) {
        throw new WaitlistPositionConflictException();
      }
      throw error;
    }
  }

  async findActiveByBranchAndDateOrderedByPosition(
    branchId: BranchId,
    preferredDate: Date,
  ): Promise<ReservationWaitlistEntry[]> {
    const rows = await this.prismaContext.client.reservationWaitlistEntry.findMany({
      where: {
        branchId: branchId.value,
        preferredDate,
        status: { in: [WaitlistStatus.Waiting, WaitlistStatus.Notified] },
        deletedAt: null,
      },
      orderBy: { position: 'asc' },
    });
    return rows.map((row) => ReservationWaitlistEntryPrismaMapper.toDomain(row));
  }

  async findActiveByUserId(userId: UserId): Promise<ReservationWaitlistEntry[]> {
    const rows = await this.prismaContext.client.reservationWaitlistEntry.findMany({
      where: {
        userId: userId.value,
        status: { in: [WaitlistStatus.Waiting, WaitlistStatus.Notified] },
        deletedAt: null,
      },
    });
    return rows.map((row) => ReservationWaitlistEntryPrismaMapper.toDomain(row));
  }

  async updateTransitioningFrom(
    entry: ReservationWaitlistEntry,
    expectedCurrentStatus: WaitlistStatus,
  ): Promise<boolean> {
    const data = ReservationWaitlistEntryPrismaMapper.toPersistence(entry);
    const result = await this.prismaContext.client.reservationWaitlistEntry.updateMany({
      where: { id: data.id, status: expectedCurrentStatus },
      data: {
        status: data.status,
        convertedReservationId: data.convertedReservationId,
        notifiedAt: data.notifiedAt,
        updatedAt: data.updatedAt,
      },
    });
    return result.count > 0;
  }

  async claimStatusOnly(
    id: string,
    targetStatus: WaitlistStatus,
    expectedCurrentStatus: WaitlistStatus,
    updatedAt: Date,
  ): Promise<boolean> {
    const result = await this.prismaContext.client.reservationWaitlistEntry.updateMany({
      where: { id, status: expectedCurrentStatus },
      data: { status: targetStatus, updatedAt },
    });
    return result.count > 0;
  }

  private queueLockKey(branchId: BranchId, preferredDate: Date): string {
    const dateOnly = preferredDate.toISOString().slice(0, 10);
    return `waitlist:${branchId.value}:${dateOnly}`;
  }
}
