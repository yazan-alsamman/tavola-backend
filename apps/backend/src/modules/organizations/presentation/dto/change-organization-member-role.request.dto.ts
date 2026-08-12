import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { OrganizationMemberRole } from '../../domain/enums/organization.enums';

export class ChangeOrganizationMemberRoleRequestDto {
  @ApiProperty({ enum: OrganizationMemberRole })
  @IsEnum(OrganizationMemberRole)
  role!: OrganizationMemberRole;
}
