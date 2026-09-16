import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '@common/dto/pagination-query.dto';
import { EmptyStringToUndefined } from '@common/decorators/empty-to-undefined.decorator';
import { PlatformAdminAccountType } from '../../application/ports/platform-admin-account-reader.port';

export const PLATFORM_ADMIN_ACCOUNT_TYPES: readonly PlatformAdminAccountType[] = [
  'PlatformAdmin',
  'OrganizationMember',
  'Employee',
  'Customer',
];

/** Mirrors the Prisma `UserStatus` enum exactly. */
export const PLATFORM_ADMIN_ACCOUNT_STATUSES = [
  'Pending',
  'Active',
  'Suspended',
  'Locked',
  'Deleted',
  'Anonymized',
] as const;

export class SearchPlatformAdminAccountsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Case-insensitive partial match across email, phone, username, first and last name. Omitted, empty, or whitespace-only returns the ordinary paginated list rather than an empty result.',
    example: 'farid',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: PLATFORM_ADMIN_ACCOUNT_STATUSES, example: 'Active' })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsIn(PLATFORM_ADMIN_ACCOUNT_STATUSES)
  status?: string;

  @ApiPropertyOptional({
    enum: PLATFORM_ADMIN_ACCOUNT_TYPES,
    example: 'Customer',
    description:
      'Derived from which relations the User row has, not from a stored column. Precedence: PlatformAdmin, then OrganizationMember, then Employee, then Customer.',
  })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsIn(PLATFORM_ADMIN_ACCOUNT_TYPES)
  accountType?: PlatformAdminAccountType;
}

export class PlatformAdminAccountSummaryResponseDto {
  @ApiProperty({ format: 'uuid', example: '5e2a9c14-8d37-4b61-a0f5-72c1e9b4d803' })
  userId!: string;

  @ApiProperty({ nullable: true, example: 'farid@example.com' })
  email!: string | null;

  @ApiProperty({ nullable: true, example: '+9627xxxxxxxx' })
  phone!: string | null;

  @ApiProperty({ nullable: true, example: 'farid' })
  username!: string | null;

  @ApiProperty({ nullable: true, example: 'Farid' })
  firstName!: string | null;

  @ApiProperty({ nullable: true, example: 'Haddad' })
  lastName!: string | null;

  @ApiProperty({ enum: PLATFORM_ADMIN_ACCOUNT_STATUSES, example: 'Active' })
  status!: string;

  @ApiProperty({ enum: PLATFORM_ADMIN_ACCOUNT_TYPES, example: 'Customer' })
  accountType!: PlatformAdminAccountType;

  @ApiProperty({ example: true })
  emailVerified!: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  lastLoginAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time', example: '2026-06-11T07:22:19.004Z' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  deletedAt!: string | null;
}

export class PlatformAdminAccountListResponseDto {
  @ApiProperty({ type: [PlatformAdminAccountSummaryResponseDto] })
  items!: PlatformAdminAccountSummaryResponseDto[];

  @ApiProperty({
    example: 137,
    description: 'Total matching the same filter as the returned page.',
  })
  total!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;
}

export class PlatformAdminAccountOrganizationResponseDto {
  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ example: 'Acme Hospitality Group' })
  organizationName!: string;

  @ApiProperty({ example: 'Owner' })
  role!: string;

  @ApiProperty({ example: 'Active' })
  status!: string;
}

export class PlatformAdminAccountDetailResponseDto extends PlatformAdminAccountSummaryResponseDto {
  @ApiProperty({ example: 'en' })
  language!: string;

  @ApiProperty({ nullable: true, example: 'JOD' })
  preferredCurrency!: string | null;

  @ApiProperty({ example: true })
  notificationOptIn!: boolean;

  @ApiProperty({ example: false })
  marketingOptIn!: boolean;

  @ApiProperty({
    example: 0,
    description: 'Consecutive failed logins. Reaching the configured cap sets lockedUntil.',
  })
  failedLoginCount!: number;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
    description: 'Non-null while the account is locked out by failed-login protection.',
  })
  lockedUntil!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  passwordChangedAt!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
    description: 'Non-null while a self-service deletion request is inside its grace period.',
  })
  deletionRequestedAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  scheduledAnonymizationAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  anonymizedAt!: string | null;

  @ApiProperty({
    example: 2,
    description:
      'Device sessions that are neither revoked nor expired right now — what Force Logout would terminate.',
  })
  activeSessionCount!: number;

  @ApiProperty({
    type: [PlatformAdminAccountOrganizationResponseDto],
    description: 'Empty for a Customer, who belongs to no Organization.',
  })
  organizations!: PlatformAdminAccountOrganizationResponseDto[];

  @ApiProperty({ type: String, format: 'date-time', example: '2026-09-02T13:45:00.000Z' })
  updatedAt!: string;
}
