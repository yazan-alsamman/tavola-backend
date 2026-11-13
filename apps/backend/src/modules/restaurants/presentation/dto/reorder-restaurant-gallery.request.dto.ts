import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsArray, IsOptional, IsUUID } from 'class-validator';
import { GALLERY_MAX_IMAGES_PER_RESTAURANT } from '../../application/policies/gallery-upload.policy';

export class ReorderRestaurantGalleryRequestDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    description: 'Every gallery image of the restaurant, once, in the new order (ADR-046).',
  })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(GALLERY_MAX_IMAGES_PER_RESTAURANT)
  @IsUUID('all', { each: true })
  galleryItemIds!: string[];

  @ApiPropertyOptional({
    format: 'uuid',
    description: "ADR-051: the branch whose gallery is reordered. Omitted, the restaurant's oldest branch.",
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}
