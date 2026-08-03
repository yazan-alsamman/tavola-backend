import { ApiProperty } from '@nestjs/swagger';

export class CustomerInsightsResponseDto {
  @ApiProperty({ example: 120 }) uniqueRegisteredCustomers!: number;
  @ApiProperty({
    example: 34,
    description: 'Registered customers with >= 2 reservations within the requested range',
  })
  returningRegisteredCustomers!: number;
  @ApiProperty({ example: 18 }) guestBackedReservationCount!: number;
  @ApiProperty({ example: 2.6, nullable: true }) avgPartySize!: number | null;
  @ApiProperty({ example: '2026-07-28T12:00:00.000Z' }) generatedAt!: string;
}
