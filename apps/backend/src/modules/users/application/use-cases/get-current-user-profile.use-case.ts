import { Injectable, Inject } from '@nestjs/common';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import { UserRepository } from '@modules/authentication/domain/repositories/authentication.repositories';
import { USER_REPOSITORY } from '@modules/authentication/domain/tokens/authentication.tokens';
import { UserNotFoundException } from '@modules/authentication/application/exceptions/user-not-found.exception';
import { GetCurrentUserProfileCommand } from '../dto/get-current-user-profile.command';
import { UserProfileResult } from '../dto/user-profile.result';

@Injectable()
export class GetCurrentUserProfileUseCase {
  constructor(@Inject(USER_REPOSITORY) private readonly userRepository: UserRepository) {}

  async execute(command: GetCurrentUserProfileCommand): Promise<UserProfileResult> {
    const user = await this.userRepository.findById(UserId.create(command.actor.userId));
    if (user === null) {
      throw new UserNotFoundException();
    }

    return {
      userId: user.userId.value,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email?.value ?? null,
      phone: user.phone,
      language: user.language,
      preferredCurrency: user.preferredCurrency,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
