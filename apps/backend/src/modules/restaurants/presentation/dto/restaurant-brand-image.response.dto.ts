import { ApiProperty } from '@nestjs/swagger';

export class RestaurantCoverImageResponseDto {
  @ApiProperty({ format: 'uuid' })
  coverImageId!: string;

  @ApiProperty({
    example: 'https://minio.example.com/tavla-public/restaurants/.../cover/....jpg?X-Amz-...',
    description:
      'Short-lived signed read URL for the cover just stored. The client must not build this URL.',
  })
  coverImageUrl!: string;
}

export class RestaurantLogoImageResponseDto {
  @ApiProperty({ format: 'uuid' })
  logoId!: string;

  @ApiProperty({
    example: 'https://minio.example.com/tavla-public/restaurants/.../logo/....jpg?X-Amz-...',
    description:
      'Short-lived signed read URL for the logo just stored. The client must not build this URL.',
  })
  logoUrl!: string;
}
