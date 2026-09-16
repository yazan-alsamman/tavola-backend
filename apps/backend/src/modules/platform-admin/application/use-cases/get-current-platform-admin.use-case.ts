import { Inject, Injectable } from '@nestjs/common';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import { UserRepository } from '@modules/authentication/domain/repositories/authentication.repositories';
import { USER_REPOSITORY } from '@modules/authentication/domain/tokens/authentication.tokens';
import {
  PlatformAdminRepository,
  PLATFORM_ADMIN_REPOSITORY,
} from '../../domain/repositories/platform-admin.repository';
import { PlatformAdminNotFoundException } from '../../domain/exceptions/platform-admin-not-found.exception';
import { PlatformAdminMeResult } from '../dto/platform-admin-me.dto';

/**
 * Backs `GET /platform-admin/me` — the endpoint a console calls on boot to
 * answer "am I still signed in, and as whom?" without having to decode a JWT
 * client-side or keep a copy of the login response in local storage.
 *
 * Both rows are re-read live. `PlatformAdminGuard` has already proven the
 * caller is an active admin by the time this runs, so the two null branches
 * below are races (the admin was revoked or the user hard-deleted between
 * the guard's read and this one) rather than expected states; both collapse
 * to 404 instead of returning a half-populated identity.
 */
@Injectable()
export class GetCurrentPlatformAdminUseCase {
  constructor(
    @Inject(PLATFORM_ADMIN_REPOSITORY)
    private readonly platformAdminRepository: PlatformAdminRepository,
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
  ) {}

  async execute(query: { platformAdminUserId: string }): Promise<PlatformAdminMeResult> {
    const record = await this.platformAdminRepository.findByUserId(query.platformAdminUserId);
    if (record === null || record.revokedAt !== null) {
      throw new PlatformAdminNotFoundException();
    }

    const user = await this.userRepository.findById(UserId.create(query.platformAdminUserId));
    if (user === null) {
      throw new PlatformAdminNotFoundException();
    }

    return {
      userId: record.userId,
      platformAdminId: record.id,
      email: user.email?.value ?? null,
      firstName: user.firstName,
      lastName: user.lastName,
      role: record.role,
      status: user.status,
      platformAdminCreatedAt: record.createdAt,
    };
  }
}
