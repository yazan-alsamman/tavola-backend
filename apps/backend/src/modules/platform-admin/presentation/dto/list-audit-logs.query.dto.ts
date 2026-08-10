import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '@common/dto/pagination-query.dto';

/**
 * ADR-034 §2's exact documented filter surface, nothing beyond it -
 * `actorId`/`organizationId` are `@IsUUID()` (schema columns are `@db.Uuid`);
 * `targetType`/`targetId`/`action` are plain, bounded-length strings, not
 * `@IsUUID()` - `AuditLog.targetId` is a plain `String?` column in
 * `schema.prisma` (unlike `actorId`/`organizationId`), so it is not assumed
 * to always be a UUID. `from`/`to` are required (not optional): ADR-034 §2
 * itself calls the date range "required" (mirroring ADR-028 §13's 366-day
 * cap) precisely because `AuditLog` is a high-write-volume, append-only
 * table at platform scale - page/limit alone does not bound query cost.
 */
export class ListAuditLogsQueryDto extends PaginationQueryDto {
  @ApiProperty({ description: 'ISO 8601 timestamp, inclusive lower bound.' })
  @IsDateString()
  from!: string;

  @ApiProperty({ description: 'ISO 8601 timestamp, exclusive upper bound.' })
  @IsDateString()
  to!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  targetType?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  targetId?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}
