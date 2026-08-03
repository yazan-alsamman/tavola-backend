import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, ArrayUnique, IsUUID } from 'class-validator';

/** API_GUIDELINES.md's Bulk Reorder Endpoints convention - whole-set replacement, shared shape for Categories/Items. */
export class ReorderRequestDto {
  @ApiProperty({ type: [String], format: 'uuid' })
  @IsUUID(4, { each: true })
  @ArrayUnique()
  @ArrayNotEmpty()
  orderedIds!: string[];
}
