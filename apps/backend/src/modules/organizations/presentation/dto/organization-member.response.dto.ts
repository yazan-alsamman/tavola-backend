import { ApiProperty } from '@nestjs/swagger';

export class OrganizationMemberResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({ enum: ['Owner', 'Admin', 'Billing', 'Staff'] })
  role!: string;

  @ApiProperty({ enum: ['Invited', 'Active', 'Removed'] })
  status!: string;

  @ApiProperty({ nullable: true })
  invitedAt!: string | null;

  @ApiProperty({ nullable: true })
  joinedAt!: string | null;
}

export class OrganizationMemberListResponseDto {
  @ApiProperty({ type: [OrganizationMemberResponseDto] })
  items!: OrganizationMemberResponseDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;
}
