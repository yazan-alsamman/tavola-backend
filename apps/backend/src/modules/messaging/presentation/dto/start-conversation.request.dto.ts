import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class StartConversationRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  restaurantId!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  reservationId?: string;

  @ApiPropertyOptional({ maxLength: 200, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Required when a Restaurant-side actor (Employee/OrganizationMember) starts a conversation on behalf of a customer. Ignored for a Customer actor - their own userId is always used.',
  })
  @IsOptional()
  @IsUUID()
  customerUserId?: string;
}
