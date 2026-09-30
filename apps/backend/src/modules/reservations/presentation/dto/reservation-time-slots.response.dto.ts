import { ApiProperty } from '@nestjs/swagger';
import { ReservationSlotOutcome } from '../../application/dto/reservation-time-slots.result';

export class ReservationTimeSlotResponseDto {
  @ApiProperty({
    example: '2026-09-30T16:30:00.000Z',
    description:
      'Window start as a UTC instant. Pass this as reservationStartTime to GET /reservations/availability or to create a reservation. Format it in `timezone` for display.',
  })
  startTime!: string;

  @ApiProperty({
    example: '2026-09-30T18:30:00.000Z',
    description:
      'Window end as a UTC instant (start plus the applied duration). Pass this as reservationEndTime.',
  })
  endTime!: string;
}

export class ReservationTimeSlotsResponseDto {
  @ApiProperty({ format: 'uuid' })
  branchId!: string;

  @ApiProperty({ example: '2026-09-30' })
  date!: string;

  @ApiProperty({ example: 'Asia/Damascus' })
  timezone!: string;

  @ApiProperty({ example: 3, description: '0 = Sunday … 6 = Saturday.' })
  dayOfWeek!: number;

  @ApiProperty({
    example: '18:00',
    nullable: true,
    description: 'Opening HH:mm in the branch timezone. Null when the weekday is closed.',
  })
  openingTime!: string | null;

  @ApiProperty({
    example: '23:00',
    nullable: true,
    description: 'Closing HH:mm in the branch timezone. Null when the weekday is closed.',
  })
  closingTime!: string | null;

  @ApiProperty({
    example: 30,
    description: 'Restaurant reservationIntervalMinutes used as the step between candidate starts.',
  })
  intervalMinutes!: number;

  @ApiProperty({
    example: 120,
    description:
      'Duration applied to every slot. The request durationMinutes when supplied, otherwise defaultReservationDurationMinutes.',
  })
  durationMinutes!: number;

  @ApiProperty({
    enum: ReservationSlotOutcome,
    example: ReservationSlotOutcome.Available,
    description:
      'AVAILABLE: slots contains only windows that have at least one suitable free table. CLOSED: the weekday has no open window that can fit the duration (no working-hours row, or the open range is shorter than the duration). NO_SUITABLE_TABLE: candidate windows existed, but none had an Available table with enough capacity free of a Pending or Approved overlap. NO_REMAINING_SLOTS: every candidate start on this date is already in the past.',
  })
  outcome!: ReservationSlotOutcome;

  @ApiProperty({ type: [ReservationTimeSlotResponseDto] })
  slots!: ReservationTimeSlotResponseDto[];
}
