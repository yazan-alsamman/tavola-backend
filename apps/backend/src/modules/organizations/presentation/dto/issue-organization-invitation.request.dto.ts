import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, MaxLength } from 'class-validator';
import { OrganizationMemberRole } from '../../domain/enums/organization.enums';

export class IssueOrganizationInvitationRequestDto {
  @ApiProperty({ example: 'new.member@example.com' })
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({
    enum: [
      OrganizationMemberRole.Admin,
      OrganizationMemberRole.Billing,
      OrganizationMemberRole.Staff,
    ],
    description: 'Owner cannot be granted by invitation - use Transfer Ownership instead.',
  })
  @IsEnum(OrganizationMemberRole)
  role!: OrganizationMemberRole;
}
