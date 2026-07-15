import { Injectable } from '@nestjs/common';
import { UnitOfWorkPort } from '@shared/application/ports/unit-of-work.port';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';

@Injectable()
export class PrismaUnitOfWork implements UnitOfWorkPort {
  constructor(private readonly prismaContext: PrismaContext) {}

  execute<T>(work: () => Promise<T>): Promise<T> {
    return this.prismaContext.runInTransaction(work);
  }
}
