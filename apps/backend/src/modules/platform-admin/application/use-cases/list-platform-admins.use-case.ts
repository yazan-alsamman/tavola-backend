import { Injectable, Inject } from '@nestjs/common';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import { UserRepository } from '@modules/authentication/domain/repositories/authentication.repositories';
import { USER_REPOSITORY } from '@modules/authentication/domain/tokens/authentication.tokens';
import {
  PlatformAdminRepository,
  PLATFORM_ADMIN_REPOSITORY,
} from '../../domain/repositories/platform-admin.repository';
import {
  ListPlatformAdminsCommand,
  PlatformAdminAccountListResult,
} from '../dto/platform-admin-account.dto';
import { toPlatformAdminAccountResult } from '../mappers/platform-admin-account.mapper';

@Injectable()
export class ListPlatformAdminsUseCase {
  constructor(
    @Inject(PLATFORM_ADMIN_REPOSITORY)
    private readonly platformAdminRepository: PlatformAdminRepository,
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
  ) {}

  async execute(command: ListPlatformAdminsCommand): Promise<PlatformAdminAccountListResult> {
    const { items, total } = await this.platformAdminRepository.list(command.page, command.limit);
    const users = await this.userRepository.findManyByIds(
      items.map((item) => UserId.create(item.userId)),
    );
    const emailByUserId = new Map(
      users.map((user) => [user.userId.value, user.email?.value ?? null]),
    );

    return {
      items: items.map((item) =>
        toPlatformAdminAccountResult(item, emailByUserId.get(item.userId) ?? null),
      ),
      total,
      page: command.page,
      limit: command.limit,
    };
  }
}
