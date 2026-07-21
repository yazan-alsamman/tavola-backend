import { ApiProperty } from '@nestjs/swagger';
import { TableShape } from '@modules/tables/domain/enums/table.enums';

export class TableAvailabilityResponseDto {
  @ApiProperty({ format: 'uuid' })
  tableId!: string;

  @ApiProperty({ example: 'T1' })
  tableNumber!: string;

  @ApiProperty({ example: 4 })
  capacity!: number;

  @ApiProperty({ enum: TableShape })
  shape!: TableShape;

  @ApiProperty({
    example: true,
    description:
      'Phase 7.1 Availability Search Contract: informational only. This table is always returned when it matches the search criteria, whether true or false - never hidden. false means a Pending/Approved reservation already overlaps the requested window; it does not mean the table cannot be requested, only that Reservation creation (the sole authoritative conflict check, ADR-013) may reject it.',
  })
  isAvailable!: boolean;
}
