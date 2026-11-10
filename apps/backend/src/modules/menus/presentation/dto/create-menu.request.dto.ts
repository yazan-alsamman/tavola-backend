import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateMenuRequestDto {
  @ApiProperty({ example: 'Breakfast Menu' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: "Set: this branch's own menu. Omitted: shared by every branch (ADR-046).",
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}
