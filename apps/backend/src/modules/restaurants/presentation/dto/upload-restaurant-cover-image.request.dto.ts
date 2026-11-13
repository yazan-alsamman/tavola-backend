import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

/** Multipart text fields sent with a cover upload (the file itself is `file`). */
export class UploadRestaurantCoverImageRequestDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      "ADR-051: the branch whose cover this is. Omitted, the restaurant's own cover (shown where a branch has none).",
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}
