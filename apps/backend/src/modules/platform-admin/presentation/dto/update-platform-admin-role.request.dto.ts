import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { PlatformAdminRole } from '../../domain/enums/platform-admin.enums';

export class UpdatePlatformAdminRoleRequestDto {
  @ApiProperty({ enum: PlatformAdminRole, example: PlatformAdminRole.PlatformAdmin })
  @IsEnum(PlatformAdminRole)
  role!: PlatformAdminRole;
}
