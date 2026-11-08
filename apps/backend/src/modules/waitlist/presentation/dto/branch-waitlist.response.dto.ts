import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WaitlistEntryResponseDto } from './waitlist-entry.response.dto';

export class BranchWaitlistCustomerResponseDto {
  @ApiProperty({
    enum: ['User', 'Guest'],
    description: 'User = joined from the app, Guest = added by staff.',
  })
  type!: 'User' | 'Guest';

  @ApiPropertyOptional({ example: 'Rami Haddad', nullable: true })
  name!: string | null;

  @ApiPropertyOptional({ example: '+96170123456', nullable: true })
  phone!: string | null;
}

export class BranchWaitlistItemResponseDto extends WaitlistEntryResponseDto {
  @ApiProperty({ type: BranchWaitlistCustomerResponseDto })
  customer!: BranchWaitlistCustomerResponseDto;
}

export class BranchWaitlistListResponseDto {
  @ApiProperty({ type: [BranchWaitlistItemResponseDto] })
  items!: BranchWaitlistItemResponseDto[];
}
