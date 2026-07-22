import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import {
  PendingCustomerRegistrationRecord,
  PendingCustomerRegistrationRepository,
} from '../../domain/repositories/authentication.repositories';
import { UsernameAlreadyExistsException } from '../../domain/exceptions/username-already-exists.exception';

function toRecord(row: {
  id: string;
  username: string;
  phone: string;
  codeHash: string;
  codeExpiresAt: Date;
  incorrectAttemptCount: number;
  verifiedAt: Date | null;
  consumedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): PendingCustomerRegistrationRecord {
  return { ...row };
}

function violatesUniqueUsername(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const target = error.meta?.target;
  return Array.isArray(target) ? target.includes('username') : String(target).includes('username');
}

@Injectable()
export class PrismaPendingCustomerRegistrationRepository implements PendingCustomerRegistrationRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async findByPhone(phone: string): Promise<PendingCustomerRegistrationRecord | null> {
    const row = await this.prismaContext.client.pendingCustomerRegistration.findUnique({
      where: { phone },
    });
    return row ? toRecord(row) : null;
  }

  async findById(id: string): Promise<PendingCustomerRegistrationRecord | null> {
    const row = await this.prismaContext.client.pendingCustomerRegistration.findUnique({
      where: { id },
    });
    return row ? toRecord(row) : null;
  }

  async upsertActive(input: {
    username: string;
    phone: string;
    codeHash: string;
    codeExpiresAt: Date;
    now: Date;
  }): Promise<PendingCustomerRegistrationRecord> {
    try {
      const row = await this.prismaContext.client.pendingCustomerRegistration.upsert({
        where: { phone: input.phone },
        create: {
          username: input.username,
          phone: input.phone,
          codeHash: input.codeHash,
          codeExpiresAt: input.codeExpiresAt,
          incorrectAttemptCount: 0,
          verifiedAt: null,
          consumedAt: null,
          createdAt: input.now,
          updatedAt: input.now,
        },
        update: {
          username: input.username,
          codeHash: input.codeHash,
          codeExpiresAt: input.codeExpiresAt,
          incorrectAttemptCount: 0,
          verifiedAt: null,
          updatedAt: input.now,
        },
      });
      return toRecord(row);
    } catch (error) {
      if (violatesUniqueUsername(error)) {
        throw new UsernameAlreadyExistsException();
      }
      throw error;
    }
  }

  async incrementAttemptCount(id: string): Promise<void> {
    await this.prismaContext.client.pendingCustomerRegistration.update({
      where: { id },
      data: { incorrectAttemptCount: { increment: 1 } },
    });
  }

  async markVerified(id: string, at: Date): Promise<void> {
    await this.prismaContext.client.pendingCustomerRegistration.update({
      where: { id },
      data: { verifiedAt: at, updatedAt: at },
    });
  }

  async consumeIfVerifiedAndUnconsumed(
    id: string,
    at: Date,
  ): Promise<PendingCustomerRegistrationRecord | null> {
    const result = await this.prismaContext.client.pendingCustomerRegistration.updateMany({
      where: { id, consumedAt: null, verifiedAt: { not: null } },
      data: { consumedAt: at, updatedAt: at },
    });
    if (result.count !== 1) {
      return null;
    }
    return this.findById(id);
  }

  async deleteById(id: string): Promise<void> {
    await this.prismaContext.client.pendingCustomerRegistration.deleteMany({ where: { id } });
  }

  async existsByUsername(username: string): Promise<boolean> {
    const count = await this.prismaContext.client.pendingCustomerRegistration.count({
      where: { username },
    });
    return count > 0;
  }

  async existsByPhone(phone: string): Promise<boolean> {
    const count = await this.prismaContext.client.pendingCustomerRegistration.count({
      where: { phone },
    });
    return count > 0;
  }
}
