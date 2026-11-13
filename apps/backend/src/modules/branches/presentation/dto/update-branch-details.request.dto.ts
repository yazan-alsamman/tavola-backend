import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, ValidateIf } from 'class-validator';

/** ADR-051: full replace of the branch's own name and description. */
export class UpdateBranchDetailsRequestDto {
  @ApiProperty({
    example: 'Naranj Malki',
    nullable: true,
    description: 'Null or empty: customers see the restaurant name for this branch.',
  })
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(200)
  name!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Null or empty: customers see the restaurant description for this branch.',
  })
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(5000)
  description!: string | null;
}
