import { ApiProperty } from '@nestjs/swagger';

export class AuditLogResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  actorId!: string | null;

  @ApiProperty({ enum: ['User', 'Employee', 'System', 'PlatformAdmin'] })
  actorType!: string;

  @ApiProperty()
  action!: string;

  @ApiProperty({ nullable: true })
  targetType!: string | null;

  @ApiProperty({ nullable: true })
  targetId!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  organizationId!: string | null;

  @ApiProperty({ nullable: true })
  correlationId!: string | null;

  @ApiProperty({ nullable: true })
  ipAddress!: string | null;

  @ApiProperty()
  occurredAt!: string;
}

export class AuditLogListResponseDto {
  @ApiProperty({ type: [AuditLogResponseDto] })
  items!: AuditLogResponseDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;
}
