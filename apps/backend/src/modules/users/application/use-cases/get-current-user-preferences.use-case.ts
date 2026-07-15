import { Injectable, Inject } from '@nestjs/common';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import { UserRepository } from '@modules/authentication/domain/repositories/authentication.repositories';
import { USER_REPOSITORY } from '@modules/authentication/domain/tokens/authentication.tokens';
import { UserNotFoundException } from '@modules/authentication/application/exceptions/user-not-found.exception';
import { GetCurrentUserPreferencesCommand } from '../dto/get-current-user-preferences.command';
import { UserPreferencesResult } from '../dto/user-preferences.result';

@Injectable()
export class GetCurrentUserPreferencesUseCase {
  constructor(@Inject(USER_REPOSITORY) private readonly userRepository: UserRepository) {}

  async execute(command: GetCurrentUserPreferencesCommand): Promise<UserPreferencesResult> {
    const user = await this.userRepository.findById(UserId.create(command.actor.userId));
    if (user === null) {
      throw new UserNotFoundException();
    }

    return {
      userId: user.userId.value,
      notificationOptIn: user.notificationOptIn,
      marketingOptIn: user.marketingOptIn,
      updatedAt: user.updatedAt,
    };
  }
}
