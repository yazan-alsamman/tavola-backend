import { Injectable } from '@nestjs/common';
import { BranchClosure as PrismaBranchClosure } from '@prisma/client';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { BranchClosure } from '../../domain/entities/branch-closure.entity';
import { BranchClosureRepository } from '../../domain/repositories/branch-closure.repository';

function toDbDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function fromDbDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toDomain(row: PrismaBranchClosure): BranchClosure {
  return BranchClosure.reconstitute({
    id: row.id,
    branchId: row.branchId,
    startDate: fromDbDate(row.startDate),
    endDate: fromDbDate(row.endDate),
    reason: row.reason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

/** Branch child table: no tenant isolation here (see the port's comment). */
@Injectable()
export class PrismaBranchClosureRepository implements BranchClosureRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async findUpcoming(branchId: string, fromDate: string): Promise<BranchClosure[]> {
    const rows = await this.prismaContext.client.branchClosure.findMany({
      where: { branchId, endDate: { gte: toDbDate(fromDate) } },
      orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toDomain);
  }

  async findById(id: string, branchId: string): Promise<BranchClosure | null> {
    const row = await this.prismaContext.client.branchClosure.findFirst({
      where: { id, branchId },
    });
    return row ? toDomain(row) : null;
  }

  async isClosedOn(branchId: string, date: string): Promise<boolean> {
    const day = toDbDate(date);
    const count = await this.prismaContext.client.branchClosure.count({
      where: { branchId, startDate: { lte: day }, endDate: { gte: day } },
    });
    return count > 0;
  }

  async save(closure: BranchClosure): Promise<void> {
    const data = {
      branchId: closure.branchId,
      startDate: toDbDate(closure.startDate),
      endDate: toDbDate(closure.endDate),
      reason: closure.reason,
      updatedAt: closure.updatedAt,
    };
    await this.prismaContext.client.branchClosure.upsert({
      where: { id: closure.closureId },
      create: { id: closure.closureId, createdAt: closure.createdAt, ...data },
      update: data,
    });
  }

  async remove(id: string): Promise<void> {
    await this.prismaContext.client.branchClosure.delete({ where: { id } });
  }
}
