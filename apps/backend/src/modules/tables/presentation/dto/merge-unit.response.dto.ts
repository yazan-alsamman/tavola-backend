import { ApiProperty } from '@nestjs/swagger';
import { TableResponseDto } from './table.response.dto';

/**
 * Phase 6 (Merge/Split Tables, ADR-026) - the shared response shape for
 * `POST /tables/merge` and `POST /tables/:tableId/split`. For Merge,
 * `primary`/`members` reflect the freshly created group; for Split, they
 * reflect every member's now-independent state (`mergeGroupId: null`), while
 * `mergeGroupId`/`primaryTableId`/`memberTableIds`/`effectiveCapacity` still
 * describe the group that was just dissolved, for reference/auditing.
 */
export class MergedUnitResponseDto {
  @ApiProperty({ format: 'uuid' })
  mergeGroupId!: string;

  @ApiProperty({ format: 'uuid' })
  primaryTableId!: string;

  @ApiProperty({ type: [String], format: 'uuid' })
  memberTableIds!: string[];

  @ApiProperty({
    example: 8,
    description:
      'SUM of every member permanent capacity (ADR-026 decision #4) - never overwrites any Table.capacity column.',
  })
  effectiveCapacity!: number;

  @ApiProperty({ type: () => TableResponseDto })
  primary!: TableResponseDto;

  @ApiProperty({ type: () => TableResponseDto, isArray: true })
  members!: TableResponseDto[];
}
