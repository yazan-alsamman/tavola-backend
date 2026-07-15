import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import {
  LoginAttemptRecord,
  LoginAttemptRepository,
} from '../../domain/repositories/authentication.repositories';

@Injectable()
export class PrismaLoginAttemptRepository implements LoginAttemptRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async save(record: LoginAttemptRecord): Promise<void> {
    await this.prismaContext.client.loginAttempt.create({
      data: {
        id: record.id,
        identifier: record.identifier,
        ipAddress: record.ipAddress,
        success: record.success,
        failureReason: record.failureReason,
        createdAt: record.createdAt,
      },
    });
  }
}
