import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RestaurantGalleryImageResponseDto {
  @ApiProperty({ example: '11111111-1111-4111-8111-111111111111' })
  galleryItemId!: string;

  @ApiProperty({ example: '22222222-2222-4222-8222-222222222222' })
  restaurantId!: string;

  @ApiPropertyOptional({ example: 'Our dining room', nullable: true })
  caption!: string | null;

  @ApiProperty({ example: 0 })
  sortOrder!: number;

  @ApiPropertyOptional({
    example: 'https://minio.example.com/tavla-public/restaurants/.../gallery/....jpg?X-Amz-...',
    description: 'A freshly-generated, time-limited signed URL - never cache this value long-term.',
    nullable: true,
  })
  imageUrl!: string | null;

  @ApiProperty({ example: '2026-07-16T12:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-07-16T12:00:00.000Z' })
  updatedAt!: string;
}

export class RestaurantGalleryListResponseDto {
  @ApiProperty({ example: '22222222-2222-4222-8222-222222222222' })
  restaurantId!: string;

  @ApiProperty({ type: [RestaurantGalleryImageResponseDto] })
  items!: RestaurantGalleryImageResponseDto[];
}
