import { Injectable, Inject } from '@nestjs/common';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import { UserRepository } from '@modules/authentication/domain/repositories/authentication.repositories';
import { USER_REPOSITORY } from '@modules/authentication/domain/tokens/authentication.tokens';
import {
  PlatformAdminRepository,
  PLATFORM_ADMIN_REPOSITORY,
} from '../../domain/repositories/platform-admin.repository';
import { PlatformAdminNotFoundException } from '../../domain/exceptions/platform-admin-not-found.exception';
import {
  GetPlatformAdminCommand,
  PlatformAdminAccountResult,
} from '../dto/platform-admin-account.dto';
import { toPlatformAdminAccountResult } from '../mappers/platform-admin-account.mapper';

@Injectable()
export class GetPlatformAdminUseCase {
  constructor(
    @Inject(PLATFORM_ADMIN_REPOSITORY)
    private readonly platformAdminRepository: PlatformAdminRepository,
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
  ) {}

  async execute(command: GetPlatformAdminCommand): Promise<PlatformAdminAccountResult> {
    const existing = await this.platformAdminRepository.findById(command.platformAdminId);
    if (existing === null) {
      throw new PlatformAdminNotFoundException();
    }
    const user = await this.userRepository.findById(UserId.create(existing.userId));
    return toPlatformAdminAccountResult(existing, user?.email?.value ?? null);
  }
}
