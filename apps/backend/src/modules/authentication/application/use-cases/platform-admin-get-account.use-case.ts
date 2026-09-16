import { Inject, Injectable } from '@nestjs/common';
import {
  PlatformAdminAccountDetailRow,
  PlatformAdminAccountReaderPort,
  PLATFORM_ADMIN_ACCOUNT_READER,
} from '../ports/platform-admin-account-reader.port';
import { UserNotFoundException } from '../exceptions/user-not-found.exception';

/**
 * Backs `GET /platform-admin/accounts/:userId`. Returns soft-deleted and
 * anonymized accounts rather than 404-ing them: a support operator
 * investigating "what happened to this account" needs to see that it was
 * deleted, and `deletedAt`/`anonymizedAt` are in the response precisely so
 * that state is explicit rather than inferred from an absence.
 *
 * Only a genuinely nonexistent id is a 404.
 */
@Injectable()
export class PlatformAdminGetAccountUseCase {
  constructor(
    @Inject(PLATFORM_ADMIN_ACCOUNT_READER)
    private readonly reader: PlatformAdminAccountReaderPort,
  ) {}

  async execute(query: { userId: string }): Promise<PlatformAdminAccountDetailRow> {
    const row = await this.reader.findDetailById(query.userId);
    if (row === null) {
      throw new UserNotFoundException();
    }
    return row;
  }
}
