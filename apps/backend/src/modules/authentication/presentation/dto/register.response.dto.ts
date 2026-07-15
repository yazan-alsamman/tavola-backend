import { ApiProperty } from '@nestjs/swagger';
import { UserStatus } from '../../domain/enums/authentication.enums';

/**
 * Matches AUTHENTICATION_ARCHITECTURE.md §9.2's documented response exactly
 * - `userId`, `email`, `status` only. `RegisterOrganizationOwnerResult` (the
 * Application layer's actual return value) also carries `organizationId`/
 * `organizationSlug`/`organizationName`, but those are not part of the
 * documented public contract, so the controller does not forward them.
 */
export class RegisterResponseDto {
  @ApiProperty({ example: '11111111-1111-4111-8111-111111111111' })
  userId!: string;

  @ApiProperty({ example: 'owner@example.com' })
  email!: string;

  @ApiProperty({ enum: UserStatus, example: UserStatus.Pending })
  status!: UserStatus;
}
