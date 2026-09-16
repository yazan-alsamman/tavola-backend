import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Mirrors `RefreshSessionRequestDto` on the tenant pipeline verbatim - same
 * field name, same bound. The token itself is never interchangeable between
 * the two pipelines (different table, different lookup), only the wire shape
 * is shared.
 */
export class PlatformAdminRefreshRequestDto {
  @ApiProperty({
    description: 'Opaque refresh token issued by POST /platform-admin/login or a prior refresh.',
    example: 'qT7bZ1xK9wN4mR2hV6yD3sA8cF0eJ5gU',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  refreshToken!: string;
}
