import { ApiProperty } from '@nestjs/swagger';

export class CompleteCustomerRegistrationResponseDto {
  @ApiProperty({ example: '11111111-1111-4111-8111-111111111111' })
  userId!: string;

  @ApiProperty({ example: 'jane_doe' })
  username!: string;

  @ApiProperty({ example: '+963912345678' })
  phone!: string;
}
