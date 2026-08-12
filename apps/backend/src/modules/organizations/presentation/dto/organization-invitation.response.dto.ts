import { ApiProperty } from '@nestjs/swagger';

export class OrganizationInvitationResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ enum: ['Admin', 'Billing', 'Staff'] })
  role!: string;

  @ApiProperty({
    enum: ['pending', 'accepted', 'revoked', 'expired'],
    description:
      "Live-resolved state - 'expired' is never a persisted value, only ever computed from expiresAt.",
  })
  status!: string;

  @ApiProperty({ format: 'uuid' })
  invitedByUserId!: string;

  @ApiProperty()
  expiresAt!: string;

  @ApiProperty({ nullable: true })
  acceptedAt!: string | null;

  @ApiProperty()
  createdAt!: string;
}

export class OrganizationInvitationListResponseDto {
  @ApiProperty({ type: [OrganizationInvitationResponseDto] })
  items!: OrganizationInvitationResponseDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;
}

export class AcceptOrganizationInvitationResponseDto {
  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ format: 'uuid' })
  memberId!: string;

  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({ enum: ['Admin', 'Billing', 'Staff'] })
  role!: string;

  @ApiProperty({
    description: 'True when a new User account was created as part of acceptance (Section 8).',
  })
  accountCreated!: boolean;
}
