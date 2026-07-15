import { ApiProperty } from '@nestjs/swagger';

export class FavoriteResponseDto {
  @ApiProperty({ example: '22222222-2222-4222-8222-222222222222' })
  restaurantId!: string;

  @ApiProperty({ example: '2026-07-14T12:00:00.000Z' })
  favoritedAt!: string;
}
