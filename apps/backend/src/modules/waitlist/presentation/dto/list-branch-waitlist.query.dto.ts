import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, Matches } from 'class-validator';
import { WaitlistStatus } from '@modules/waitlist/domain/enums/waitlist.enums';

/** Restaurant Dashboard waitlist board: one branch, one queue day. */
export class ListBranchWaitlistQueryDto {
  @ApiProperty({
    format: 'date',
    example: '2026-11-08',
    description: 'The queue day (preferredDate), as a branch-local calendar date.',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be an ISO date string (YYYY-MM-DD).' })
  date!: string;

  @ApiPropertyOptional({ enum: WaitlistStatus })
  @IsOptional()
  @IsIn(Object.values(WaitlistStatus))
  status?: WaitlistStatus;
}
