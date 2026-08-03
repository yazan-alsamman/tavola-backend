import { ApiProperty } from '@nestjs/swagger';

export class PeakHoursResponseDto {
  @ApiProperty({
    type: [Number],
    example: [0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 5, 8, 10, 7, 4, 3, 2, 6, 9, 11, 6, 2, 1, 0],
    description: 'Exactly 24 entries, index = Branch-local hour (0-23), zero-filled',
  })
  peakHours!: number[];

  @ApiProperty({ example: '2026-07-28T12:00:00.000Z' }) generatedAt!: string;
}
