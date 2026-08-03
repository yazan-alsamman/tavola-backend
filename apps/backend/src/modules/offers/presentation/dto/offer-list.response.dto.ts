import { ApiProperty } from '@nestjs/swagger';
import { OfferResponseDto } from './offer.response.dto';

export class OfferListResponseDto {
  @ApiProperty({ type: [OfferResponseDto] })
  items!: OfferResponseDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 0 })
  total!: number;
}
